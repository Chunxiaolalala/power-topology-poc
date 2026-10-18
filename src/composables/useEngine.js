/**
 * useEngine.js —— Vue 3 引擎编排 composable
 *
 * 每帧路径：
 *   差分写节点数据（有状态变化才写）→ 相机 → Scene.render（Compute 剔除 + 三级 LOD + 间接绘制）
 *
 * 数据侧：
 *   - 节点数由 URL 参数控制：?nodes=10000（默认 10000，?nodes=209 可回到原版规模）
 *   - 实时 tick 每 500ms 一次，只对「被跟踪的少量节点」记录历史，并返回状态变化下标做差分更新
 */

import { reactive, ref, shallowRef, onMounted, onBeforeUnmount } from 'vue';
import { initWebGPU } from '../engine/device.js';
import { generateTopology, tickRealtimeData, ensureHistory } from '../engine/mock-data.js';
import { createSphereGeometry, createQuadGeometry, buildLineVertices } from '../engine/geometry.js';
import {
  createUniformBuffer, createCullUniformBuffer, createSphereBuffers, createNodeInstanceBuffer,
  createLineVertexBuffer, createQuadBuffers, buildFlowInstances, createFlowInstanceBuffer,
  createVisibleBuffer, createCounterBuffer, createIndirectBuffer,
} from '../engine/buffers.js';
import {
  createNodePipeline, createBillboardPipeline, createLinePipeline, createFlowPipeline,
  createCullPipeline, createFinalizePipeline,
} from '../engine/pipelines.js';
import { OrbitCamera } from '../engine/camera.js';
import { Scene } from '../engine/scene.js';
import { Interaction } from '../engine/interaction.js';

/** 从 URL 读取目标节点数（默认万级） */
function readNodeTarget() {
  const raw = new URLSearchParams(window.location.search).get('nodes');
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 10000;
  return Math.max(1, Math.min(200000, Math.floor(n)));
}

export function useEngine() {
  const canvasEl = shallowRef(null);
  const noGpu = ref(false);
  const perf = reactive({
    fps: '--', nodes: '--', edges: '--',
    particles: '--', frameMs: '--', adapter: '--',
    timings: null,             // { cull, finalize, nodes, lines, flow, total }
    timingsSupported: false,
  });
  const intro = reactive({ adapterName: '', webgpuSupported: true, nodeCount: 0 });
  const selectedNode = shallowRef(null);
  const metricsTick = ref(0);
  const tooltip = reactive({ show: false, x: 0, y: 0, node: null });
  const paused = ref(false);
  const interaction = shallowRef(null);

  let disposed = false;

  onMounted(async () => {
    const canvas = canvasEl.value;
    if (!canvas) return;

    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    // ---- 1. WebGPU ----
    let gpu;
    try {
      gpu = await initWebGPU(canvas);
    } catch (e) {
      console.error('[WebGPU] 初始化失败:', e);
      noGpu.value = true;
      return;
    }
    const adapterName = gpu.adapter?.info?.description || 'Unknown';
    console.log('[WebGPU] adapter:', adapterName, '| timestamp-query:', gpu.timestampSupported);

    // ---- 2. 拓扑数据（万级可配置） ----
    const target = readNodeTarget();
    const t0 = performance.now();
    const { nodes, edges, nodeMap, meta } = generateTopology(target);
    console.log(`[Topology] 目标 ${target} · 实际节点 ${nodes.length} · 连线 ${edges.length}` +
      ` · 生成耗时 ${(performance.now() - t0).toFixed(1)}ms`);

    // ---- 3. 几何：两档球体 + quad ----
    const sphereHigh = createSphereGeometry(0.5, 24, 16); // 768 三角形
    const sphereMid = createSphereGeometry(0.5, 12, 8);   // 176 三角形
    const quad = createQuadGeometry();
    const lineVertices = buildLineVertices(edges, nodeMap);
    const flow = buildFlowInstances(edges, nodeMap);
    console.log(`[Geometry] 高模索引 ${sphereHigh.indices.length} · 中模索引 ${sphereMid.indices.length}` +
      ` · 流光粒子 ${flow.count}`);

    // ---- 4. GPU 缓冲 ----
    const device = gpu.device;
    const uniformBuffer = createUniformBuffer(device);
    const cullUniformBuffer = createCullUniformBuffer(device);
    const sphereHighBuffers = createSphereBuffers(device, sphereHigh);
    const sphereMidBuffers = createSphereBuffers(device, sphereMid);
    const nodeInstanceBuffer = createNodeInstanceBuffer(device, nodes.length);
    const lineVertexBuffer = createLineVertexBuffer(device, lineVertices);
    const quadBuffers = createQuadBuffers(device, quad);
    const flowInstanceBuffer = createFlowInstanceBuffer(device, flow.data);

    // Compute 剔除 / 间接绘制资源
    const visibleHigh = createVisibleBuffer(device, nodes.length);
    const visibleMid = createVisibleBuffer(device, nodes.length);
    const visibleFar = createVisibleBuffer(device, nodes.length);
    const counterBuffer = createCounterBuffer(device);
    const indirectBuffer = createIndirectBuffer(device, {
      high: sphereHigh.indices.length,
      mid: sphereMid.indices.length,
      far: quad.indices.length,
    });

    // ---- 5. 管线 ----
    const nodePipeline = createNodePipeline(device, gpu.format);
    const billboardPipeline = createBillboardPipeline(device, gpu.format);
    const linePipeline = createLinePipeline(device, gpu.format);
    const flowPipeline = createFlowPipeline(device, gpu.format);
    const cullPipeline = createCullPipeline(device);
    const finalizePipeline = createFinalizePipeline(device);

    const res = {
      uniformBuffer,
      cullUniformBuffer,
      sphereHigh: sphereHighBuffers,
      sphereMid: sphereMidBuffers,
      nodeInstanceBuffer,
      lineVertexBuffer, lineVertexCount: lineVertices.length / 6,
      quadVertexBuffer: quadBuffers.vertexBuffer,
      quadIndexBuffer: quadBuffers.indexBuffer,
      quadIndexCount: quadBuffers.indexCount,
      flowInstanceBuffer, flowParticleCount: flow.count,
      visibleHigh, visibleMid, visibleFar,
      counterBuffer, indirectBuffer,
      nodePipeline, billboardPipeline, linePipeline, flowPipeline,
      cullPipeline, finalizePipeline,
      nodeCount: nodes.length,
    };

    // ---- 6. 相机（按场景尺度配置） ----
    const k = meta.sceneScale;
    const homeDistance = 22 * k;
    const camera = new OrbitCamera(canvas.clientWidth / canvas.clientHeight, {
      distance: homeDistance,
      minDistance: 2,
      maxDistance: homeDistance * 1.4,
      near: 0.5,
      far: 250 * k,
      targetY: 3 * k,
    });

    // ---- 7. 场景 ----
    const scene = new Scene(gpu, res, nodes);
    window.__res = res;
    window.__scene = scene;
    window.__gpu = gpu;
    window.__camera = camera;
    window.__nodes = nodes;

    // ---- 8. 初始 UI 状态 ----
    intro.adapterName = adapterName;
    intro.webgpuSupported = true;
    intro.nodeCount = nodes.length;
    selectedNode.value = null;
    Object.assign(perf, {
      fps: '--', nodes: nodes.length, edges: edges.length,
      particles: flow.count, frameMs: '--', adapter: adapterName,
      timings: null, timingsSupported: !!gpu.timestampSupported,
    });
    scene.onTimings = (t) => { perf.timings = t; };

    // ---- 9. 交互 ----
    // 历史跟踪集合：只保留最近选中的少量节点（最多 16 个），避免万级下为每个节点维护 60 点历史
    const trackedSet = new Set();
    function trimTracked() {
      if (trackedSet.size <= 16) return;
      const first = trackedSet.values().next().value;
      trackedSet.delete(first);
    }

    const interact = new Interaction({
      canvas,
      camera,
      scene,
      nodes,
      sceneScale: k,
      homeDistance,
      targetY: 3 * k,
      onSelect: (node, idx) => {
        selectedNode.value = node;
        if (node && idx >= 0) {
          ensureHistory(node);   // 只为被选中的节点准备趋势历史
          trackedSet.add(idx);   // 加入历史跟踪集合
          trimTracked();
        }
      },
      onHover: (node, x, y) => {
        if (node) {
          tooltip.show = true;
          tooltip.x = x;
          tooltip.y = y;
          tooltip.node = node;
        } else {
          tooltip.show = false;
        }
      },
    });
    interaction.value = interact;

    // ---- 10. 主循环 ----
    let lastTime = performance.now();
    let elapsed = 0;
    let tickAccum = 0;
    let fpsAccum = 0;
    let fpsFrames = 0;
    let fpsLastUpdate = 0;

    function loop(now) {
      if (disposed) return;
      const dt = now - lastTime;
      lastTime = now;
      elapsed += dt;

      // 自适应 canvas 尺寸
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        scene.resize(w, h);
      }

      // 实时数据 tick（每 500ms）＋ 差分缓冲更新
      if (!interact.paused) {
        tickAccum += dt;
        if (tickAccum >= 500) {
          const changed = tickRealtimeData(nodes, elapsed, trackedSet);
          if (changed.length) scene.updateNodes(changed);
          tickAccum = 0;
          if (selectedNode.value) metricsTick.value++;
        }
      }

      camera.stepTween(dt);
      camera.updateMatrices(canvas.width / canvas.height);

      scene.render(camera, elapsed / 1000);

      // FPS 统计（每 500ms 更新面板）
      fpsFrames++;
      fpsAccum += dt;
      if (now - fpsLastUpdate >= 500) {
        const fps = Math.round((fpsFrames * 1000) / fpsAccum);
        const frameMs = (fpsAccum / fpsFrames).toFixed(1);
        perf.fps = fps;
        perf.frameMs = frameMs;
        perf.nodes = nodes.length;
        perf.edges = edges.length;
        perf.particles = flow.count;
        perf.adapter = adapterName;
        fpsFrames = 0;
        fpsAccum = 0;
        fpsLastUpdate = now;
      }

      requestAnimationFrame(loop);
    }

    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    scene.resize(canvas.width, canvas.height);
    requestAnimationFrame(loop);
  });

  onBeforeUnmount(() => {
    disposed = true;
  });

  // ---- 顶栏按钮动作 ----
  function globalView() { interaction.value?.globalView(); }
  function focusFault() { interaction.value?.focusFault(); }
  function togglePause() {
    const next = interaction.value?.togglePause();
    paused.value = !!next;
  }

  return {
    canvasEl, noGpu, perf, intro, selectedNode, metricsTick,
    tooltip, paused, interaction,
    globalView, focusFault, togglePause,
  };
}

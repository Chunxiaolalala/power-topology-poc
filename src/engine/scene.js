/**
 * scene.js —— 场景渲染（GPU 驱动）
 *
 * 每帧流程：
 *   1. 写 uniform（相机矩阵 + 选中/悬停）
 *   2. 写 cull uniform（视锥平面 + LOD 投影参数）
 *   3. 清空原子计数器
 *   4. Compute：视锥剔除 + LOD 分桶 → 3 个可见索引列表
 *   5. Compute：把计数写进 DrawIndexedIndirectArgs.instanceCount
 *   6. RenderPass：节点（高模 / 中模 / 远距离 billboard，共 3 次间接绘制）
 *   7. RenderPass：连线（深度测试不写）
 *   8. RenderPass：流光粒子（加色混合）
 *   9. 每 20 帧读回一次 Timestamp，输出分管线耗时
 *
 * 节点数据只在状态变化时差分写入（见 updateNodes），不再每帧全量上传。
 */

import {
  writeUniforms, writeCullUniforms, writeNodeInstances, writeNodeInstanceAt,
} from './buffers.js';
import { extractFrustumPlanes } from './frustum.js';

export class Scene {
  /**
   * @param {object} gpu { device, context, format, timestampSupported }
   * @param {object} res 资源集合
   * @param {Array} nodes
   */
  constructor(gpu, res, nodes) {
    this.device = gpu.device;
    this.context = gpu.context;
    this.format = gpu.format;
    this.res = res;
    this.nodes = nodes;

    this.selectedId = 0xffffffff; // u32 max = 无选中
    this.hoverId = 0xffffffff;

    this.width = 1;
    this.height = 1;
    this.depthTexture = null;
    this.planes = new Float32Array(24);

    // ---- Untyped bind groups ----
    const device = this.device;

    this.cullBindGroup = device.createBindGroup({
      layout: res.cullPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: res.cullUniformBuffer } },
        { binding: 1, resource: { buffer: res.nodeInstanceBuffer } },
        { binding: 2, resource: { buffer: res.visibleHigh } },
        { binding: 3, resource: { buffer: res.visibleMid } },
        { binding: 4, resource: { buffer: res.visibleFar } },
        { binding: 5, resource: { buffer: res.counterBuffer } },
      ],
    });

    this.finalizeBindGroup = device.createBindGroup({
      layout: res.finalizePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: res.counterBuffer } },
        { binding: 1, resource: { buffer: res.indirectBuffer } },
      ],
    });

    const makeNodeBindGroup = (pipeline, visibleBuffer) => device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: res.uniformBuffer } },
        { binding: 1, resource: { buffer: res.nodeInstanceBuffer } },
        { binding: 2, resource: { buffer: visibleBuffer } },
      ],
    });

    this.nodeBindGroups = [
      makeNodeBindGroup(res.nodePipeline, res.visibleHigh),
      makeNodeBindGroup(res.nodePipeline, res.visibleMid),
    ];
    this.billboardBindGroup = makeNodeBindGroup(res.billboardPipeline, res.visibleFar);

    this.lineBindGroup = device.createBindGroup({
      layout: res.linePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: res.uniformBuffer } }],
    });
    this.flowBindGroup = device.createBindGroup({
      layout: res.flowPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: res.uniformBuffer } }],
    });

    // ---- Timestamp Query 资源 ----
    this.timestampSupported = !!gpu.timestampSupported;
    this.frameIndex = 0;
    this._pendingTimings = false;
    this.onTimings = null;
    if (this.timestampSupported) {
      this.querySet = device.createQuerySet({ type: 'timestamp', count: 10 });
      this.queryResolve = device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      this.queryRead = device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
    }

    // 首次全量写入节点数据（此后只做差分更新）
    writeNodeInstances(device, res.nodeInstanceBuffer, nodes);
  }

  /** 画布尺寸变化时重建深度纹理 */
  resize(width, height) {
    this.width = width;
    this.height = height;
    if (this.depthTexture) this.depthTexture.destroy();
    this.depthTexture = this.device.createTexture({
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  setSelected(nodeIndex) {
    this.selectedId = nodeIndex === -1 ? 0xffffffff : nodeIndex;
  }
  setHovered(nodeIndex) {
    this.hoverId = nodeIndex === -1 ? 0xffffffff : nodeIndex;
  }

  /**
   * 差分更新若干节点的实例数据（状态变化时调用）
   * @param {number[]} indices
   */
  updateNodes(indices) {
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      writeNodeInstanceAt(this.device, this.res.nodeInstanceBuffer, i, this.nodes[i]);
    }
  }

  /** 时间戳写入配置（未支持时返回 undefined） */
  _ts(pairIndex) {
    if (!this.timestampSupported) return undefined;
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: pairIndex * 2,
      endOfPassWriteIndex: pairIndex * 2 + 1,
    };
  }

  /**
   * 渲染一帧
   * @param {import('./camera.js').OrbitCamera} camera
   * @param {number} time 秒
   */
  render(camera, time) {
    if (window.__skipRender) return;
    const { device, context, res } = this;

    // ---- 1. uniform ----
    writeUniforms(device, res.uniformBuffer, {
      viewProj: camera.viewProj,
      cameraPos: camera.cameraPos,
      cameraRight: camera.cameraRight,
      cameraUp: camera.cameraUp,
      time,
      selectedId: this.selectedId,
      hoverId: this.hoverId,
    });

    // ---- 2. cull uniform（视锥平面 + LOD 投影系数） ----
    extractFrustumPlanes(camera.viewProj, this.planes);
    const projScale = this.height / (2 * Math.tan((camera.fov * Math.PI) / 180 / 2));
    writeCullUniforms(device, res.cullUniformBuffer, {
      planes: this.planes,
      cameraPos: camera.cameraPos,
      projScale,
      nodeCount: res.nodeCount,
    });

    const encoder = device.createCommandEncoder();
    // 计数器归零（原子累加前必须清零）
    encoder.clearBuffer(res.counterBuffer);

    // ---- 3. Compute：剔除 + LOD ----
    const cullPass = encoder.beginComputePass({ timestampWrites: this._ts(0) });
    cullPass.setPipeline(res.cullPipeline);
    cullPass.setBindGroup(0, this.cullBindGroup);
    cullPass.dispatchWorkgroups(Math.ceil(res.nodeCount / 64));
    cullPass.end();

    // ---- 4. Compute：写间接绘制参数 ----
    const finPass = encoder.beginComputePass({ timestampWrites: this._ts(1) });
    finPass.setPipeline(res.finalizePipeline);
    finPass.setBindGroup(0, this.finalizeBindGroup);
    finPass.dispatchWorkgroups(1);
    finPass.end();

    // ---- 5. Pass 1：节点（高模 / 中模 / 远距离 billboard） ----
    const nodePass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.04, g: 0.055, b: 0.1, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
      timestampWrites: this._ts(2),
    });

    // 高模
    nodePass.setPipeline(res.nodePipeline);
    nodePass.setBindGroup(0, this.nodeBindGroups[0]);
    nodePass.setVertexBuffer(0, res.sphereHigh.vertexBuffer);
    nodePass.setIndexBuffer(res.sphereHigh.indexBuffer, 'uint16');
    nodePass.drawIndexedIndirect(res.indirectBuffer, 0);

    // 中模
    nodePass.setBindGroup(0, this.nodeBindGroups[1]);
    nodePass.setVertexBuffer(0, res.sphereMid.vertexBuffer);
    nodePass.setIndexBuffer(res.sphereMid.indexBuffer, 'uint16');
    nodePass.drawIndexedIndirect(res.indirectBuffer, 20);

    // 远距离 LOD（billboard）
    nodePass.setPipeline(res.billboardPipeline);
    nodePass.setBindGroup(0, this.billboardBindGroup);
    nodePass.setVertexBuffer(0, res.quadVertexBuffer);
    nodePass.setIndexBuffer(res.quadIndexBuffer, 'uint16');
    nodePass.drawIndexedIndirect(res.indirectBuffer, 40);
    nodePass.end();

    // ---- 6. Pass 2：连线 ----
    const linePass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: 'load',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
      timestampWrites: this._ts(3),
    });
    linePass.setPipeline(res.linePipeline);
    linePass.setBindGroup(0, this.lineBindGroup);
    linePass.setVertexBuffer(0, res.lineVertexBuffer);
    linePass.draw(res.lineVertexCount);
    linePass.end();

    // ---- 7. Pass 3：流光粒子 ----
    const flowPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: 'load',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
      timestampWrites: this._ts(4),
    });
    flowPass.setPipeline(res.flowPipeline);
    flowPass.setBindGroup(0, this.flowBindGroup);
    flowPass.setVertexBuffer(0, res.quadVertexBuffer);
    flowPass.setVertexBuffer(1, res.flowInstanceBuffer);
    flowPass.setIndexBuffer(res.quadIndexBuffer, 'uint16');
    flowPass.drawIndexed(res.quadIndexCount, res.flowParticleCount);
    flowPass.end();

    device.queue.submit([encoder.finish()]);

    // ---- 8. 每 20 帧采样一次时间戳 ----
    if (this.timestampSupported && (++this.frameIndex % 20 === 0)) {
      this._collectTimings();
    }
  }

  /** 异步读回时间戳并回调分管线耗时（毫秒） */
  async _collectTimings() {
    if (this._pendingTimings) return;
    this._pendingTimings = true;
    try {
      const enc = this.device.createCommandEncoder();
      enc.resolveQuerySet(this.querySet, 0, 10, this.queryResolve, 0);
      enc.copyBufferToBuffer(this.queryResolve, 0, this.queryRead, 0, 80);
      this.device.queue.submit([enc.finish()]);

      await this.queryRead.mapAsync(GPUMapMode.READ);
      const ns = new BigUint64Array(this.queryRead.getMappedRange(0, 80).slice(0));
      this.queryRead.unmap();

      const ms = (i) => Number(ns[i * 2 + 1] - ns[i * 2]) / 1e6;
      const t = {
        cull: ms(0),
        finalize: ms(1),
        nodes: ms(2),
        lines: ms(3),
        flow: ms(4),
      };
      t.total = t.cull + t.finalize + t.nodes + t.lines + t.flow;
      this.onTimings?.(t);
    } catch (e) {
      console.warn('[timestamp] 读回失败', e);
    } finally {
      this._pendingTimings = false;
    }
  }

  dispose() {
    if (this.depthTexture) this.depthTexture.destroy();
  }
}

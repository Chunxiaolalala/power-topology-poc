/**
 * buffers.js —— GPU Buffer 创建与更新
 *
 * 缓冲清单：
 *   - uniformBuffer       ：每帧更新（viewProj / cameraPos / cameraRight / cameraUp / time / selectedId / hoverId）
 *   - cullUniformBuffer   ：每帧更新（6 个视锥平面 + 相机位置 + LOD 投影系数 + 节点数）
 *   - sphereHigh/Mid      ：两档球体几何（静态）
 *   - nodeInstanceBuffer  ：节点数据（STORAGE 读取 + 差分更新）
 *   - visibleBuffers      ：3 个可见索引列表（Compute 剔除结果）
 *   - counterBuffer       ：3 个原子计数器（Compute 剔除统计）
 *   - indirectBuffer      ：3 组 DrawIndexedIndirectArgs
 *   - lineVertexBuffer    ：连线顶点（静态）
 *   - quad 顶点/索引      ：billboard 粒子与远距离 LOD
 *   - flowInstanceBuffer  ：流光粒子 instance 数据（静态）
 *
 * Uniform 字节布局（112 字节，std140）：
 *   [0,64)   viewProj    mat4x4
 *   [64,76)  cameraPos   vec3
 *   [76,80)  time        f32
 *   [80,92)  cameraRight vec3
 *   [92,96)  selectedId  u32
 *   [96,108) cameraUp    vec3
 *   [108,112) hoverId    u32
 *
 * CullUniform 字节布局（128 字节）：
 *   [0,96)   planes[6]   vec4（xyz 法线，w 距离）
 *   [96,108) camPos      vec3
 *   [108,112) projScale  f32（像素投影系数 = 视口高 / (2·tan(fov/2))）
 *   [112,116) nodeCount  u32
 *   [116,120) tierHigh   f32（高模阈值，像素）
 *   [120,124) tierMid    f32（中模阈值，像素）
 */

import { STATUS_COLOR } from './mock-data.js';

/** Uniform 缓冲区大小（字节，取 128 以满足 16 字节对齐并留余量） */
export const UNIFORM_SIZE = 128;

/** Compute 剔除 uniform 大小 */
export const CULL_UNIFORM_SIZE = 128;

/** 单个节点 instance 步长（字节）：pos3 + scale + color3 + status = 32 */
export const NODE_INSTANCE_STRIDE = 32;

/** 单个流光粒子 instance 步长（字节）：from3 + to3 + flow + offset + color3 = 44 */
export const FLOW_INSTANCE_STRIDE = 44;

/** LOD 像素阈值（屏幕空间半径） */
export const LOD_TIER_HIGH_PX = 10;
export const LOD_TIER_MID_PX = 2.5;

// ---- 复用的临时数组（避免每帧 new，消除 320KB/帧 的 GC 压力） ----
const uniformScratchF32 = new Float32Array(UNIFORM_SIZE / 4);
const cullScratchF32 = new Float32Array(CULL_UNIFORM_SIZE / 4);
const cullScratchU32 = new Uint32Array(cullScratchF32.buffer);
const singleNodeScratch = new Float32Array(8);
let allNodesScratch = new Float32Array(0);

/**
 * 写入 uniform 数据
 */
export function writeUniforms(device, buffer, data) {
  const arr = uniformScratchF32;
  arr.fill(0);
  arr.set(data.viewProj, 0);
  arr[16] = data.cameraPos[0];
  arr[17] = data.cameraPos[1];
  arr[18] = data.cameraPos[2];
  arr[19] = data.time;
  arr[20] = data.cameraRight[0];
  arr[21] = data.cameraRight[1];
  arr[22] = data.cameraRight[2];
  arr[23] = data.selectedId;
  arr[24] = data.cameraUp[0];
  arr[25] = data.cameraUp[1];
  arr[26] = data.cameraUp[2];
  arr[27] = data.hoverId;

  device.queue.writeBuffer(buffer, 0, arr.buffer, arr.byteOffset, arr.byteLength);
}

/**
 * 写入 Compute 剔除 uniform
 * @param {{planes:Float32Array, cameraPos:number[], projScale:number, nodeCount:number, tierHigh?:number, tierMid?:number}} data
 */
export function writeCullUniforms(device, buffer, data) {
  const f = cullScratchF32;
  const u = cullScratchU32;
  f.fill(0);
  f.set(data.planes, 0);                       // 0..23
  f[24] = data.cameraPos[0];
  f[25] = data.cameraPos[1];
  f[26] = data.cameraPos[2];
  f[27] = data.projScale;
  u[28] = data.nodeCount >>> 0;
  f[29] = data.tierHigh ?? LOD_TIER_HIGH_PX;
  f[30] = data.tierMid ?? LOD_TIER_MID_PX;
  u[31] = 0;

  device.queue.writeBuffer(buffer, 0, f.buffer, f.byteOffset, f.byteLength);
}

/** 创建 uniform buffer */
export function createUniformBuffer(device) {
  return device.createBuffer({
    size: UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

/** 创建 Compute 剔除 uniform buffer */
export function createCullUniformBuffer(device) {
  return device.createBuffer({
    size: CULL_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

/**
 * 创建球体顶点 + 索引缓冲
 * @param {{positions:Float32Array, normals:Float32Array, indices:Uint16Array}} sphere
 */
export function createSphereBuffers(device, sphere) {
  const vertexCount = sphere.positions.length / 3;
  const vertexData = new Float32Array(vertexCount * 6);
  for (let i = 0; i < vertexCount; i++) {
    vertexData[i * 6 + 0] = sphere.positions[i * 3 + 0];
    vertexData[i * 6 + 1] = sphere.positions[i * 3 + 1];
    vertexData[i * 6 + 2] = sphere.positions[i * 3 + 2];
    vertexData[i * 6 + 3] = sphere.normals[i * 3 + 0];
    vertexData[i * 6 + 4] = sphere.normals[i * 3 + 1];
    vertexData[i * 6 + 5] = sphere.normals[i * 3 + 2];
  }

  const vertexBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexData);

  const indexBuffer = device.createBuffer({
    size: sphere.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, sphere.indices);

  return { vertexBuffer, indexBuffer, indexCount: sphere.indices.length };
}

/**
 * 创建节点数据缓冲
 * 布局：[x,y,z, scale, r,g,b, status] 共 8 floats = 32 bytes
 * 同时作为 VERTEX（兼容）与 STORAGE（顶点着色器按可见索引读取）使用。
 */
export function createNodeInstanceBuffer(device, count) {
  return device.createBuffer({
    size: count * NODE_INSTANCE_STRIDE,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

/** 全量写入节点数据（仅初始化时调用一次） */
export function writeNodeInstances(device, buffer, nodes) {
  const need = nodes.length * 8;
  if (allNodesScratch.length !== need) allNodesScratch = new Float32Array(need);
  const data = allNodesScratch;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const col = STATUS_COLOR[n.status] || STATUS_COLOR[0];
    const o = i * 8;
    data[o + 0] = n.position[0];
    data[o + 1] = n.position[1];
    data[o + 2] = n.position[2];
    data[o + 3] = n.scale;
    data[o + 4] = col[0];
    data[o + 5] = col[1];
    data[o + 6] = col[2];
    data[o + 7] = n.status;
  }
  device.queue.writeBuffer(buffer, 0, data);
}

/**
 * 差分写入单个节点（状态变化时调用，仅 32 字节）
 * @param {GPUBuffer} buffer
 * @param {number} index 节点下标
 * @param {object} n 节点
 */
export function writeNodeInstanceAt(device, buffer, index, n) {
  const col = STATUS_COLOR[n.status] || STATUS_COLOR[0];
  const d = singleNodeScratch;
  d[0] = n.position[0];
  d[1] = n.position[1];
  d[2] = n.position[2];
  d[3] = n.scale;
  d[4] = col[0];
  d[5] = col[1];
  d[6] = col[2];
  d[7] = n.status;
  device.queue.writeBuffer(buffer, index * NODE_INSTANCE_STRIDE, d);
}

/** 创建可见索引缓冲（Compute 剔除写入，顶点着色器读取） */
export function createVisibleBuffer(device, count) {
  return device.createBuffer({
    size: count * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

/** 创建原子计数器缓冲（3 个计数器 + 1 个 padding） */
export function createCounterBuffer(device) {
  return device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

/**
 * 创建间接绘制参数缓冲：3 组 DrawIndexedIndirectArgs（每组 20 字节）
 * @param {{high:number, mid:number, far:number}} indexCounts
 */
export function createIndirectBuffer(device, indexCounts) {
  const buffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  // indexCount / instanceCount(0 待 Compute 写入) / firstIndex / baseVertex / firstInstance
  const args = new Uint32Array(16);
  args[0] = indexCounts.high; args[1] = 0; args[2] = 0; args[3] = 0; args[4] = 0;
  args[5] = indexCounts.mid;  args[6] = 0; args[7] = 0; args[8] = 0; args[9] = 0;
  args[10] = indexCounts.far; args[11] = 0; args[12] = 0; args[13] = 0; args[14] = 0;
  device.queue.writeBuffer(buffer, 0, args);
  return buffer;
}

/** 创建连线顶点缓冲（pos3 + color3 交错，每线 2 顶点） */
export function createLineVertexBuffer(device, lineVertices) {
  const buffer = device.createBuffer({
    size: lineVertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, lineVertices);
  return buffer;
}

/** 创建粒子 quad 顶点 + 索引缓冲 */
export function createQuadBuffers(device, quad) {
  const vertexBuffer = device.createBuffer({
    size: quad.positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, quad.positions);

  const indexBuffer = device.createBuffer({
    size: quad.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, quad.indices);

  return { vertexBuffer, indexBuffer, indexCount: quad.indices.length };
}

/**
 * 生成流光粒子 instance 数据
 * 每条连线按 flowRate 分配粒子；连线数很大时自动降低每边粒子数，控制总填充率开销。
 * 布局：[fromX,fromY,fromZ, toX,toY,toZ, flow, offset, r,g,b] = 11 floats = 44 bytes
 */
export function buildFlowInstances(edges, nodeMap) {
  // 连线越多，单边粒子越少（原版上限 8）
  const perEdgeCap = edges.length > 30000 ? 1 : edges.length > 12000 ? 2 : 8;
  const list = [];
  for (const e of edges) {
    const from = nodeMap.get(e.from);
    const to = nodeMap.get(e.to);
    if (!from || !to) continue;
    const count = Math.max(1, Math.min(perEdgeCap, Math.ceil(e.flowRate * 8)));
    const col = STATUS_COLOR[e.status] || STATUS_COLOR[0];
    for (let i = 0; i < count; i++) {
      list.push(
        from.position[0], from.position[1], from.position[2],
        to.position[0], to.position[1], to.position[2],
        e.flowRate,
        i / count,
        col[0], col[1], col[2],
      );
    }
  }
  return { data: new Float32Array(list), count: list.length / 11 };
}

/** 创建流光粒子 instance buffer */
export function createFlowInstanceBuffer(device, flowData) {
  const buffer = device.createBuffer({
    size: flowData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, flowData);
  return buffer;
}

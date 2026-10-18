/**
 * pipelines.js —— WebGPU Pipeline 创建
 *
 * 渲染管线：
 *   1. nodePipeline      —— 节点（Storage 取实例数据，instanced 球体）
 *   2. billboardPipeline —— 远距离 LOD（相机朝向 impostor）
 *   3. linePipeline      —— 连线（LineList，半透明，深度测试不写）
 *   4. flowPipeline      —— 流光粒子（instanced billboard，加色混合）
 * 计算管线：
 *   5. cullPipeline      —— 视锥剔除 + LOD 分桶
 *   6. finalizePipeline  —— 写间接绘制参数
 */

import { nodeShader, billboardShader, lineShader, flowShader, cullShader, finalizeShader } from './shaders.js';

const DEPTH_FORMAT = 'depth24plus';

/** 创建节点管线（球体顶点 + Storage 实例数据，写深度） */
export function createNodePipeline(device, format) {
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({ code: nodeShader }),
      entryPoint: 'vs_node',
      buffers: [
        {
          // 球体顶点：position(3) + normal(3) = 24B
          arrayStride: 24,
          stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: nodeShader }),
      entryPoint: 'fs_node',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back',
    },
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  });
}

/** 创建远距离 LOD 管线（billboard impostor，写深度） */
export function createBillboardPipeline(device, format) {
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({ code: billboardShader }),
      entryPoint: 'vs_billboard',
      buffers: [
        {
          // quad 角点 float32x2 = 8B
          arrayStride: 8,
          stepMode: 'vertex',
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: billboardShader }),
      entryPoint: 'fs_billboard',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none',
    },
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  });
}

/** 创建连线管线（半透明，深度测试但不写深度） */
export function createLinePipeline(device, format) {
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({ code: lineShader }),
      entryPoint: 'vs_line',
      buffers: [
        {
          arrayStride: 24,
          stepMode: 'vertex',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: lineShader }),
      entryPoint: 'fs_line',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'line-list' },
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: false,
      depthCompare: 'less',
    },
  });
}

/** 创建流光粒子管线（加色混合，深度测试不写） */
export function createFlowPipeline(device, format) {
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({ code: flowShader }),
      entryPoint: 'vs_flow',
      buffers: [
        {
          arrayStride: 8,
          stepMode: 'vertex',
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
        },
        {
          arrayStride: 44,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 1, offset: 0, format: 'float32x3' },  // iFrom
            { shaderLocation: 2, offset: 12, format: 'float32x3' }, // iTo
            { shaderLocation: 3, offset: 24, format: 'float32' },   // iFlow
            { shaderLocation: 4, offset: 28, format: 'float32' },   // iOffset
            { shaderLocation: 5, offset: 32, format: 'float32x3' }, // iColor
          ],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: flowShader }),
      entryPoint: 'fs_flow',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: false,
      depthCompare: 'less',
    },
  });
}

/** 创建 Compute 剔除管线 */
export function createCullPipeline(device) {
  return device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: cullShader }),
      entryPoint: 'cs_cull',
    },
  });
}

/** 创建 Compute 收尾管线（写间接绘制参数） */
export function createFinalizePipeline(device) {
  return device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: finalizeShader }),
      entryPoint: 'cs_finalize',
    },
  });
}

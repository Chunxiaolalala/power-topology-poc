/**
 * device.js —— WebGPU 设备初始化与能力探测
 *
 * 职责：
 *   1. 检测 navigator.gpu，失败抛错（由 Vue 层展示降级提示）
 *   2. 请求 adapter / device，并在支持时申请 timestamp-query 特性
 *   3. 配置 canvas context 与 surface format
 */

/**
 * 初始化 WebGPU 设备
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<{device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat, adapter: GPUAdapter, timestampSupported: boolean}>}
 */
export async function initWebGPU(canvas) {
  // ---- 1. 能力检查 ----
  // 降级提示由 Vue 层捕获此错误后展示（noGpu 状态）
  if (!navigator.gpu) {
    throw new Error('WebGPU not supported');
  }

  // ---- 2. 请求适配器 ----
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('No GPU adapter found');
  }

  // ---- 3. 请求逻辑设备（按需申请 timestamp-query 用于分管线剖析） ----
  const requiredFeatures = [];
  if (adapter.features.has('timestamp-query')) {
    requiredFeatures.push('timestamp-query');
  }
  const device = await adapter.requestDevice({ requiredFeatures });
  const timestampSupported = requiredFeatures.includes('timestamp-query');

  // 监听未捕获的 GPU 错误（便于调试渲染问题）
  let errorCount = 0;
  device.onuncapturederror = (ev) => {
    errorCount++;
    console.error(`[WebGPU Error #${errorCount}]`, ev.error.message);
  };

  // ---- 4. 配置 canvas context ----
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
  });

  return { device, context, format, adapter, timestampSupported };
}

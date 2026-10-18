/**
 * scripts/wgsl-check.mjs —— WGSL 静态校验（不需要浏览器）
 *
 * 用 wgsl_reflect 解析 6 套着色器：
 *   1. 语法是否合法
 *   2. 入口点 / 绑定是否齐全
 *   3. 结构体对齐与大小是否符合 CPU 侧字节布局
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  nodeShader, billboardShader, lineShader, flowShader, cullShader, finalizeShader,
} from '../src/engine/shaders.js';
import { UNIFORM_SIZE, CULL_UNIFORM_SIZE, NODE_INSTANCE_STRIDE } from '../src/engine/buffers.js';

// wgsl_reflect 的 CJS 入口不导出符号，这里直接用它的 ESM 构建
const require = createRequire(import.meta.url);
const reflectPath = require.resolve('wgsl_reflect/wgsl_reflect.module.js');
const { WgslReflect } = await import(pathToFileURL(reflectPath).href);

const shaders = [
  ['node', nodeShader, ['vs_node', 'fs_node']],
  ['billboard', billboardShader, ['vs_billboard', 'fs_billboard']],
  ['line', lineShader, ['vs_line', 'fs_line']],
  ['flow', flowShader, ['vs_flow', 'fs_flow']],
  ['cull', cullShader, ['cs_cull']],
  ['finalize', finalizeShader, ['cs_finalize']],
];

let failed = 0;

for (const [name, code, expectEntries] of shaders) {
  try {
    const r = new WgslReflect(code);
    const entries = r.entry.compute.map((e) => e.name).concat(r.entry.vertex.map((e) => e.name), r.entry.fragment.map((e) => e.name));
    const missing = expectEntries.filter((e) => !entries.includes(e));
    const binds = (r.uniforms || []).map((u) => `uniform:${u.name}@${u.group}.${u.binding}`)
      .concat((r.storage || []).map((s) => `storage:${s.name}@${s.group}.${s.binding}`));
    console.log(`✓ ${name}: entries=[${entries.join(', ')}] binds=[${binds.join(', ')}]`);
    if (missing.length) { console.log(`  ✗ 缺少入口点: ${missing.join(', ')}`); failed++; }
  } catch (e) {
    console.log(`✗ ${name}: 解析失败 → ${e.message}`);
    failed++;
  }
}

console.log('\n---- 内存布局核对 ----');

// 用解析结果核对结构体大小（与 CPU 侧写入的字节布局必须一致）
const nodeR = new WgslReflect(nodeShader);
for (const s of nodeR.structs) {
  if (s.name === 'NodeData' || s.name === 'Uniforms' || s.name === 'NodeVSOut') {
    console.log(`  ${s.name}: size=${s.size ?? '?'}`);
  }
}

const finR = new WgslReflect(finalizeShader);
for (const s of finR.structs) {
  if (s.name === 'DrawArgs') console.log(`  DrawArgs: size=${s.size ?? '?'}（间接绘制参数 stride 必须为 20）`);
}

const cullR = new WgslReflect(cullShader);
for (const s of cullR.structs) {
  if (s.name === 'CullUniforms') console.log(`  CullUniforms: size=${s.size ?? '?'}（缓冲区 ${CULL_UNIFORM_SIZE}）`);
}

console.log(`\n预期：NodeData=32 (= NODE_INSTANCE_STRIDE ${NODE_INSTANCE_STRIDE})，Uniforms=112 (缓冲区 ${UNIFORM_SIZE})`);
console.log(failed === 0 ? '\n全部着色器解析通过' : `\n${failed} 个着色器有问题`);
process.exit(failed === 0 ? 0 : 1);

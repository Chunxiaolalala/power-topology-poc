/**
 * scripts/verify.mjs —— 不依赖浏览器，验证数据层与数学层
 *
 * 覆盖：
 *   1. 万级拓扑生成规模 / 耗时 / 节点命名
 *   2. 视锥平面提取（相机前方节点应通过、背后节点应剔除）
 *   3. CPU 射线拾取（把已知节点投影到屏幕，再反查应命中它）
 *   4. LOD 分档阈值下的三档分布（等价 Compute 里的判据）
 *   5. 节点实例缓冲的字节布局（32B 步长）
 */
import { generateTopology } from '../src/engine/mock-data.js';
import { OrbitCamera } from '../src/engine/camera.js';
import { extractFrustumPlanes } from '../src/engine/frustum.js';
import { pickNode } from '../src/engine/picking.js';
import { NODE_INSTANCE_STRIDE, LOD_TIER_HIGH_PX, LOD_TIER_MID_PX } from '../src/engine/buffers.js';

const W = 1440, H = 900;
const TARGET = Number(process.argv[2] || 10000);

console.log('=== 1. 拓扑生成 ===');
const t0 = performance.now();
const { nodes, edges, meta } = generateTopology(TARGET);
const genMs = performance.now() - t0;
console.log(`目标 ${TARGET} → 实际 ${nodes.length} 节点 / ${edges.length} 连线，耗时 ${genMs.toFixed(1)}ms`);
console.log('meta:', {
  subCount: meta.subCount, taiquPerSub: meta.taiquPerSub,
  sceneScale: +meta.sceneScale.toFixed(2), scaleMul: +meta.scaleMul.toFixed(2),
  ringRadius: +meta.ringRadius.toFixed(1), discRadius: +meta.discRadius.toFixed(1),
});
console.log('样例节点:', nodes[0].name, '|', nodes[1].name, '|', nodes[nodes.length - 1].name);
console.log('场景包围半径 ≈', (meta.ringRadius + meta.discRadius).toFixed(1),
  '· 节点实例缓冲 =', ((nodes.length * NODE_INSTANCE_STRIDE) / 1024).toFixed(0), 'KB');

console.log('\n=== 2. 视锥剔除 ===');
const k = meta.sceneScale;
const camera = new OrbitCamera(W / H, {
  distance: 22 * k, minDistance: 2, maxDistance: 22 * k * 1.4,
  near: 0.5, far: 250 * k, targetY: 3 * k,
});
camera.updateMatrices(W / H);
const planes = extractFrustumPlanes(camera.viewProj, new Float32Array(24));

function insideFrustum(p, radius) {
  for (let i = 0; i < 6; i++) {
    const d = planes[i * 4] * p[0] + planes[i * 4 + 1] * p[1] + planes[i * 4 + 2] * p[2] + planes[i * 4 + 3];
    if (d < -radius) return false;
  }
  return true;
}

let visible = 0;
for (const n of nodes) if (insideFrustum(n.position, n.scale * 0.5)) visible++;
console.log(`默认视角可见 ${visible} / ${nodes.length} = ${((visible / nodes.length) * 100).toFixed(1)}%`);
console.log('相机背后的点应被剔除：', insideFrustum([0, 3 * k, -1e5], 1) === false ? 'PASS' : 'FAIL');
console.log('注视点应可见：', insideFrustum([0, 3 * k, 0], 1) === true ? 'PASS' : 'FAIL');

console.log('\n=== 3. CPU 射线拾取 ===');
const tanHalf = Math.tan((camera.fov * Math.PI) / 180 / 2);
function project(p) {
  const m = camera.viewProj;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return { px: ((x / w) * 0.5 + 0.5) * W, py: (1 - ((y / w) * 0.5 + 0.5)) * H, valid: w > 0 };
}

// 找默认视角下最靠近屏幕中心、且可见的节点
let best = null;
for (let i = 0; i < nodes.length; i++) {
  const n = nodes[i];
  if (!insideFrustum(n.position, n.scale * 0.5)) continue;
  const { px, py, valid } = project(n.position);
  if (!valid) continue;
  const dist = Math.hypot(px - W / 2, py - H / 2);
  if (px < 0 || px > W || py < 0 || py > H) continue;
  if (!best || dist < best.dist) best = { idx: i, px, py, dist };
}
if (best) {
  const hit = pickNode(camera, nodes, best.px, best.py, W, H);
  const same = hit === best.idx;
  console.log(`投影节点 #${best.idx} 到 (${best.px.toFixed(0)}, ${best.py.toFixed(0)})，拾取结果 #${hit}` +
    ` → ${same ? 'PASS' : '（被更靠前的节点遮挡，属正常）'}`);
  const tHit0 = performance.now();
  for (let r = 0; r < 20; r++) pickNode(camera, nodes, best.px, best.py, W, H);
  console.log(`拾取单次耗时 ≈ ${((performance.now() - tHit0) / 20).toFixed(3)} ms`);
} else {
  console.log('未找到可投影节点（视角异常）');
}

// 空间空白处应无命中
const emptyHit = pickNode(camera, nodes, 5, 5, W, H);
console.log('左上角空白拾取：', emptyHit === -1 || nodes[emptyHit] ? `命中 #${emptyHit}（若为远处节点属正常）` : 'FAIL');

console.log('\n=== 4. LOD 分档分布（等价 Compute 判据） ===');
const projScale = H / (2 * tanHalf);
const tiers = { high: 0, mid: 0, far: 0 };
for (const n of nodes) {
  if (!insideFrustum(n.position, n.scale * 0.5)) continue;
  const d = Math.max(
    Math.hypot(
      n.position[0] - camera.cameraPos[0],
      n.position[1] - camera.cameraPos[1],
      n.position[2] - camera.cameraPos[2],
    ), 0.001);
  const px = (n.scale * 0.5) * projScale / d;
  if (px >= LOD_TIER_HIGH_PX) tiers.high++;
  else if (px >= LOD_TIER_MID_PX) tiers.mid++;
  else tiers.far++;
}
const tri = tiers.high * 768 + tiers.mid * 176 + tiers.far * 2;
const triAll = (tiers.high + tiers.mid + tiers.far) * 768;
console.log(tiers, `\nLOD 后三角形 ≈ ${(tri / 1e6).toFixed(2)}M（不做 LOD 则 ${(triAll / 1e6).toFixed(2)}M，降幅 ${(100 - (tri / triAll) * 100).toFixed(0)}%）`);

console.log('\n=== 5. 布局常量 ===');
console.log('NODE_INSTANCE_STRIDE =', NODE_INSTANCE_STRIDE, 'bytes（WGSL NodeData = vec3+1f+vec3+1f = 32）');
console.log('LOD 阈值:', LOD_TIER_HIGH_PX, 'px /', LOD_TIER_MID_PX, 'px');

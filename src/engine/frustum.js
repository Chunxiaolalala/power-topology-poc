/**
 * frustum.js —— 视锥平面提取
 *
 * 从 viewProj 矩阵提取 6 个裁剪平面（世界空间），供 Compute 剔除使用。
 * WebGPU 裁剪空间 z ∈ [0, 1]，因此近平面取 row2（而非 row3 + row2）。
 *
 * 平面形式：dot(normal, p) + d >= 0 表示点在视锥内。
 */

/**
 * 从列主序 viewProj 提取 6 个归一化平面，写入 out（长度 24）
 * 顺序：左 / 右 / 下 / 上 / 近 / 远
 * @param {Float32Array|number[]} m 列主序矩阵（gl-matrix）
 * @param {Float32Array} out
 */
export function extractFrustumPlanes(m, out) {
  // gl-matrix 列主序：m[col * 4 + row]
  const r0x = m[0], r0y = m[4], r0z = m[8], r0w = m[12];
  const r1x = m[1], r1y = m[5], r1z = m[9], r1w = m[13];
  const r2x = m[2], r2y = m[6], r2z = m[10], r2w = m[14];
  const r3x = m[3], r3y = m[7], r3z = m[11], r3w = m[15];

  const raw = [
    [r3x + r0x, r3y + r0y, r3z + r0z, r3w + r0w], // left
    [r3x - r0x, r3y - r0y, r3z - r0z, r3w - r0w], // right
    [r3x + r1x, r3y + r1y, r3z + r1z, r3w + r1w], // bottom
    [r3x - r1x, r3y - r1y, r3z - r1z, r3w - r1w], // top
    [r2x, r2y, r2z, r2w],                          // near (z >= 0)
    [r3x - r2x, r3y - r2y, r3z - r2z, r3w - r2w], // far  (z <= w)
  ];

  for (let i = 0; i < 6; i++) {
    const [a, b, c, d] = raw[i];
    const len = Math.hypot(a, b, c) || 1;
    out[i * 4 + 0] = a / len;
    out[i * 4 + 1] = b / len;
    out[i * 4 + 2] = c / len;
    out[i * 4 + 3] = d / len;
  }
  return out;
}

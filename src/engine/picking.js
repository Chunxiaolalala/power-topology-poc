/**
 * picking.js —— CPU 射线拾取
 *
 * 原实现是「把所有节点重新渲染到离屏纹理再读回 1 像素」，万级下每次拾取要画
 * 全部节点（7.7M 三角形）且 mapAsync 读回会串行化，鼠标一动就掉帧。
 *
 * 现在改为纯 CPU 解析求交：
 *   1. 像素坐标 → NDC → 相机空间方向 → 世界空间射线
 *   2. 与所有节点的包围球做 ray-sphere 求交，取最近命中
 *   复杂度 O(N)，万级约 0.1~0.2ms，且完全同步，没有 GPU 读回延迟。
 */

/**
 * 生成从相机出发、穿过指定像素的射线
 * @param {import('./camera.js').OrbitCamera} camera
 * @param {number} px 画布内像素 X
 * @param {number} py 画布内像素 Y
 * @param {number} width 画布宽
 * @param {number} height 画布高
 * @returns {{ox:number,oy:number,oz:number,dx:number,dy:number,dz:number}}
 */
export function makeRay(camera, px, py, width, height) {
  const aspect = width / height;
  const ndcX = (px / width) * 2 - 1;
  const ndcY = 1 - (py / height) * 2;

  const tanHalf = Math.tan((camera.fov * Math.PI) / 180 / 2);
  // cameraRight / cameraUp 为单位正交基，forward = up × right
  const r = camera.cameraRight;
  const u = camera.cameraUp;
  const fx = u[1] * r[2] - u[2] * r[1];
  const fy = u[2] * r[0] - u[0] * r[2];
  const fz = u[0] * r[1] - u[1] * r[0];

  let dx = fx + r[0] * ndcX * tanHalf * aspect + u[0] * ndcY * tanHalf;
  let dy = fy + r[1] * ndcX * tanHalf * aspect + u[1] * ndcY * tanHalf;
  let dz = fz + r[2] * ndcX * tanHalf * aspect + u[2] * ndcY * tanHalf;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;

  return { ox: camera.cameraPos[0], oy: camera.cameraPos[1], oz: camera.cameraPos[2], dx, dy, dz };
}

/**
 * 射线拾取最近节点
 * @param {import('./camera.js').OrbitCamera} camera
 * @param {Array} nodes
 * @param {number} px
 * @param {number} py
 * @param {number} width
 * @param {number} height
 * @returns {number} 命中节点下标，未命中返回 -1
 */
export function pickNode(camera, nodes, px, py, width, height) {
  const ray = makeRay(camera, px, py, width, height);
  let bestT = Infinity;
  let bestIdx = -1;

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const radius = n.scale * 0.5;
    const ox = n.position[0] - ray.ox;
    const oy = n.position[1] - ray.oy;
    const oz = n.position[2] - ray.oz;

    // 投影长度（沿射线方向的距离）
    const tca = ox * ray.dx + oy * ray.dy + oz * ray.dz;
    if (tca < 0) continue;

    // 球心到射线的垂距平方
    const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
    const r2 = radius * radius;
    if (d2 > r2) continue;

    const t = tca - Math.sqrt(r2 - d2);
    if (t < bestT) {
      bestT = t;
      bestIdx = i;
    }
  }

  return bestIdx;
}

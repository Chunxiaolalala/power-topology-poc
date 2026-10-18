/**
 * geometry.js —— 几何数据生成
 *
 * 提供三类几何的顶点/索引数据：
 *   1. createSphereGeometry()  —— 球体（节点用，24 段细分）
 *   2. createLineGeometry()    —— 连线（顶点 + 颜色，由调用方填充）
 *   3. createQuadGeometry()    —— 单位 quad（流光粒子 billboard 用）
 */

/**
 * 生成球体几何（经纬球）
 * @param {number} radius 半径
 * @param {number} widthSegments 经向分段
 * @param {number} heightSegments 纬向分段
 * @returns {{positions: Float32Array, normals: Float32Array, indices: Uint16Array}}
 */
export function createSphereGeometry(radius = 0.5, widthSegments = 24, heightSegments = 16) {
  const positions = [];
  const normals = [];
  const indices = [];

  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const phi = v * Math.PI; // 0 ~ PI
    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments;
      const theta = u * Math.PI * 2; // 0 ~ 2PI

      const sinPhi = Math.sin(phi);
      const nx = sinPhi * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = sinPhi * Math.sin(theta);

      positions.push(radius * nx, radius * ny, radius * nz);
      normals.push(nx, ny, nz);
    }
  }

  // 生成三角形索引
  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      indices.push(a, b, a + 1);
      indices.push(b, b + 1, a + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

/**
 * 生成单位 quad（中心在原点，边长 1，XY 平面）
 * 顶点顺序：左下、右下、右上、左上（配合 index 画两个三角形）
 * @returns {{positions: Float32Array, indices: Uint16Array}}
 */
export function createQuadGeometry() {
  // 四个角点（vec2），范围 [-0.5, 0.5]
  const positions = new Float32Array([
    -0.5, -0.5, // 0 左下
     0.5, -0.5, // 1 右下
     0.5,  0.5, // 2 右上
    -0.5,  0.5, // 3 左上
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  return { positions, indices };
}

/**
 * 根据连线数据生成 LineList 顶点缓冲（每线 2 顶点：position + color）
 * @param {Array} edges 连线数组
 * @param {Map<number, {position:number[], status:string}>} nodeMap 节点 id -> 节点
 * @returns {Float32Array} 交错顶点数据 [x,y,z, r,g,b, ...]
 */
export function buildLineVertices(edges, nodeMap) {
  // 每顶点 6 个 float (pos3 + color3)，每线 2 顶点
  const data = new Float32Array(edges.length * 2 * 6);
  const colorByStatus = {
    normal:  [0.47, 0.55, 0.71],  // 半透明灰
    warning: [0.96, 0.62, 0.04],
    fault:   [0.94, 0.27, 0.27],
  };

  let off = 0;
  for (const e of edges) {
    const from = nodeMap.get(e.from);
    const to = nodeMap.get(e.to);
    if (!from || !to) continue;
    const col = colorByStatus[e.status] || colorByStatus.normal;

    // 起点
    data[off++] = from.position[0];
    data[off++] = from.position[1];
    data[off++] = from.position[2];
    data[off++] = col[0]; data[off++] = col[1]; data[off++] = col[2];
    // 终点
    data[off++] = to.position[0];
    data[off++] = to.position[1];
    data[off++] = to.position[2];
    data[off++] = col[0]; data[off++] = col[1]; data[off++] = col[2];
  }
  return data;
}

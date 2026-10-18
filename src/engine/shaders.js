/**
 * shaders.js —— WGSL 着色器源码（以模板字符串内嵌）
 *
 * 1. node      —— 节点（Storage 读取 + Instancing + Blinn-Phong + 状态脉冲）
 * 2. billboard —— 远距离 LOD（相机朝向 impostor，2 三角形替代球体）
 * 3. line      —— 连线（LineList，半透明）
 * 4. flow      —— 流光粒子（Instance Billboard Quad，加色混合）
 * 5. cull      —— Compute 视锥剔除 + LOD 分桶（原子计数写入可见索引）
 * 6. finalize  —— Compute 把计数器结果写进间接绘制参数
 */

const UNIFORM_STRUCT = /* wgsl */ `
struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec3<f32>,
  time: f32,
  cameraRight: vec3<f32>,
  selectedId: u32,
  cameraUp: vec3<f32>,
  hoverId: u32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
`;

const NODE_DATA_STRUCT = /* wgsl */ `
struct NodeData {
  pos: vec3<f32>,
  scale: f32,
  color: vec3<f32>,
  status: f32,
};
`;

const NODE_FRAGMENT = /* wgsl */ `
@fragment
fn fs_node(v: NodeVSOut) -> @location(0) vec4<f32> {
  let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.8));
  let viewDir = normalize(u.cameraPos - v.worldPos);
  let normal = normalize(v.normal);
  let halfDir = normalize(lightDir + viewDir);

  let ambient = 0.25;
  let diff = max(dot(normal, lightDir), 0.0);
  let spec = pow(max(dot(normal, halfDir), 0.0), 32.0) * 0.5;

  var col = v.color * (ambient + diff * 0.8) + vec3<f32>(spec);

  // 状态脉冲：warning/fault 节点轻微呼吸发光
  if (v.status > 0.5) {
    let pulse = 0.15 + 0.1 * sin(u.time * 4.0);
    col = col + v.color * pulse;
  }

  // 选中/悬停高亮
  if (u.selectedId == v.vId || u.hoverId == v.vId) {
    col = col * 1.4 + vec3<f32>(0.15);
  }

  return vec4<f32>(col, 1.0);
}
`;

/* ============================================================
 * 节点着色器
 *   location 0: 球体 position
 *   location 1: 球体 normal
 *   实例数据来自 visible[iid] -> nodes[idx]
 * ============================================================ */
export const nodeShader = /* wgsl */ `
${UNIFORM_STRUCT}
${NODE_DATA_STRUCT}
@group(0) @binding(1) var<storage, read> nodes: array<NodeData>;
@group(0) @binding(2) var<storage, read> visible: array<u32>;

struct NodeVSIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
};

struct NodeVSOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) status: f32,
  @location(4) @interpolate(flat) vId: u32,
};

@vertex
fn vs_node(vin: NodeVSIn, @builtin(instance_index) iid: u32) -> NodeVSOut {
  let idx = visible[iid];
  let n = nodes[idx];
  var out: NodeVSOut;
  let worldPos = vin.position * n.scale + n.pos;
  out.clipPos = u.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.normal = vin.normal;
  out.color = n.color;
  out.status = n.status;
  out.vId = idx;
  return out;
}
${NODE_FRAGMENT}
`;

/* ============================================================
 * 远距离 LOD 着色器：相机朝向 billboard impostor
 *   location 0: quad 角点 [-0.5, 0.5]
 * ============================================================ */
export const billboardShader = /* wgsl */ `
${UNIFORM_STRUCT}
${NODE_DATA_STRUCT}
@group(0) @binding(1) var<storage, read> nodes: array<NodeData>;
@group(0) @binding(2) var<storage, read> visible: array<u32>;

struct BBOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) color: vec3<f32>,
  @location(3) status: f32,
  @location(4) @interpolate(flat) vId: u32,
};

@vertex
fn vs_billboard(@location(0) corner: vec2<f32>, @builtin(instance_index) iid: u32) -> BBOut {
  let idx = visible[iid];
  let n = nodes[idx];
  var out: BBOut;
  let dist = distance(u.cameraPos, n.pos);
  // 远处保证最小屏幕尺寸，避免节点消失
  let r = max(n.scale * 0.5, dist * 0.0016);
  let worldPos = n.pos + (u.cameraRight * corner.x + u.cameraUp * corner.y) * (r * 2.0);
  out.clipPos = u.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.uv = corner * 2.0;
  out.color = n.color;
  out.status = n.status;
  out.vId = idx;
  return out;
}

@fragment
fn fs_billboard(v: BBOut) -> @location(0) vec4<f32> {
  let d = length(v.uv);
  if (d > 1.0) { discard; }

  // 用屏幕基向量重建球面法线，保持与球体一致的受光感
  let nz = sqrt(max(0.0, 1.0 - d * d));
  let viewDir = normalize(u.cameraPos - v.worldPos);
  let normal = normalize(u.cameraRight * v.uv.x + u.cameraUp * v.uv.y - viewDir * nz);

  let lightDir = normalize(vec3<f32>(0.5, 1.0, 0.8));
  let halfDir = normalize(lightDir + viewDir);
  let ambient = 0.25;
  let diff = max(dot(normal, lightDir), 0.0);
  let spec = pow(max(dot(normal, halfDir), 0.0), 32.0) * 0.5;
  var col = v.color * (ambient + diff * 0.8) + vec3<f32>(spec);

  if (v.status > 0.5) {
    let pulse = 0.15 + 0.1 * sin(u.time * 4.0);
    col = col + v.color * pulse;
  }
  if (u.selectedId == v.vId || u.hoverId == v.vId) {
    col = col * 1.4 + vec3<f32>(0.15);
  }

  return vec4<f32>(col, 1.0);
}
`;

/* ============================================================
 * 连线着色器：LineList，无光照半透明
 * ============================================================ */
export const lineShader = /* wgsl */ `
${UNIFORM_STRUCT}

struct LineVSIn {
  @location(0) position: vec3<f32>,
  @location(1) color: vec3<f32>,
};
struct LineVSOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) color: vec3<f32>,
};

@vertex
fn vs_line(vin: LineVSIn) -> LineVSOut {
  var out: LineVSOut;
  out.clipPos = u.viewProj * vec4<f32>(vin.position, 1.0);
  out.color = vin.color;
  return out;
}

@fragment
fn fs_line(v: LineVSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(v.color, 0.4);
}
`;

/* ============================================================
 * 流光粒子：解析式运动（顶点着色器内按时间计算位置，零 CPU 开销）
 * ============================================================ */
export const flowShader = /* wgsl */ `
${UNIFORM_STRUCT}

struct FlowVSIn {
  @location(0) position: vec2<f32>,
  @location(1) iFrom: vec3<f32>,
  @location(2) iTo: vec3<f32>,
  @location(3) iFlow: f32,
  @location(4) iOffset: f32,
  @location(5) iColor: vec3<f32>,
};
struct FlowVSOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

@vertex
fn vs_flow(vin: FlowVSIn) -> FlowVSOut {
  var out: FlowVSOut;
  let speed = 0.05 + vin.iFlow * 0.35;
  let t = fract(u.time * speed + vin.iOffset);
  let center = mix(vin.iFrom, vin.iTo, t);

  let size = 0.12;
  let worldPos = center + (vin.position.x * u.cameraRight + vin.position.y * u.cameraUp) * size;
  out.clipPos = u.viewProj * vec4<f32>(worldPos, 1.0);
  out.color = vin.iColor;
  out.uv = vin.position;
  return out;
}

@fragment
fn fs_flow(v: FlowVSOut) -> @location(0) vec4<f32> {
  let d = length(v.uv * 2.0);
  let alpha = clamp(1.0 - d, 0.0, 1.0);
  if (alpha < 0.01) { discard; }
  return vec4<f32>(v.color, alpha);
}
`;

/* ============================================================
 * Compute：视锥剔除 + LOD 分桶
 *   每个线程处理一个节点：6 平面球体测试 → 按屏幕像素半径分三档
 *   → 原子计数器分配槽位 → 写入对应可见索引列表
 * ============================================================ */
export const cullShader = /* wgsl */ `
struct CullUniforms {
  planes: array<vec4<f32>, 6>,
  camPos: vec3<f32>,
  projScale: f32,
  nodeCount: u32,
  tierHigh: f32,
  tierMid: f32,
};
@group(0) @binding(0) var<uniform> cu: CullUniforms;
${NODE_DATA_STRUCT}
@group(0) @binding(1) var<storage, read> nodes: array<NodeData>;
@group(0) @binding(2) var<storage, read_write> visHigh: array<u32>;
@group(0) @binding(3) var<storage, read_write> visMid: array<u32>;
@group(0) @binding(4) var<storage, read_write> visFar: array<u32>;
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>, 4>;

@compute @workgroup_size(64)
fn cs_cull(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= cu.nodeCount) { return; }

  let n = nodes[i];
  let radius = n.scale * 0.5;

  // 视锥测试：任一面在球体外侧即剔除
  for (var p = 0u; p < 6u; p = p + 1u) {
    let pl = cu.planes[p];
    if (dot(pl.xyz, n.pos) + pl.w < -radius) { return; }
  }

  // LOD 分档：屏幕空间半径（像素）
  let dist = max(distance(cu.camPos, n.pos), 0.001);
  let px = radius * cu.projScale / dist;

  if (px >= cu.tierHigh) {
    let slot = atomicAdd(&counters[0], 1u);
    visHigh[slot] = i;
  } else if (px >= cu.tierMid) {
    let slot = atomicAdd(&counters[1], 1u);
    visMid[slot] = i;
  } else {
    let slot = atomicAdd(&counters[2], 1u);
    visFar[slot] = i;
  }
}
`;

/* ============================================================
 * Compute：把原子计数器结果写进 DrawIndexedIndirectArgs.instanceCount
 *   索引数 / firstIndex 等在创建缓冲时已预填，这里只更新实例数
 * ============================================================ */
export const finalizeShader = /* wgsl */ `
struct DrawArgs {
  indexCount: u32,
  instanceCount: u32,
  firstIndex: u32,
  baseVertex: i32,
  firstInstance: u32,
};

@group(0) @binding(0) var<storage, read> counters: array<u32, 4>;
@group(0) @binding(1) var<storage, read_write> args: array<DrawArgs, 3>;

@compute @workgroup_size(1)
fn cs_finalize() {
  args[0].instanceCount = counters[0];
  args[1].instanceCount = counters[1];
  args[2].instanceCount = counters[2];
}
`;

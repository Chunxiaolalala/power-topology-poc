/**
 * mock-data.js —— 电力拓扑 Mock 数据生成（万级可配置）
 *
 * 拓扑结构（3 层级联）：
 *   Layer 1：1 个主网节点（500kV）
 *   Layer 2：S 个变电站（220kV），环状分布
 *   Layer 3：每个变电站下挂 T 个台区（10kV），黄金角螺旋盘状分布
 *   合计：1 + S + S*T 个节点
 *
 * 规模化设计（相对原 209 节点版本）：
 *   - 台区盘半径 ∝ sqrt(T/25)，保证每节点可用面积基本恒定
 *   - 变电站环半径 ∝ S × 盘半径，保证扇区不重叠
 *   - sceneScale = 场景半径 / 15，相机距离、远处裁剪面、Y 层间距整体乘该系数
 *   - 节点自身 scale 乘 (N/209)^0.25，避免万级下节点在屏幕上退化成不可见点
 *
 * 状态码：0=normal, 1=warning, 2=fault
 */

/** 节点类型枚举 */
export const NODE_TYPE = {
  SUBSTATION: 'substation', // 变电站（含主网节点）
  FEEDER: 'feeder',         // 馈线
  SWITCH: 'switch',         // 开关
  TAIQU: 'taiqu',           // 台区
};

/** 状态码 -> 颜色（rgb 0~1） */
export const STATUS_COLOR = {
  0: [0.133, 0.827, 0.933], // normal  #22d3ee
  1: [0.961, 0.620, 0.043], // warning #f59e0b
  2: [0.937, 0.267, 0.267], // fault   #ef4444
};

/** 历史采样长度（仅对「被跟踪」的少数节点保留） */
export const HISTORY_LEN = 60;

const FIELD_NAMES = [
  '光谷', '汉口', '汉阳', '武昌', '青山', '沌口', '东西湖', '江夏',
  '黄陂', '新洲', '蔡甸', '江岸', '硚口', '洪山', '汉南', '阳逻',
];

/**
 * 简单确定性随机数生成器（Mulberry32），保证每次刷新拓扑一致
 */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fieldName(i) {
  const base = FIELD_NAMES[i % FIELD_NAMES.length];
  const round = Math.floor(i / FIELD_NAMES.length);
  return round === 0 ? base : `${base}${round + 1}号`;
}

/**
 * 生成完整拓扑数据
 * @param {number} targetNodes 目标节点数（约等于，实际由 S×T 决定）
 * @returns {{nodes: Array, edges: Array, nodeMap: Map, meta: object}}
 */
export function generateTopology(targetNodes = 10000) {
  const rand = mulberry32(20261016);
  const nodes = [];
  const edges = [];
  let id = 0;

  // ---------- 规模参数 ----------
  let subCount;
  let taiquPerSub;
  if (targetNodes <= 500) {
    // 与小规模原版保持一致，便于对比
    subCount = 8;
    taiquPerSub = 25;
  } else {
    subCount = Math.max(8, Math.min(64, Math.round(Math.sqrt(targetNodes / 40))));
    taiquPerSub = Math.max(1, Math.floor((targetNodes - subCount - 1) / subCount));
  }
  const total = 1 + subCount + subCount * taiquPerSub;

  // 台区盘半径：按「每节点可用面积≈原版」缩放
  const discRadius = 5.9 * Math.sqrt(taiquPerSub / 25);
  // 变电站环半径：保证相邻扇区不重叠
  const ringRadius = Math.max(11, (subCount * discRadius * 0.75) / Math.PI);
  // 场景整体缩放系数（原版半径约 15）
  const sceneScale = (ringRadius + discRadius) / 15;
  // 节点尺寸补偿，避免万级下节点退化为不可见像素
  const scaleMul = Math.max(1, Math.min(6, Math.pow(total / 209, 0.25)));

  const yMain = 9 * sceneScale;
  const ySub = 4 * sceneScale;
  const yTaiqu = -1 * sceneScale;

  // ---------- Layer 1：主网节点 ----------
  const mainId = id++;
  nodes.push({
    id: mainId,
    name: '华中·500kV 主网枢纽',
    type: NODE_TYPE.SUBSTATION,
    layer: 1,
    position: [0, yMain, 0],
    scale: 1.6 * scaleMul,
    voltage: 500,
    current: 3000,
    power: 1500,
    temperature: 52,
    load: 0.65,
    status: 0,
  });

  // ---------- Layer 2：变电站（中层环） ----------
  const subIds = [];
  for (let i = 0; i < subCount; i++) {
    const angle = (i / subCount) * Math.PI * 2;
    const sid = id++;
    subIds.push(sid);
    nodes.push({
      id: sid,
      name: `${fieldName(i)}变电站`,
      type: NODE_TYPE.SUBSTATION,
      layer: 2,
      position: [Math.cos(angle) * ringRadius, ySub, Math.sin(angle) * ringRadius],
      scale: 1.1 * scaleMul,
      voltage: 220,
      current: 1200 + rand() * 400,
      power: 264 + rand() * 100,
      temperature: 40 + rand() * 15,
      load: 0.5 + rand() * 0.4,
      status: 0,
    });
    edges.push({
      id: edges.length, from: mainId, to: sid,
      capacity: 800, currentFlow: 264, flowRate: 0.33, status: 0,
    });
  }

  // ---------- Layer 3：台区（黄金角螺旋，盘内均匀分布） ----------
  const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996
  for (let s = 0; s < subCount; s++) {
    const sub = nodes[subIds[s]];
    const shortName = fieldName(s).replace('变电站', '');
    const baseAngle = (s / subCount) * Math.PI * 2;
    for (let t = 0; t < taiquPerSub; t++) {
      const tid = id++;
      const r = discRadius * Math.sqrt((t + 0.5) / taiquPerSub);
      const a = baseAngle + t * GOLDEN;
      const x = sub.position[0] + Math.cos(a) * r;
      const z = sub.position[2] + Math.sin(a) * r;
      const y = yTaiqu - (t % 3) * 0.4 * sceneScale;

      nodes.push({
        id: tid,
        name: `${shortName}·台区${t + 1}`,
        type: NODE_TYPE.TAIQU,
        layer: 3,
        position: [x, y, z],
        scale: 0.55 * scaleMul,
        voltage: 10,
        current: 200 + rand() * 150,
        power: 2 + rand() * 3,
        temperature: 35 + rand() * 20,
        load: 0.3 + rand() * 0.6,
        status: 0,
      });
      edges.push({
        id: edges.length, from: subIds[s], to: tid,
        capacity: 10, currentFlow: 2 + rand() * 5,
        flowRate: 0.2 + rand() * 0.6, status: 0,
      });
    }
  }

  // ---------- 跨站互联 ----------
  const crossTarget = Math.min(300, Math.max(20, Math.round(subCount * 4)));
  let crossCount = 0;
  const tried = new Set();
  let guard = 0;
  while (crossCount < crossTarget && guard++ < crossTarget * 50) {
    const a = subIds[Math.floor(rand() * subCount)];
    const b = subIds[Math.floor(rand() * subCount)];
    if (a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (tried.has(key)) continue;
    tried.add(key);
    edges.push({
      id: edges.length, from: a, to: b,
      capacity: 500, currentFlow: 100 + rand() * 200,
      flowRate: 0.2 + rand() * 0.5, status: 0,
    });
    crossCount++;
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return {
    nodes, edges, nodeMap,
    meta: {
      sceneScale,
      subCount,
      taiquPerSub,
      scaleMul,
      ringRadius,
      discRadius,
      nodeCount: nodes.length,
    },
  };
}

/**
 * 为节点挂上趋势历史（只对被跟踪的少数节点创建，避免万级下 3×N 个数组）
 * @param {object} node
 */
export function ensureHistory(node) {
  if (!node.history) {
    node.history = { voltage: [], temperature: [], load: [] };
    for (let i = 0; i < HISTORY_LEN; i++) {
      // 用当前值填充，避免趋势图出现空轴
      node.history.voltage.push(node.voltage);
      node.history.temperature.push(node.temperature);
      node.history.load.push(node.load);
    }
  }
  return node.history;
}

/**
 * 实时数据 tick：每 500ms 调用一次
 *   - 电压 ±2%、负载 ±5%、温度 ±1℃
 *   - 每隔 5~10s 随机产生 1 个告警节点
 *   - 每隔 30s 随机产生 1 个故障节点
 *
 * 性能要点：
 *   - 历史采样只写 tracked（被选中过的少数节点），不再对全部节点做 push/shift
 *   - 返回状态发生变化的节点下标，供上层做「差分缓冲更新」
 *
 * @param {Array} nodes
 * @param {number} elapsedMs 累计毫秒
 * @param {Set<number>} tracked 需要记录历史的节点下标集合
 * @returns {number[]} 状态变化的节点下标
 */
export function tickRealtimeData(nodes, elapsedMs, tracked) {
  const changed = [];

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    n.voltage = clamp(n.voltage * (1 + (Math.random() - 0.5) * 0.04), n.voltage * 0.9, n.voltage * 1.1);
    n.load = clamp(n.load + (Math.random() - 0.5) * 0.1, 0.1, 0.98);
    n.temperature = clamp(n.temperature + (Math.random() - 0.5) * 2, 20, 85);

    // 历史趋势（仅跟踪节点，最多 60 个采样）
    if (tracked && tracked.has(i) && n.history) {
      pushHistory(n.history.voltage, n.voltage);
      pushHistory(n.history.temperature, n.temperature);
      pushHistory(n.history.load, n.load);
    }

    // 自然恢复：告警/故障节点有概率回到 normal
    if (n.status !== 0 && Math.random() < 0.05) {
      n.status = 0;
      changed.push(i);
    }
  }

  // 每 ~7s 触发一次告警
  if (Math.floor(elapsedMs / 7000) !== Math.floor((elapsedMs - 500) / 7000)) {
    const idx = Math.floor(Math.random() * nodes.length);
    if (nodes[idx].status === 0) {
      nodes[idx].status = 1;
      changed.push(idx);
    }
  }

  // 每 ~30s 触发一次故障
  if (Math.floor(elapsedMs / 30000) !== Math.floor((elapsedMs - 500) / 30000)) {
    const idx = Math.floor(Math.random() * nodes.length);
    nodes[idx].status = 2;
    changed.push(idx);
  }

  return changed;
}

function pushHistory(arr, v) {
  arr.push(v);
  if (arr.length > HISTORY_LEN) arr.shift();
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

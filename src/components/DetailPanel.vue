<script setup>
/**
 * DetailPanel.vue —— 右下角详情面板
 *
 * 两种状态：
 *   1. 未选中节点 → 项目简介（等价原 ui.showIntro）
 *   2. 选中节点   → 节点信息 + 实时指标卡 + ECharts 趋势图 + AI 诊断（等价原 ui.showNodeDetail）
 * 实时刷新由 metricsTick 驱动（等价原 ui.updateNodeMetrics）。
 */
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { createChartController } from '../charts/chartController.js';
import { diagnoseNode } from '../ai/diagnose.js';

const props = defineProps({
  node: { type: Object, default: null },
  intro: { type: Object, required: true },
  metricsTick: { type: Number, default: 0 },
});

const STATUS_LABEL = { 0: '正常', 1: '告警', 2: '故障' };
const STATUS_CLASS = { 0: 'normal', 1: 'warning', 2: 'fault' };
const TYPE_LABEL = {
  substation: '变电站',
  feeder: '馈线',
  switch: '开关',
  taiqu: '台区',
};
const LAYER_LABEL = { 1: '主网 500kV', 2: '变电站 220kV', 3: '台区 10kV' };

// ---- 实时指标卡（依赖 metricsTick，每 500ms 刷新一次） ----
const metrics = computed(() => {
  const n = props.node;
  props.metricsTick; // 建立依赖：引擎 tick 后重新计算
  if (!n) return null;
  return {
    voltage: n.voltage.toFixed(1),
    current: n.current.toFixed(0),
    power: n.power.toFixed(1),
    temp: n.temperature.toFixed(1),
    load: (n.load * 100).toFixed(0) + '%',
  };
});

// ---- ECharts 趋势图 ----
const chartEl = ref(null);
const chart = createChartController();

watch(() => props.node, async (node) => {
  aiState.value = 'idle';
  aiResult.value = '';
  if (node) {
    await nextTick(); // 等待 #chart-container 渲染完成
    chart.render(node, chartEl.value);
  } else {
    chart.dispose();
  }
});

watch(() => props.metricsTick, () => {
  if (props.node) chart.update(props.node);
});

onBeforeUnmount(() => chart.dispose());

// ---- AI 异常诊断 ----
const aiState = ref('idle'); // idle | loading | done
const aiResult = ref('');

async function runDiagnose() {
  if (!props.node) return;
  aiState.value = 'loading';
  aiResult.value = '';
  const text = await diagnoseNode(props.node);
  aiResult.value = text;
  aiState.value = 'done';
}
</script>

<template>
  <aside class="detail-panel">
    <div class="panel-title">详情</div>
    <div id="detail-content">
      <!-- 默认简介 -->
      <div v-if="!node" class="detail-info">
        <div class="intro">
          <b>电力实时拓扑可视化 POC</b><br />
          基于原生 WebGPU + WGSL 实现的三维电力节点拓扑实时可视化 Demo。
        </div>
        <ul class="tech-list">
          <li>原生 WebGPU API（无 Three.js）</li>
          <li>Compute 剔除 + 三级 LOD + 间接绘制</li>
          <li>{{ intro.nodeCount }} 节点 · CPU 射线拾取</li>
          <li>Timestamp Query 分管线剖析</li>
        </ul>
        <div style="margin-top:10px;font-size:12px;color:#94a3b8;">
          WebGPU 支持：<span :style="{ color: intro.webgpuSupported ? '#22d3ee' : '#ef4444' }">{{ intro.webgpuSupported ? '是' : '否' }}</span><br />
          GPU 适配器：{{ intro.adapterName || '未知' }}
        </div>
        <div style="margin-top:10px;font-size:12px;color:#64748b;">
          点击任意节点查看实时指标与趋势图。
        </div>
      </div>

      <!-- 节点详情 -->
      <template v-else>
        <table class="node-info-table">
          <tr><td>名称</td><td><b>{{ node.name }}</b></td></tr>
          <tr><td>类型</td><td>{{ TYPE_LABEL[node.type] || node.type }}</td></tr>
          <tr><td>层级</td><td>{{ LAYER_LABEL[node.layer] || node.layer }}</td></tr>
          <tr><td>状态</td><td>
            <span class="status-badge" :class="STATUS_CLASS[node.status]">{{ STATUS_LABEL[node.status] }}</span>
          </td></tr>
        </table>

        <div class="metric-cards">
          <div class="metric-card"><div class="label">电压 (kV)</div><div class="value">{{ metrics.voltage }}</div></div>
          <div class="metric-card"><div class="label">电流 (A)</div><div class="value">{{ metrics.current }}</div></div>
          <div class="metric-card"><div class="label">功率 (MW)</div><div class="value">{{ metrics.power }}</div></div>
          <div class="metric-card"><div class="label">温度 (℃)</div><div class="value">{{ metrics.temp }}</div></div>
          <div class="metric-card"><div class="label">负载</div><div class="value">{{ metrics.load }}</div></div>
        </div>

        <div id="chart-container" ref="chartEl"></div>

        <button class="ai-btn" @click="runDiagnose">🤖 AI 异常诊断</button>
        <div v-if="aiState === 'loading'" style="color:#8b5cf6;">⏳ 正在分析节点数据...</div>
        <div v-else-if="aiState === 'done'" class="ai-result" v-html="aiResult"></div>
      </template>
    </div>
  </aside>
</template>

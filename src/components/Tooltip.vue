<script setup>
/** Tooltip.vue —— 鼠标悬停 Tooltip（等价原 ui.showTooltip / hideTooltip） */
import { computed } from 'vue';

const props = defineProps({
  tooltip: { type: Object, required: true }, // { show, x, y, node }
});

const STATUS_LABEL = { 0: '正常', 1: '告警', 2: '故障' };
const STATUS_CLASS = { 0: 'normal', 1: 'warning', 2: 'fault' };

const statusColor = computed(() => {
  const cls = props.tooltip.node ? STATUS_CLASS[props.tooltip.node.status] : 'normal';
  return cls === 'fault' ? '#ef4444' : cls === 'warning' ? '#f59e0b' : '#22d3ee';
});

// 空值兜底：node 未就绪时渲染空内容，避免模板表达式对 null 取属性
const node = computed(() => props.tooltip.node || { name: '', voltage: 0, load: 0, status: 0 });
</script>

<template>
  <!-- 注意用 v-if 而非 v-show：node 为 null 时完全不渲染，避免对 null 取属性 -->
  <div
    v-if="tooltip.show && tooltip.node"
    class="tooltip"
    :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px', borderColor: statusColor }"
  >
    <div class="t-name">{{ node.name }}</div>
    <div class="t-row">电压 {{ node.voltage.toFixed(1) }} kV · 负载 {{ (node.load * 100).toFixed(0) }}%</div>
    <div class="t-row" :style="{ color: statusColor }">{{ STATUS_LABEL[node.status] }}</div>
  </div>
</template>

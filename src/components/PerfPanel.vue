<script setup>
/** PerfPanel.vue —— 右上角性能监控面板（含 Timestamp 分管线耗时） */
defineProps({
  perf: { type: Object, required: true },
});

/** 毫秒格式化：< 1ms 显示两位小数 */
function fmt(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v)) return '--';
  return `${v < 1 ? v.toFixed(2) : v.toFixed(1)} ms`;
}
</script>

<template>
  <aside class="perf-panel">
    <div class="panel-title">性能监控</div>
    <div class="perf-row"><span>帧率 FPS</span><span>{{ perf.fps }}</span></div>
    <div class="perf-row"><span>节点数</span><span>{{ perf.nodes }}</span></div>
    <div class="perf-row"><span>连线数</span><span>{{ perf.edges }}</span></div>
    <div class="perf-row"><span>粒子数</span><span>{{ perf.particles }}</span></div>
    <div class="perf-row"><span>帧耗时</span><span>{{ perf.frameMs }}</span> ms</div>
    <div class="perf-row"><span>GPU 适配器</span><span class="adapter">{{ perf.adapter }}</span></div>

    <div class="panel-title" style="margin-top:10px;">管线耗时</div>
    <template v-if="perf.timingsSupported && perf.timings">
      <div class="perf-row"><span>Compute 剔除</span><span>{{ fmt(perf.timings.cull) }}</span></div>
      <div class="perf-row"><span>写间接参数</span><span>{{ fmt(perf.timings.finalize) }}</span></div>
      <div class="perf-row"><span>节点 LOD</span><span>{{ fmt(perf.timings.nodes) }}</span></div>
      <div class="perf-row"><span>连线</span><span>{{ fmt(perf.timings.lines) }}</span></div>
      <div class="perf-row"><span>流光粒子</span><span>{{ fmt(perf.timings.flow) }}</span></div>
      <div class="perf-row"><span>GPU 合计</span><span>{{ fmt(perf.timings.total) }}</span></div>
    </template>
    <div v-else-if="perf.timingsSupported" class="perf-row"><span>采样中…</span><span>--</span></div>
    <div v-else class="perf-row"><span class="adapter">不支持 timestamp-query</span><span></span></div>
  </aside>
</template>

<script setup>
/**
 * App.vue —— 应用根组件
 *
 * DOM 结构与改造前的 index.html 完全一致：
 *   降级提示 / WebGPU 画布 / 顶栏 / 图例 / 性能面板 / 详情面板 / Tooltip / 底栏
 * 引擎编排逻辑由 useEngine composable 提供（与原 js/main.js 一一对应）。
 */
import TopBar from './components/TopBar.vue';
import Legend from './components/Legend.vue';
import PerfPanel from './components/PerfPanel.vue';
import DetailPanel from './components/DetailPanel.vue';
import Tooltip from './components/Tooltip.vue';
import { useEngine } from './composables/useEngine.js';

const {
  canvasEl, noGpu, perf, intro, selectedNode, metricsTick,
  tooltip, paused,
  globalView, focusFault, togglePause,
} = useEngine();
</script>

<template>
  <!-- 降级提示：不支持 WebGPU 时显示 -->
  <div class="fallback" :class="{ show: noGpu }">
    <h1>您的浏览器不支持 WebGPU</h1>
    <p>请使用 Chrome / Edge 113+ 访问本 Demo。</p>
    <a href="https://www.google.cn/chrome/" target="_blank">下载 Chrome</a>
  </div>

  <!-- WebGPU 渲染画布 -->
  <canvas ref="canvasEl" id="gpu-canvas"></canvas>

  <!-- 顶栏 -->
  <TopBar
    :paused="paused"
    @global-view="globalView"
    @fault-focus="focusFault"
    @toggle-pause="togglePause"
  />

  <!-- 左下角图例 -->
  <Legend />

  <!-- 右上角性能面板 -->
  <PerfPanel :perf="perf" />

  <!-- 右下角详情面板 -->
  <DetailPanel :node="selectedNode" :intro="intro" :metrics-tick="metricsTick" />

  <!-- 鼠标悬停 Tooltip -->
  <Tooltip :tooltip="tooltip" />

  <!-- 底栏操作提示 -->
  <footer class="bottombar">
    拖拽旋转 · 右键平移 · 滚轮缩放 · 点击节点查看详情 · 键盘 1/2/3 切换层级
  </footer>
</template>

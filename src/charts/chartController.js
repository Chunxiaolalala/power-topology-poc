/**
 * chartController.js —— 节点趋势图（ECharts）
 *
 * 渲染过去 60 个采样点的「电压」与「温度」双折线图。
 * 依赖 npm 安装的 echarts（Vue 3 + Vite 构建）。
 */

import * as echarts from 'echarts';

export function createChartController() {
  let chart = null;

  /**
   * 渲染趋势图（节点详情面板打开时调用）
   * @param {object} node
   * @param {HTMLElement} dom 图表容器
   */
  function render(node, dom) {
    if (!dom) return;
    if (chart) chart.dispose();
    chart = echarts.init(dom);
    update(node);
  }

  /**
   * 实时更新趋势图数据
   */
  function update(node) {
    if (!chart) return;
    const times = node.history.voltage.map((_, i) => `${(60 - i)}s前`).reverse();
    chart.setOption({
      backgroundColor: 'transparent',
      grid: { left: 40, right: 40, top: 20, bottom: 24 },
      tooltip: { trigger: 'axis' },
      legend: {
        data: ['电压(kV)', '温度(℃)'],
        textStyle: { color: '#94a3b8', fontSize: 11 },
        top: 0,
      },
      xAxis: {
        type: 'category',
        data: times,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#64748b', fontSize: 10, interval: 9 },
      },
      yAxis: [
        {
          type: 'value',
          name: '电压',
          nameTextStyle: { color: '#22d3ee', fontSize: 10 },
          axisLine: { show: false },
          axisLabel: { color: '#64748b', fontSize: 10 },
          splitLine: { lineStyle: { color: 'rgba(120,140,180,0.1)' } },
        },
        {
          type: 'value',
          name: '温度',
          nameTextStyle: { color: '#f59e0b', fontSize: 10 },
          axisLine: { show: false },
          axisLabel: { color: '#64748b', fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '电压(kV)',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: [...node.history.voltage].reverse(),
          lineStyle: { color: '#22d3ee', width: 2 },
          itemStyle: { color: '#22d3ee' },
          areaStyle: { color: 'rgba(34,211,238,0.1)' },
        },
        {
          name: '温度(℃)',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          data: [...node.history.temperature].reverse(),
          lineStyle: { color: '#f59e0b', width: 2 },
          itemStyle: { color: '#f59e0b' },
        },
      ],
    });
  }

  /** 销毁 */
  function dispose() {
    if (chart) { chart.dispose(); chart = null; }
  }

  return { render, update, dispose };
}

/**
 * ai-diagnose.js —— 模拟 LLM 异常诊断
 *
 * 点击「AI 异常诊断」按钮后，1 秒延迟返回一段基于规则模板生成的诊断文本。
 * 指定诊断规则后可接入真实大模型 API 调用。
 */

const STATUS_LABEL = { 0: '正常', 1: '告警', 2: '故障' };

/**
 * 根据节点实时指标生成诊断文本
 * @param {object} node
 * @returns {Promise<string>}
 */
export function diagnoseNode(node) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const lines = [];
      lines.push(`【节点】${node.name}`);
      lines.push(`【状态】${STATUS_LABEL[node.status]}`);
      lines.push('');

      // 规则模板：温度过高
      if (node.temperature > 70) {
        lines.push(`⚠️ 温度异常：当前 ${node.temperature.toFixed(1)}℃，超过 70℃ 阈值。`);
        lines.push('   建议：检查冷却系统，必要时降低负载。');
      } else if (node.temperature > 60) {
        lines.push(`⚡ 温度偏高：${node.temperature.toFixed(1)}℃，需持续关注。`);
      }

      // 规则模板：负载过高
      if (node.load > 0.9) {
        lines.push(`⚠️ 负载过载：当前 ${(node.load * 100).toFixed(0)}%，接近满载。`);
        lines.push('   建议：启动负荷转移，避免设备过载损坏。');
      } else if (node.load > 0.8) {
        lines.push(`⚡ 负载偏高：${(node.load * 100).toFixed(0)}%，注意负荷分配。`);
      }

      // 规则模板：电压波动
      const baseVoltage = node.layer === 1 ? 500 : node.layer === 2 ? 220 : 10;
      const deviation = Math.abs(node.voltage - baseVoltage) / baseVoltage;
      if (deviation > 0.05) {
        lines.push(`⚠️ 电压偏差：当前 ${node.voltage.toFixed(1)}kV，偏离额定 ${(deviation * 100).toFixed(1)}%。`);
        lines.push('   建议：检查无功补偿装置与有载调压开关。');
      }

      // 故障状态直接告警
      if (node.status === 2) {
        lines.push('');
        lines.push('🔴 该节点处于故障状态，建议立即派发现场检修工单。');
      } else if (lines.length <= 2) {
        lines.push('✅ 各项指标正常，未发现明显异常。');
      }

      resolve(lines.join('<br/>'));
    }, 1000);
  });
}

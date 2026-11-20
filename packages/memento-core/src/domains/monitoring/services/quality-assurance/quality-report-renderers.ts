import type { QualityReport } from './quality-reporter.js';

export function generateMarkdownReport(reportData: QualityReport): string {
  const { summary, latest_metrics, warnings, history } = reportData;
  const statusEmoji = {
    pass: '✅',
    warning: '⚠️',
    fail: '❌',
    no_threshold: '➖',
    unmeasured: '❔'
  };

  let markdown = `# Quality Assurance Report\n\n`;
  markdown += `**생성 일시**: ${reportData.generated_at}\n`;
  markdown += `**전체 상태**: ${statusEmoji[summary.overall_status]} ${summary.overall_status.toUpperCase()}\n\n`;
  markdown += `---\n\n`;

  markdown += `## 요약\n\n`;
  markdown += `| 항목 | 값 |\n`;
  markdown += `|------|-----|\n`;
  markdown += `| **전체 상태** | ${statusEmoji[summary.overall_status]} ${summary.overall_status.toUpperCase()} |\n`;
  markdown += `| **총 지표 수** | ${summary.total_metrics} |\n`;
  markdown += `| **통과 지표** | ${summary.passed_metrics} |\n`;
  markdown += `| **실패 지표** | ${summary.failed_metrics} |\n`;
  markdown += `| **경고 지표** | ${summary.warning_metrics} |\n`;
  markdown += `| **임계값 없음 지표** | ${summary.no_threshold_metrics} |\n`;
  markdown += `| **미측정 지표** | ${summary.unmeasured_metrics} |\n\n`;

  if (summary.namespace_status.length > 0) {
    markdown += `## 네임스페이스별 상태\n\n`;
    markdown += `| 네임스페이스 | 상태 | 지표 수 | 통과 | 실패 | 임계값 없음 | 미측정 |\n`;
    markdown += `|-------------|------|---------|------|------|------------|--------|\n`;
    for (const ns of summary.namespace_status) {
      markdown += `| **${ns.namespace}** | ${statusEmoji[ns.status]} ${ns.status.toUpperCase()} | ${ns.metrics_count} | ${ns.passed_count} | ${ns.failed_count} | ${ns.no_threshold_count} | ${ns.unmeasured_count} |\n`;
    }
    markdown += `\n`;
  }

  if (warnings.length > 0) {
    markdown += `## ⚠️ 경고\n\n`;
    markdown += `| 네임스페이스 | 지표 | 측정값 | 임계값 | 차이 |\n`;
    markdown += `|-------------|------|--------|--------|------|\n`;
    for (const warning of warnings) {
      markdown += `| ${warning.metric_namespace} | ${warning.metric_key} | ${warning.measured_value.toFixed(3)} | ${warning.threshold_value.toFixed(3)} (${warning.threshold_type}) | ${warning.difference > 0 ? '+' : ''}${warning.difference.toFixed(3)} |\n`;
    }
    markdown += `\n`;
  }

  if (latest_metrics.length > 0) {
    markdown += `## 최신 품질 지표\n\n`;
    markdown += `| 네임스페이스 | 지표 | 값 | 상태 | 임계값 | 측정 시간 |\n`;
    markdown += `|-------------|------|-----|------|--------|----------|\n`;
    for (const metric of latest_metrics) {
      const statusIcon = statusEmoji[metric.status as keyof typeof statusEmoji] || '❓';
      const thresholdStr = metric.threshold_value !== null
        ? `${metric.threshold_value.toFixed(3)} (${metric.threshold_type})`
        : 'N/A';
      const valueStr = metric.metric_value === null
        ? `미측정 (${metric.measurement_state ?? 'unknown'})`
        : metric.measurement_state === 'unknown_legacy'
          ? `${metric.metric_value.toFixed(3)} (legacy, 상태 불명)`
          : metric.metric_value.toFixed(3);
      markdown += `| ${metric.metric_namespace} | ${metric.metric_key} | ${valueStr} | ${statusIcon} ${metric.status.toUpperCase()} | ${thresholdStr} | ${metric.measured_at} |\n`;
    }
    markdown += `\n`;
  }

  if (history.length > 0) {
    markdown += `## 측정 이력 (최근 ${history.length}개)\n\n`;
    markdown += `| ID | 타입 | 네임스페이스 | 컨텍스트 | 상태 | 측정 시간 |\n`;
    markdown += `|----|------|-------------|----------|------|----------|\n`;
    for (const h of history.slice(0, 20)) {
      const statusIcon = h.status === 'success' ? '✅' : h.status === 'warning' ? '⚠️' : '❌';
      markdown += `| ${h.id.substring(0, 20)}... | ${h.measurement_type} | ${h.namespace || 'N/A'} | ${h.context || 'N/A'} | ${statusIcon} ${h.status} | ${h.measured_at} |\n`;
    }
    markdown += `\n`;
  }

  return markdown;
}

export function generateJsonReport(reportData: QualityReport): string {
  return JSON.stringify(reportData, null, 2);
}

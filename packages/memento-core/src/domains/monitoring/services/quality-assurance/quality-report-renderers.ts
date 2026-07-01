import { promises as fsPromises } from 'fs';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { logger } from '../../../../shared/utils/logger.js';
import type { QualityReport } from './quality-reporter.js';

/** HTML에 삽입되는 동적 값을 이스케이프하여 XSS를 방지 (PUT /api/v1/quality/thresholds의 namespace/key 등) */
function escapeHtml(s: string | number | undefined | null): string {
  const str = s == null ? '' : String(s);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function generateMarkdownReport(reportData: QualityReport): string {
  const { summary, latest_metrics, warnings, history } = reportData;
  const statusEmoji = {
    pass: '✅',
    warning: '⚠️',
    fail: '❌'
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
  markdown += `| **경고 지표** | ${summary.warning_metrics} |\n\n`;

  if (summary.namespace_status.length > 0) {
    markdown += `## 네임스페이스별 상태\n\n`;
    markdown += `| 네임스페이스 | 상태 | 지표 수 | 통과 | 실패 |\n`;
    markdown += `|-------------|------|---------|------|------|\n`;
    for (const ns of summary.namespace_status) {
      markdown += `| **${ns.namespace}** | ${statusEmoji[ns.status]} ${ns.status.toUpperCase()} | ${ns.metrics_count} | ${ns.passed_count} | ${ns.failed_count} |\n`;
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
      markdown += `| ${metric.metric_namespace} | ${metric.metric_key} | ${metric.metric_value.toFixed(3)} | ${statusIcon} ${metric.status.toUpperCase()} | ${thresholdStr} | ${metric.measured_at} |\n`;
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

export function generateHtmlReport(reportData: QualityReport): string {
  const { summary, latest_metrics, warnings, history } = reportData;
  const statusClass = {
    pass: 'status-pass',
    warning: 'status-warning',
    fail: 'status-fail'
  };
  const statusText = {
    pass: 'PASS',
    warning: 'WARNING',
    fail: 'FAIL'
  };

  const safeQualityRowClass = (status: string): string => {
    const k = status.toLowerCase();
    if (k === 'pass' || k === 'warning' || k === 'fail') {
      return statusClass[k];
    }
    return 'status-warning';
  };
  const safeQualityLabel = (status: string): string => {
    const k = status.toLowerCase();
    if (k === 'pass') return statusText.pass;
    if (k === 'warning') return statusText.warning;
    if (k === 'fail') return statusText.fail;
    return escapeHtml(status);
  };
  const safeHistoryRowClass = (status: string): string => {
    const k = status.toLowerCase();
    const map: Record<string, string> = {
      success: 'status-pass',
      warning: 'status-warning',
      fail: 'status-fail',
      error: 'status-fail'
    };
    return map[k] ?? 'status-warning';
  };

  let html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quality Assurance Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #2c3e50;
      border-bottom: 3px solid #3498db;
      padding-bottom: 10px;
    }
    h2 {
      color: #34495e;
      margin-top: 30px;
      border-bottom: 2px solid #ecf0f1;
      padding-bottom: 5px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    th {
      background-color: #3498db;
      color: white;
      font-weight: 600;
    }
    tr:hover {
      background-color: #f5f5f5;
    }
    .status-pass {
      color: #27ae60;
      font-weight: bold;
    }
    .status-warning {
      color: #f39c12;
      font-weight: bold;
    }
    .status-fail {
      color: #e74c3c;
      font-weight: bold;
    }
    .summary-box {
      background: #ecf0f1;
      padding: 20px;
      border-radius: 5px;
      margin: 20px 0;
    }
    .summary-box h3 {
      margin-top: 0;
      color: #2c3e50;
    }
    .warning-box {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Quality Assurance Report</h1>
    <p><strong>생성 일시:</strong> ${escapeHtml(reportData.generated_at)}</p>
    <p><strong>전체 상태:</strong> <span class="${safeQualityRowClass(summary.overall_status)}">${safeQualityLabel(summary.overall_status)}</span></p>

    <div class="summary-box">
      <h3>요약</h3>
      <table>
        <tr>
          <th>항목</th>
          <th>값</th>
        </tr>
        <tr>
          <td><strong>전체 상태</strong></td>
          <td><span class="${safeQualityRowClass(summary.overall_status)}">${safeQualityLabel(summary.overall_status)}</span></td>
        </tr>
        <tr>
          <td><strong>총 지표 수</strong></td>
          <td>${escapeHtml(summary.total_metrics)}</td>
        </tr>
        <tr>
          <td><strong>통과 지표</strong></td>
          <td>${escapeHtml(summary.passed_metrics)}</td>
        </tr>
        <tr>
          <td><strong>실패 지표</strong></td>
          <td>${escapeHtml(summary.failed_metrics)}</td>
        </tr>
        <tr>
          <td><strong>경고 지표</strong></td>
          <td>${escapeHtml(summary.warning_metrics)}</td>
        </tr>
      </table>
    </div>`;

  if (summary.namespace_status.length > 0) {
    html += `
    <h2>네임스페이스별 상태</h2>
    <table>
      <tr>
        <th>네임스페이스</th>
        <th>상태</th>
        <th>지표 수</th>
        <th>통과</th>
        <th>실패</th>
      </tr>`;
    for (const ns of summary.namespace_status) {
      html += `
      <tr>
        <td><strong>${escapeHtml(ns.namespace)}</strong></td>
        <td><span class="${safeQualityRowClass(ns.status)}">${safeQualityLabel(ns.status)}</span></td>
        <td>${escapeHtml(ns.metrics_count)}</td>
        <td>${escapeHtml(ns.passed_count)}</td>
        <td>${escapeHtml(ns.failed_count)}</td>
      </tr>`;
    }
    html += `
    </table>`;
  }

  if (warnings.length > 0) {
    html += `
    <div class="warning-box">
      <h2>⚠️ 경고</h2>
      <table>
        <tr>
          <th>네임스페이스</th>
          <th>지표</th>
          <th>측정값</th>
          <th>임계값</th>
          <th>차이</th>
        </tr>`;
    for (const warning of warnings) {
      html += `
        <tr>
          <td>${escapeHtml(warning.metric_namespace)}</td>
          <td>${escapeHtml(warning.metric_key)}</td>
          <td>${escapeHtml(warning.measured_value.toFixed(3))}</td>
          <td>${escapeHtml(warning.threshold_value.toFixed(3))} (${escapeHtml(warning.threshold_type)})</td>
          <td>${warning.difference > 0 ? '+' : ''}${escapeHtml(warning.difference.toFixed(3))}</td>
        </tr>`;
    }
    html += `
      </table>
    </div>`;
  }

  if (latest_metrics.length > 0) {
    html += `
    <h2>최신 품질 지표</h2>
    <table>
      <tr>
        <th>네임스페이스</th>
        <th>지표</th>
        <th>값</th>
        <th>상태</th>
        <th>임계값</th>
        <th>측정 시간</th>
      </tr>`;
    for (const metric of latest_metrics) {
      const thresholdStr = metric.threshold_value !== null
        ? `${metric.threshold_value.toFixed(3)} (${metric.threshold_type})`
        : 'N/A';
      html += `
      <tr>
        <td>${escapeHtml(metric.metric_namespace)}</td>
        <td>${escapeHtml(metric.metric_key)}</td>
        <td>${escapeHtml(metric.metric_value.toFixed(3))}</td>
        <td><span class="${safeQualityRowClass(String(metric.status))}">${safeQualityLabel(String(metric.status))}</span></td>
        <td>${escapeHtml(thresholdStr)}</td>
        <td>${escapeHtml(metric.measured_at)}</td>
      </tr>`;
    }
    html += `
    </table>`;
  }

  if (history.length > 0) {
    html += `
    <h2>측정 이력 (최근 ${history.length}개)</h2>
    <table>
      <tr>
        <th>ID</th>
        <th>타입</th>
        <th>네임스페이스</th>
        <th>컨텍스트</th>
        <th>상태</th>
        <th>측정 시간</th>
      </tr>`;
    for (const h of history.slice(0, 20)) {
      html += `
      <tr>
        <td>${escapeHtml(h.id.substring(0, 20))}...</td>
        <td>${escapeHtml(h.measurement_type)}</td>
        <td>${escapeHtml(h.namespace || 'N/A')}</td>
        <td>${escapeHtml(h.context || 'N/A')}</td>
        <td><span class="${safeHistoryRowClass(h.status)}">${escapeHtml(h.status.toUpperCase())}</span></td>
        <td>${escapeHtml(h.measured_at)}</td>
      </tr>`;
    }
    html += `
    </table>`;
  }

  html += `
  </div>
</body>
</html>`;

  return html;
}

export async function saveReportToFile(reportData: QualityReport): Promise<void> {
  try {
    const logDir = path.join(process.cwd(), 'logs');

    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
    const logFilePath = path.join(logDir, `quality-report-${timestamp}.json`);
    const jsonContent = JSON.stringify(reportData, null, 2);
    await fsPromises.writeFile(logFilePath, jsonContent, 'utf-8');

    logger.info('품질 리포트 파일 저장 완료', {
      file_path: logFilePath,
      metrics_count: reportData.summary.total_metrics,
      overall_status: reportData.summary.overall_status
    });
  } catch (error) {
    logger.error('품질 리포트 파일 저장 실패', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

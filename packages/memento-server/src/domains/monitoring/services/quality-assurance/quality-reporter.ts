/**
 * Quality Reporter
 * 
 * 품질 리포트 생성 서비스
 * 
 * 주요 기능:
 * - Markdown, JSON, HTML 형식 리포트 생성
 * - 네임스페이스, 컨텍스트, 시간 범위 필터링
 * - 품질 지표 요약, 경고 정보, 이력 추이 포함
 * 
 * PRD FR-1.1: Reporter 역할 - 회상용 리포트 생성
 */

import Database from 'better-sqlite3';
import { promises as fsPromises } from 'fs';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { QualityRecorder } from './quality-recorder.js';
import { QualityThresholdManager } from './quality-threshold-manager.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { logger } from '../../../../shared/utils/logger.js';

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

/**
 * 리포트 형식
 */
export type ReportFormat = 'markdown' | 'json' | 'html';

/**
 * 리포트 생성 옵션
 */
export interface ReportOptions {
  /**
   * 리포트 형식 (기본값: 'markdown')
   */
  format?: ReportFormat;

  /**
   * 네임스페이스 필터 (선택적)
   */
  namespace?: string;

  /**
   * 컨텍스트 필터 (기본값: 'default')
   */
  context?: string;

  /**
   * 시작 시간 (ISO 8601 형식, 선택적)
   */
  from?: string;

  /**
   * 종료 시간 (ISO 8601 형식, 선택적)
   */
  to?: string;

  /**
   * 최대 이력 개수 (기본값: 100)
   */
  historyLimit?: number;
}

/**
 * 리포트 데이터 구조
 */
export interface QualityReport {
  /**
   * 리포트 생성 시간
   */
  generated_at: string;

  /**
   * 리포트 옵션
   */
  options: ReportOptions;

  /**
   * 전체 상태 요약
   */
  summary: {
    /**
     * 전체 상태: 'pass', 'warning', 'fail'
     */
    overall_status: 'pass' | 'warning' | 'fail';

    /**
     * 네임스페이스별 상태
     */
    namespace_status: Array<{
      namespace: string;
      status: 'pass' | 'warning' | 'fail';
      metrics_count: number;
      passed_count: number;
      failed_count: number;
    }>;

    /**
     * 총 지표 수
     */
    total_metrics: number;

    /**
     * 통과한 지표 수
     */
    passed_metrics: number;

    /**
     * 실패한 지표 수
     */
    failed_metrics: number;

    /**
     * 경고 지표 수
     */
    warning_metrics: number;
  };

  /**
   * 최신 품질 지표
   */
  latest_metrics: Array<{
    metric_namespace: string;
    metric_key: string;
    context: string;
    metric_value: number;
    measured_at: string;
    status: 'pass' | 'warning' | 'fail';
    threshold_value: number | null;
    threshold_type: 'min' | 'max' | null;
  }>;

  /**
   * 경고 정보
   */
  warnings: Array<{
    metric_namespace: string;
    metric_key: string;
    context: string;
    measured_value: number;
    threshold_value: number;
    threshold_type: 'min' | 'max';
    difference: number;
    message: string;
  }>;

  /**
   * 측정 이력 (최근 N개)
   */
  history: Array<{
    id: string;
    measurement_type: string;
    measured_at: string;
    status: string;
    namespace?: string;
    context?: string;
  }>;
}

/**
 * Quality Reporter
 * 
 * PRD FR-1.1: Reporter 역할 - 회상용 리포트 생성
 */
export class QualityReporter {
  private recorder: QualityRecorder;
  private thresholdManager: QualityThresholdManager;

  constructor(private db: Database.Database) {
    if (!db) {
      throw new Error('Database instance is required');
    }
    this.recorder = new QualityRecorder(db);
    this.thresholdManager = new QualityThresholdManager(db);
  }

  /**
   * 리포트 데이터 수집
   * 
   * @param options - 리포트 옵션
   * @returns 리포트 데이터
   */
  async collectReportData(options: ReportOptions = {}): Promise<QualityReport> {
    const {
      namespace,
      context = 'default',
      from,
      to,
      historyLimit = 100
    } = options;

    const now = new Date().toISOString();

    // 1. 최신 품질 지표 조회
    const latestMetrics = this.recorder.getLatestMetrics(namespace, context);

    // 2. 임계값 일괄 조회 (N+1 완화)
    const allThresholds = this.thresholdManager.getAllThresholds(namespace, context);
    const thresholdMap = new Map(
      allThresholds.map(t => [`${t.metric_namespace}.${t.metric_key}.${t.context}`, t])
    );

    // 3. 경고 정보 수집 (status가 'fail'인 지표)
    const warnings: QualityReport['warnings'] = [];
    for (const metric of latestMetrics) {
      if (metric.status === 'fail' && metric.threshold_value !== null) {
        const threshold = thresholdMap.get(
          `${metric.metric_namespace}.${metric.metric_key}.${metric.context}`
        ) ?? null;
        if (threshold) {
          const difference = threshold.threshold_type === 'min'
            ? metric.metric_value - threshold.threshold_value
            : threshold.threshold_value - metric.metric_value;

          warnings.push({
            metric_namespace: metric.metric_namespace,
            metric_key: metric.metric_key,
            context: metric.context,
            measured_value: metric.metric_value,
            threshold_value: threshold.threshold_value,
            threshold_type: threshold.threshold_type,
            difference,
            message: `${metric.metric_namespace}.${metric.metric_key}: ${metric.metric_value} ${threshold.threshold_type === 'min' ? '<' : '>'} ${threshold.threshold_value}`
          });
        }
      }
    }

    // 4. 네임스페이스별 상태 집계
    const namespaceStatusMap = new Map<string, {
      namespace: string;
      status: 'pass' | 'warning' | 'fail';
      metrics_count: number;
      passed_count: number;
      failed_count: number;
    }>();

    for (const metric of latestMetrics) {
      const ns = metric.metric_namespace;
      if (!namespaceStatusMap.has(ns)) {
        namespaceStatusMap.set(ns, {
          namespace: ns,
          status: 'pass',
          metrics_count: 0,
          passed_count: 0,
          failed_count: 0
        });
      }

      const status = namespaceStatusMap.get(ns)!;
      status.metrics_count++;
      if (metric.status === 'pass') {
        status.passed_count++;
      } else if (metric.status === 'fail') {
        status.failed_count++;
        status.status = 'fail';
      } else if (metric.status === 'warning' && status.status === 'pass') {
        status.status = 'warning';
      }
    }

    const namespaceStatus = Array.from(namespaceStatusMap.values());

    // 5. 전체 상태 결정
    let overallStatus: 'pass' | 'warning' | 'fail' = 'pass';
    if (namespaceStatus.some(ns => ns.status === 'fail')) {
      overallStatus = 'fail';
    } else if (namespaceStatus.some(ns => ns.status === 'warning')) {
      overallStatus = 'warning';
    }

    // 5. 전체 통계 계산
    const totalMetrics = latestMetrics.length;
    const passedMetrics = latestMetrics.filter(m => m.status === 'pass').length;
    const failedMetrics = latestMetrics.filter(m => m.status === 'fail').length;
    const warningMetrics = latestMetrics.filter(m => m.status === 'warning').length;

    // 6. 측정 이력 조회
    const history = this.recorder.getMeasurementHistory(namespace, context, from, to, historyLimit);

    // 7. 이력에 namespace와 context 정보 추가 (JSON 파싱)
    const enrichedHistory = history.map(h => {
      const fullRecord = DatabaseUtils.get(
        this.db,
        'SELECT metrics FROM quality_measurement_history WHERE id = ?',
        [h.id]
      ) as any;

      if (fullRecord && fullRecord.metrics) {
        try {
          const metricsJson = JSON.parse(fullRecord.metrics);
          return {
            ...h,
            namespace: metricsJson.namespace,
            context: metricsJson.context
          };
        } catch (error) {
          const errorObj = error instanceof Error 
            ? { message: error.message, stack: error.stack }
            : typeof error === 'object' && error !== null
            ? error as Record<string, unknown>
            : { error: String(error) };
          logger.warn(`Failed to parse metrics JSON for history ${h.id}:`, errorObj);
        }
      }
      return h;
    });

    // 8. 최신 지표에 threshold_type 추가 (thresholdMap 재사용)
    const enrichedLatestMetrics = latestMetrics.map(metric => {
      const threshold = thresholdMap.get(
        `${metric.metric_namespace}.${metric.metric_key}.${metric.context}`
      ) ?? null;
      return {
        ...metric,
        status: metric.status as 'pass' | 'warning' | 'fail',
        threshold_type: threshold?.threshold_type ?? null
      };
    });

    return {
      generated_at: now,
      options,
      summary: {
        overall_status: overallStatus,
        namespace_status: namespaceStatus,
        total_metrics: totalMetrics,
        passed_metrics: passedMetrics,
        failed_metrics: failedMetrics,
        warning_metrics: warningMetrics
      },
      latest_metrics: enrichedLatestMetrics,
      warnings,
      history: enrichedHistory
    };
  }

  /**
   * Markdown 형식 리포트 생성
   * 
   * @param reportData - 리포트 데이터
   * @returns Markdown 형식 리포트 문자열
   */
  generateMarkdownReport(reportData: QualityReport): string {
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

    // 요약
    markdown += `## 요약\n\n`;
    markdown += `| 항목 | 값 |\n`;
    markdown += `|------|-----|\n`;
    markdown += `| **전체 상태** | ${statusEmoji[summary.overall_status]} ${summary.overall_status.toUpperCase()} |\n`;
    markdown += `| **총 지표 수** | ${summary.total_metrics} |\n`;
    markdown += `| **통과 지표** | ${summary.passed_metrics} |\n`;
    markdown += `| **실패 지표** | ${summary.failed_metrics} |\n`;
    markdown += `| **경고 지표** | ${summary.warning_metrics} |\n\n`;

    // 네임스페이스별 상태
    if (summary.namespace_status.length > 0) {
      markdown += `## 네임스페이스별 상태\n\n`;
      markdown += `| 네임스페이스 | 상태 | 지표 수 | 통과 | 실패 |\n`;
      markdown += `|-------------|------|---------|------|------|\n`;
      for (const ns of summary.namespace_status) {
        markdown += `| **${ns.namespace}** | ${statusEmoji[ns.status]} ${ns.status.toUpperCase()} | ${ns.metrics_count} | ${ns.passed_count} | ${ns.failed_count} |\n`;
      }
      markdown += `\n`;
    }

    // 경고 정보
    if (warnings.length > 0) {
      markdown += `## ⚠️ 경고\n\n`;
      markdown += `| 네임스페이스 | 지표 | 측정값 | 임계값 | 차이 |\n`;
      markdown += `|-------------|------|--------|--------|------|\n`;
      for (const warning of warnings) {
        markdown += `| ${warning.metric_namespace} | ${warning.metric_key} | ${warning.measured_value.toFixed(3)} | ${warning.threshold_value.toFixed(3)} (${warning.threshold_type}) | ${warning.difference > 0 ? '+' : ''}${warning.difference.toFixed(3)} |\n`;
      }
      markdown += `\n`;
    }

    // 최신 지표
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

    // 측정 이력
    if (history.length > 0) {
      markdown += `## 측정 이력 (최근 ${history.length}개)\n\n`;
      markdown += `| ID | 타입 | 네임스페이스 | 컨텍스트 | 상태 | 측정 시간 |\n`;
      markdown += `|----|------|-------------|----------|------|----------|\n`;
      for (const h of history.slice(0, 20)) { // 최대 20개만 표시
        const statusIcon = h.status === 'success' ? '✅' : h.status === 'warning' ? '⚠️' : '❌';
        markdown += `| ${h.id.substring(0, 20)}... | ${h.measurement_type} | ${h.namespace || 'N/A'} | ${h.context || 'N/A'} | ${statusIcon} ${h.status} | ${h.measured_at} |\n`;
      }
      markdown += `\n`;
    }

    return markdown;
  }

  /**
   * JSON 형식 리포트 생성
   * 
   * @param reportData - 리포트 데이터
   * @returns JSON 형식 리포트 문자열
   */
  generateJsonReport(reportData: QualityReport): string {
    return JSON.stringify(reportData, null, 2);
  }

  /**
   * HTML 형식 리포트 생성
   * 
   * @param reportData - 리포트 데이터
   * @returns HTML 형식 리포트 문자열
   */
  generateHtmlReport(reportData: QualityReport): string {
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
    <p><strong>전체 상태:</strong> <span class="${statusClass[summary.overall_status]}">${escapeHtml(statusText[summary.overall_status])}</span></p>
    
    <div class="summary-box">
      <h3>요약</h3>
      <table>
        <tr>
          <th>항목</th>
          <th>값</th>
        </tr>
        <tr>
          <td><strong>전체 상태</strong></td>
          <td><span class="${statusClass[summary.overall_status]}">${escapeHtml(statusText[summary.overall_status])}</span></td>
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

    // 네임스페이스별 상태
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
        <td><span class="${statusClass[ns.status]}">${escapeHtml(statusText[ns.status])}</span></td>
        <td>${escapeHtml(ns.metrics_count)}</td>
        <td>${escapeHtml(ns.passed_count)}</td>
        <td>${escapeHtml(ns.failed_count)}</td>
      </tr>`;
      }
      html += `
    </table>`;
    }

    // 경고 정보
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

    // 최신 지표
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
        <td><span class="${statusClass[metric.status as keyof typeof statusClass]}">${escapeHtml(statusText[metric.status as keyof typeof statusText])}</span></td>
        <td>${escapeHtml(thresholdStr)}</td>
        <td>${escapeHtml(metric.measured_at)}</td>
      </tr>`;
      }
      html += `
    </table>`;
    }

    // 측정 이력
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
        <td><span class="${statusClass[h.status as keyof typeof statusClass] || 'status-warning'}">${escapeHtml(h.status.toUpperCase())}</span></td>
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

  /**
   * 리포트 생성
   * 
   * PRD FR-5.5: 리포트 생성 시 JSON 형식 로그 파일 저장
   * `logs/quality-report-{timestamp}.json` 형식으로 저장
   * 
   * @param options - 리포트 옵션
   * @returns 리포트 문자열
   */
  async generateReport(options: ReportOptions = {}): Promise<string> {
    const format = options.format || 'markdown';
    const reportData = await this.collectReportData(options);

    logger.info(`품질 리포트 생성: ${format} 형식`, {
      format,
      namespace: options.namespace,
      context: options.context,
      metrics_count: reportData.summary.total_metrics,
      overall_status: reportData.summary.overall_status
    });

    // PRD FR-5.5: JSON 형식 로그 파일 저장
    await this.saveReportToFile(reportData);

    switch (format) {
      case 'markdown':
        return this.generateMarkdownReport(reportData);
      case 'json':
        return this.generateJsonReport(reportData);
      case 'html':
        return this.generateHtmlReport(reportData);
      default:
        throw new Error(`Unsupported report format: ${format}`);
    }
  }

  /**
   * 리포트를 JSON 형식으로 파일에 저장
   * 
   * PRD FR-5.5: `logs/quality-report-{timestamp}.json` 형식으로 저장
   * 
   * @param reportData - 리포트 데이터
   */
  private async saveReportToFile(reportData: QualityReport): Promise<void> {
    try {
      const logDir = path.join(process.cwd(), 'logs');
      
      // 로그 디렉토리 생성
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      // 타임스탬프 기반 파일명 생성 (ISO 8601 형식, 파일명에 사용 가능하도록 변환)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
      const logFilePath = path.join(logDir, `quality-report-${timestamp}.json`);

      // JSON 형식으로 리포트 데이터 저장
      const jsonContent = JSON.stringify(reportData, null, 2);
      await fsPromises.writeFile(logFilePath, jsonContent, 'utf-8');

      logger.info('품질 리포트 파일 저장 완료', {
        file_path: logFilePath,
        metrics_count: reportData.summary.total_metrics,
        overall_status: reportData.summary.overall_status
      });
    } catch (error) {
      // 파일 저장 실패는 콘솔 로거에 위임
      logger.error('품질 리포트 파일 저장 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}


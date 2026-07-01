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
import { QualityRecorder } from './quality-recorder.js';
import { QualityThresholdManager } from './quality-threshold-manager.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { logger } from '../../../../shared/utils/logger.js';
import {
  generateHtmlReport,
  generateJsonReport,
  generateMarkdownReport,
  saveReportToFile
} from './quality-report-renderers.js';

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
      ) as { metrics?: string } | undefined;

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
   *  reportData - 리포트 데이터
   *  Markdown 형식 리포트 문자열
   */
  generateMarkdownReport(reportData: QualityReport): string {
    return generateMarkdownReport(reportData);
  }

  /**
   * JSON 형식 리포트 생성
   *
   *  reportData - 리포트 데이터
   *  JSON 형식 리포트 문자열
   */
  generateJsonReport(reportData: QualityReport): string {
    return generateJsonReport(reportData);
  }

  /**
   * HTML 형식 리포트 생성
   *
   *  reportData - 리포트 데이터
   *  HTML 형식 리포트 문자열
   */
  generateHtmlReport(reportData: QualityReport): string {
    return generateHtmlReport(reportData);
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
    await saveReportToFile(reportData);

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
}

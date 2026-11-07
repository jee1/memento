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
import { QUALITY_NAMESPACES } from './quality-metrics-collector.js';
import { QualityThresholdManager } from './quality-threshold-manager.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { logger } from '../../../../shared/utils/logger.js';
import {
  generateHtmlReport,
  generateJsonReport,
  generateMarkdownReport,
  saveReportToFile
} from './quality-report-renderers.js';
import {
  isEvaluableMetricState,
  QUALITY_METRIC_STATE,
  type QualityMetricState,
} from './quality-metric-measurement.js';

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
 * 리포트 판정. pass 는 임계값이 있고 통과한 경우만 쓴다.
 * 임계값이 없으면 no_threshold, 측정하지 못했으면 unmeasured 다 (#1650).
 */
export type ReportStatus = 'pass' | 'warning' | 'fail' | 'no_threshold' | 'unmeasured';

const STATUS_SEVERITY: Record<ReportStatus, number> = {
  pass: 0,
  no_threshold: 1,
  unmeasured: 2,
  warning: 3,
  fail: 4,
};

function worstStatus(statuses: readonly ReportStatus[]): ReportStatus {
  return statuses.reduce<ReportStatus>(
    (worst, status) => (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst] ? status : worst),
    statuses[0] ?? 'unmeasured'
  );
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
     * 전체 상태. 네임스페이스 상태 중 가장 나쁜 것 (fail > warning > unmeasured > no_threshold > pass)
     */
    overall_status: ReportStatus;

    /**
     * 네임스페이스별 상태
     */
    namespace_status: Array<{
      namespace: string;
      status: ReportStatus;
      metrics_count: number;
      passed_count: number;
      failed_count: number;
      no_threshold_count: number;
      unmeasured_count: number;
    }>;

    /**
     * 총 지표 수 (미측정 포함)
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

    /**
     * 임계값이 없어 판정하지 못한 지표 수
     */
    no_threshold_metrics: number;

    /**
     * 측정하지 못한 지표 수
     */
    unmeasured_metrics: number;
  };

  /**
   * 최신 품질 지표
   */
  latest_metrics: Array<{
    metric_namespace: string;
    metric_key: string;
    context: string;
    metric_value: number | null;
    measured_at: string;
    status: ReportStatus;
    threshold_value: number | null;
    threshold_type: 'min' | 'max' | null;
    measurement_state?: QualityMetricState;
    metric_denominator?: number | null;
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

type LatestMetricRow = QualityReport['latest_metrics'][number];

function buildMeasuredLatestRows(
  latestMetrics: ReturnType<QualityRecorder['getLatestMetrics']>,
  thresholdMap: Map<string, { threshold_type: 'min' | 'max' }>
): LatestMetricRow[] {
  return latestMetrics.map(metric => {
    const threshold = thresholdMap.get(
      `${metric.metric_namespace}.${metric.metric_key}.${metric.context}`
    ) ?? null;
    const dbStatus = metric.status as 'pass' | 'warning' | 'fail';
    return {
      ...metric,
      status: dbStatus === 'pass' && !threshold ? 'no_threshold' : dbStatus,
      threshold_type: threshold?.threshold_type ?? null,
      measurement_state: QUALITY_METRIC_STATE.MEASURED,
    };
  });
}

function appendUnmeasuredLatestRows(
  enriched: LatestMetricRow[],
  payload: Record<string, unknown> | null,
  namespace: string | undefined,
  context: string,
  now: string
): void {
  const payloadStates = payload?.metric_states as Record<string, QualityMetricState> | undefined;
  const payloadDenominators = payload?.metric_denominators as Record<string, number | null> | undefined;
  const payloadNamespace = typeof payload?.namespace === 'string' ? payload.namespace : namespace;
  if (!payloadStates || !payloadNamespace) {
    return;
  }
  for (const [metricKey, state] of Object.entries(payloadStates)) {
    if (isEvaluableMetricState(state)) {
      continue;
    }
    if (enriched.some(
      m => m.metric_namespace === payloadNamespace && m.metric_key === metricKey && m.context === context
    )) {
      continue;
    }
    enriched.push({
      metric_namespace: payloadNamespace,
      metric_key: metricKey,
      context,
      metric_value: null,
      measured_at: typeof payload?.measured_at === 'string' ? payload.measured_at : now,
      status: 'unmeasured',
      threshold_value: null,
      threshold_type: null,
      measurement_state: state,
      metric_denominator: payloadDenominators?.[metricKey] ?? null,
    });
  }
}

function markLegacyUnknownLatestRows(rows: LatestMetricRow[], isLegacy: boolean): void {
  if (!isLegacy) {
    return;
  }
  for (const metric of rows) {
    if (metric.metric_value === 0 && metric.measurement_state === QUALITY_METRIC_STATE.MEASURED) {
      metric.measurement_state = QUALITY_METRIC_STATE.UNKNOWN_LEGACY;
      metric.status = 'unmeasured';
    }
  }
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

    // 8. 최신 지표에 threshold_type·미측정 상태 반영 (네임스페이스마다 자기 최신 측정 기준)
    const enrichedLatestMetrics = buildMeasuredLatestRows(latestMetrics, thresholdMap);
    const namespaces = new Set<string>(namespace ? [namespace] : QUALITY_NAMESPACES);
    for (const metric of latestMetrics) {
      namespaces.add(metric.metric_namespace);
    }
    const namespaceStatus: QualityReport['summary']['namespace_status'] = [];
    for (const ns of namespaces) {
      const payload = this.recorder.getLatestMeasurementPayload(ns, context);
      appendUnmeasuredLatestRows(enrichedLatestMetrics, payload, ns, context, now);
      const rows = enrichedLatestMetrics.filter(m => m.metric_namespace === ns);
      markLegacyUnknownLatestRows(rows, this.recorder.isLegacyUnknownMetric(payload));
      if (rows.length === 0 && !payload) {
        // QUALITY_NAMESPACES 기대 목록은 측정 이력이 없어도 리포트에 남긴다 (#1661).
        namespaceStatus.push({
          namespace: ns,
          status: 'unmeasured',
          metrics_count: 0,
          passed_count: 0,
          failed_count: 0,
          no_threshold_count: 0,
          unmeasured_count: 0,
        });
        continue;
      }
      const countOf = (status: ReportStatus) => rows.filter(m => m.status === status).length;
      namespaceStatus.push({
        namespace: ns,
        status: worstStatus(rows.map(m => m.status)),
        metrics_count: rows.length,
        passed_count: countOf('pass'),
        failed_count: countOf('fail'),
        no_threshold_count: countOf('no_threshold'),
        unmeasured_count: countOf('unmeasured'),
      });
    }

    // 9. 전체 상태·통계
    const overallStatus = worstStatus(namespaceStatus.map(ns => ns.status));
    const countOverall = (status: ReportStatus) =>
      enrichedLatestMetrics.filter(m => m.status === status).length;

    return {
      generated_at: now,
      options,
      summary: {
        overall_status: overallStatus,
        namespace_status: namespaceStatus,
        total_metrics: enrichedLatestMetrics.length,
        passed_metrics: countOverall('pass'),
        failed_metrics: countOverall('fail'),
        warning_metrics: countOverall('warning'),
        no_threshold_metrics: countOverall('no_threshold'),
        unmeasured_metrics: countOverall('unmeasured'),
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

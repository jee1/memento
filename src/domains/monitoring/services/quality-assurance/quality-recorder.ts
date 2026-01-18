/**
 * Quality Recorder
 * 
 * 품질 측정 결과 기록 서비스
 * 
 * 주요 기능:
 * - 측정 결과를 quality_measurement_history 테이블에 저장
 * - 측정 결과를 quality_metrics 테이블에 저장 (최신 값 유지)
 * - Meta-Quality Memory 저장
 * 
 * PRD FR-1.1: Recorder 역할 - 측정 결과를 기억으로 저장 (Meta-Quality Memory)
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import type { CollectedMetrics } from './quality-metrics-collector.js';
import type { QualityEvaluationResult } from './quality-evaluator.js';
import { logger } from '../../../../shared/utils/logger.js';

/**
 * 측정 타입
 */
export type MeasurementType = 'batch' | 'test' | 'manual';

/**
 * 측정 이력 상태
 */
export type MeasurementHistoryStatus = 'success' | 'warning' | 'error';

/**
 * 품질 지표 상태
 */
export type QualityMetricStatus = 'pass' | 'warning' | 'fail';

/**
 * 측정 결과 기록 옵션
 */
export interface RecordOptions {
  /**
   * 측정 타입 (기본값: 'batch')
   */
  measurement_type?: MeasurementType;

  /**
   * 컨텍스트 (기본값: 'default')
   */
  context?: string;
}

/**
 * Quality Recorder
 * 
 * PRD FR-1.1: Recorder 역할 - 측정 결과를 기억으로 저장 (Meta-Quality Memory)
 */
export class QualityRecorder {
  constructor(private db: Database.Database) {
    if (!db) {
      throw new Error('Database instance is required');
    }
  }

  /**
   * ID 생성 유틸리티
   */
  private generateId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `quality_${timestamp}_${random}`;
  }

  /**
   * 측정 결과 기록
   * 
   * quality_measurement_history와 quality_metrics 테이블에 저장
   * 
   * @param collectedMetrics - 수집된 품질 지표
   * @param evaluationResult - 평가 결과
   * @param options - 기록 옵션
   * @returns 기록된 측정 이력 ID
   */
  async recordMeasurement(
    collectedMetrics: CollectedMetrics,
    evaluationResult: QualityEvaluationResult,
    options: RecordOptions = {}
  ): Promise<string> {
    const {
      measurement_type = 'batch',
      context = 'default'
    } = options;

    const measurementId = this.generateId();
    const now = new Date().toISOString();

    // 평가 결과의 status를 measurement_history의 status로 매핑
    // evaluationResult.status: 'pass' | 'warning' | 'fail'
    // measurement_history.status: 'success' | 'warning' | 'error'
    let historyStatus: MeasurementHistoryStatus = 'success';
    if (evaluationResult.status === 'fail') {
      historyStatus = 'error';
    } else if (evaluationResult.status === 'warning') {
      historyStatus = 'warning';
    }

    // metrics JSON 생성 (평가 결과 포함)
    const metricsJson = JSON.stringify({
      namespace: collectedMetrics.namespace,
      context,
      measured_at: collectedMetrics.measured_at,
      metrics: collectedMetrics.metrics,
      evaluation: {
        status: evaluationResult.status,
        passed_count: evaluationResult.passedCount,
        failed_count: evaluationResult.failedCount,
        total_count: evaluationResult.totalCount
      },
      metric_results: evaluationResult.metricResults.map(r => ({
        key: r.key,
        value: r.value,
        passed: r.passed,
        threshold_value: r.threshold?.threshold_value || null,
        threshold_type: r.threshold?.threshold_type || null,
        difference: r.difference
      }))
    });

    // warnings JSON 생성
    const warningsJson = evaluationResult.warnings.length > 0
      ? JSON.stringify(evaluationResult.warnings)
      : null;

    // 1. quality_measurement_history에 저장
    const historySql = `
      INSERT INTO quality_measurement_history (
        id,
        measurement_type,
        measured_at,
        metrics,
        status,
        warnings,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    DatabaseUtils.run(this.db, historySql, [
      measurementId,
      measurement_type,
      collectedMetrics.measured_at,
      metricsJson,
      historyStatus,
      warningsJson,
      now
    ]);

    // 2. quality_metrics에 저장 (각 지표별로 UPSERT)
    for (const [key, value] of Object.entries(collectedMetrics.metrics)) {
      const metricResult = evaluationResult.metricResults.find(r => r.key === key);
      const thresholdValue = metricResult?.threshold?.threshold_value || null;
      
      // 각 지표별 상태 결정:
      // - passed: 'pass'
      // - !passed && threshold 존재: 'fail'
      // - !passed && threshold 없음: 'warning'
      let metricStatus: QualityMetricStatus = 'pass';
      if (metricResult) {
        if (metricResult.passed) {
          metricStatus = 'pass';
        } else if (metricResult.threshold !== null) {
          metricStatus = 'fail';
        } else {
          metricStatus = 'warning';
        }
      }

      const metricsSql = `
        INSERT INTO quality_metrics (
          metric_namespace,
          metric_key,
          context,
          metric_value,
          measured_at,
          status,
          threshold_value,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(metric_namespace, metric_key, context) 
        DO UPDATE SET
          metric_value = excluded.metric_value,
          measured_at = excluded.measured_at,
          status = excluded.status,
          threshold_value = excluded.threshold_value,
          updated_at = excluded.updated_at
      `;

      DatabaseUtils.run(this.db, metricsSql, [
        collectedMetrics.namespace,
        key,
        context,
        value,
        collectedMetrics.measured_at,
        metricStatus,
        thresholdValue,
        now
      ]);
    }

    logger.info(`품질 측정 결과 기록: ${collectedMetrics.namespace} (${context}) - ${historyStatus}`, {
      measurement_id: measurementId,
      namespace: collectedMetrics.namespace,
      context,
      status: historyStatus,
      metrics_count: Object.keys(collectedMetrics.metrics).length,
      passed_count: evaluationResult.passedCount,
      failed_count: evaluationResult.failedCount
    });

    return measurementId;
  }

  /**
   * 여러 네임스페이스의 측정 결과 기록
   * 
   * @param collectedMetricsList - 수집된 품질 지표 목록
   * @param evaluationResults - 평가 결과 목록
   * @param options - 기록 옵션
   * @returns 기록된 측정 이력 ID 목록
   */
  async recordAllMeasurements(
    collectedMetricsList: CollectedMetrics[],
    evaluationResults: QualityEvaluationResult[],
    options: RecordOptions = {}
  ): Promise<string[]> {
    if (collectedMetricsList.length !== evaluationResults.length) {
      throw new Error('collectedMetricsList and evaluationResults must have the same length');
    }

    const measurementIds: string[] = [];

    for (let i = 0; i < collectedMetricsList.length; i++) {
      const metrics = collectedMetricsList[i];
      const evaluation = evaluationResults[i];
      
      if (!metrics) {
        throw new Error(`collectedMetricsList[${i}] is undefined`);
      }
      
      if (!evaluation) {
        throw new Error(`evaluationResults[${i}] is undefined`);
      }
      
      const id = await this.recordMeasurement(metrics, evaluation, options);
      measurementIds.push(id);
    }

    return measurementIds;
  }

  /**
   * 측정 이력 조회
   * 
   * @param namespace - 네임스페이스 필터 (선택적)
   * @param context - 컨텍스트 필터 (선택적)
   * @param from - 시작 시간 (선택적)
   * @param to - 종료 시간 (선택적)
   * @param limit - 최대 개수 (기본값: 100)
   * @returns 측정 이력 목록
   */
  getMeasurementHistory(
    namespace?: string,
    context?: string,
    from?: string,
    to?: string,
    limit: number = 100
  ): Array<{
    id: string;
    measurement_type: string;
    measured_at: string;
    status: string;
    created_at: string;
  }> {
    let sql = `
      SELECT 
        id,
        measurement_type,
        measured_at,
        status,
        created_at
      FROM quality_measurement_history
    `;

    const params: any[] = [];
    const conditions: string[] = [];

    if (namespace) {
      // metrics JSON에서 namespace 추출 (JSON_EXTRACT 사용)
      conditions.push(`JSON_EXTRACT(metrics, '$.namespace') = ?`);
      params.push(namespace);
    }

    if (context) {
      // metrics JSON에서 context 추출
      conditions.push(`JSON_EXTRACT(metrics, '$.context') = ?`);
      params.push(context);
    }

    if (from) {
      conditions.push('measured_at >= ?');
      params.push(from);
    }

    if (to) {
      conditions.push('measured_at <= ?');
      params.push(to);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ' ORDER BY measured_at DESC LIMIT ?';
    params.push(limit);

    return DatabaseUtils.all(this.db, sql, params) as Array<{
      id: string;
      measurement_type: string;
      measured_at: string;
      status: string;
      created_at: string;
    }>;
  }

  /**
   * 최신 품질 지표 조회
   * 
   * @param namespace - 네임스페이스 필터 (선택적)
   * @param context - 컨텍스트 필터 (선택적)
   * @returns 최신 품질 지표 목록
   */
  getLatestMetrics(
    namespace?: string,
    context?: string
  ): Array<{
    metric_namespace: string;
    metric_key: string;
    context: string;
    metric_value: number;
    measured_at: string;
    status: string;
    threshold_value: number | null;
    updated_at: string;
  }> {
    let sql = `
      SELECT 
        metric_namespace,
        metric_key,
        context,
        metric_value,
        measured_at,
        status,
        threshold_value,
        updated_at
      FROM quality_metrics
    `;

    const params: any[] = [];
    const conditions: string[] = [];

    if (namespace) {
      conditions.push('metric_namespace = ?');
      params.push(namespace);
    }

    if (context) {
      conditions.push('context = ?');
      params.push(context);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ' ORDER BY metric_namespace, metric_key, context';

    return DatabaseUtils.all(this.db, sql, params) as Array<{
      metric_namespace: string;
      metric_key: string;
      context: string;
      metric_value: number;
      measured_at: string;
      status: string;
      threshold_value: number | null;
      updated_at: string;
    }>;
  }
}


/**
 * Quality Evaluator
 * 
 * 품질 평가 서비스
 * 
 * 주요 기능:
 * - 임계값 비교 및 품질 평가
 * - 상태 결정: pass/warning/fail
 * - 경고 정보 생성
 * 
 * PRD FR-1.1: Evaluator 역할 - 임계값 비교 및 품질 평가
 * PRD FR-4.2: 품질 측정 시 임계값을 검증해야 함
 */

import Database from 'better-sqlite3';
import fsPromises from 'fs/promises';
import path from 'path';
import { QualityThresholdManager, type QualityThreshold } from './quality-threshold-manager.js';
import type { CollectedMetrics } from './quality-metrics-collector.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * 지표 평가 결과
 */
export interface MetricEvaluationResult {
  /**
   * 네임스페이스
   */
  namespace: string;

  /**
   * 지표 키
   */
  key: string;

  /**
   * 측정값
   */
  value: number;

  /**
   * 임계값 정보
   */
  threshold: QualityThreshold | null;

  /**
   * 통과 여부
   */
  passed: boolean;

  /**
   * 차이 (측정값 - 임계값, 또는 임계값 - 측정값)
   * 양수면 여유, 음수면 부족
   */
  difference: number | null;

  /**
   * 평가 메시지
   */
  message: string;
}

/**
 * 품질 평가 결과
 */
export interface QualityEvaluationResult {
  /**
   * 네임스페이스
   */
  namespace: string;

  /**
   * 컨텍스트
   */
  context: string;

  /**
   * 전체 상태: 'pass', 'warning', 'fail'
   */
  status: 'pass' | 'warning' | 'fail';

  /**
   * 각 지표별 평가 결과
   */
  metricResults: MetricEvaluationResult[];

  /**
   * 통과한 지표 수
   */
  passedCount: number;

  /**
   * 실패한 지표 수
   */
  failedCount: number;

  /**
   * 총 지표 수
   */
  totalCount: number;

  /**
   * 경고 정보 (임계값 미달 시)
   */
  warnings: Array<{
    metric_key: string;
    value: number;
    threshold_value: number;
    difference: number;
    message: string;
  }>;

  /**
   * 평가 시간
   */
  evaluated_at: string;
}

/**
 * Quality Evaluator
 * 
 * PRD FR-1.1: Evaluator 역할 - 임계값 비교 및 품질 평가
 */
export class QualityEvaluator {
  private thresholdManager: QualityThresholdManager;

  constructor(private db: Database.Database) {
    if (!db) {
      throw new Error('Database instance is required');
    }
    this.thresholdManager = new QualityThresholdManager(db);
  }

  /**
   * 단일 지표 평가
   * 
   * @param namespace - 네임스페이스
   * @param key - 지표 키
   * @param value - 측정값
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 지표 평가 결과
   */
  evaluateMetric(
    namespace: string,
    key: string,
    value: number,
    context: string = 'default'
  ): MetricEvaluationResult {
    const validation = this.thresholdManager.validateThreshold(namespace, key, value, context);

    let difference: number | null = null;
    if (validation.threshold) {
      if (validation.threshold.threshold_type === 'min') {
        // min 타입: value - threshold_value (양수면 여유, 음수면 부족)
        difference = value - validation.threshold.threshold_value;
      } else if (validation.threshold.threshold_type === 'max') {
        // max 타입: threshold_value - value (양수면 여유, 음수면 부족)
        difference = validation.threshold.threshold_value - value;
      }
    }

    return {
      namespace,
      key,
      value,
      threshold: validation.threshold,
      passed: validation.passed,
      difference,
      message: validation.message
    };
  }

  /**
   * 품질 지표 평가
   * 
   * PRD FR-4.2: 품질 측정 시 임계값을 검증해야 함
   * 
   * @param metrics - 수집된 품질 지표
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 품질 평가 결과
   */
  async evaluateMetrics(
    metrics: CollectedMetrics,
    context: string = 'default'
  ): Promise<QualityEvaluationResult> {
    const metricResults: MetricEvaluationResult[] = [];
    const warnings: QualityEvaluationResult['warnings'] = [];

    // 각 지표를 평가
    for (const [key, value] of Object.entries(metrics.metrics)) {
      const result = this.evaluateMetric(metrics.namespace, key, value, context);
      metricResults.push(result);

      // 임계값 미달 시 경고 추가
      if (!result.passed && result.threshold) {
        warnings.push({
          metric_key: key,
          value,
          threshold_value: result.threshold.threshold_value,
          difference: result.difference || 0,
          message: result.message
        });
      }
    }

    // 상태 결정
    const passedCount = metricResults.filter(r => r.passed).length;
    const failedCount = metricResults.filter(r => !r.passed).length;
    const totalCount = metricResults.length;

    // 상태 결정 로직:
    // - pass: 모든 지표가 통과
    // - warning: 일부 지표가 실패했지만 심각하지 않음 (임계값이 설정되지 않은 경우는 제외)
    // - fail: 중요한 지표가 실패 (임계값이 설정된 지표 중 실패)
    let status: 'pass' | 'warning' | 'fail' = 'pass';

    if (failedCount > 0) {
      // 임계값이 설정된 지표 중 실패한 것이 있으면 fail
      const failedWithThreshold = metricResults.filter(
        r => !r.passed && r.threshold !== null
      ).length;

      if (failedWithThreshold > 0) {
        status = 'fail';
      } else {
        // 임계값이 설정되지 않은 지표만 실패한 경우는 warning
        status = 'warning';
      }
    }

    // 평가 결과 생성
    const evaluationResult: QualityEvaluationResult = {
      namespace: metrics.namespace,
      context,
      status,
      metricResults,
      passedCount,
      failedCount,
      totalCount,
      warnings,
      evaluated_at: new Date().toISOString()
    };

    // PRD FR-4.2: 경고 로그 기록
    if (warnings.length > 0) {
      logger.warn(`품질 저하 감지: ${metrics.namespace} (${context})`, {
        namespace: metrics.namespace,
        context,
        warnings: warnings.map(w => ({
          metric: w.metric_key,
          value: w.value,
          threshold: w.threshold_value,
          difference: w.difference
        }))
      });

      // PRD FR-4.3: 구조화된 JSON 로그 파일 기록
      await this.logWarningToFile(evaluationResult);
    }

    return evaluationResult;
  }

  /**
   * 여러 네임스페이스의 품질 지표 평가
   * 
   * @param metricsList - 수집된 품질 지표 목록
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 품질 평가 결과 목록
   */
  async evaluateAllMetrics(
    metricsList: CollectedMetrics[],
    context: string = 'default'
  ): Promise<QualityEvaluationResult[]> {
    return Promise.all(metricsList.map(metrics => this.evaluateMetrics(metrics, context)));
  }

  /**
   * 전체 상태 결정
   * 
   * 여러 네임스페이스의 평가 결과를 종합하여 전체 상태를 결정
   * 
   * @param evaluationResults - 평가 결과 목록
   * @returns 전체 상태: 'pass', 'warning', 'fail'
   */
  determineOverallStatus(evaluationResults: QualityEvaluationResult[]): 'pass' | 'warning' | 'fail' {
    if (evaluationResults.length === 0) {
      return 'pass';
    }

    // fail이 하나라도 있으면 전체 fail
    if (evaluationResults.some(r => r.status === 'fail')) {
      return 'fail';
    }

    // warning이 하나라도 있으면 전체 warning
    if (evaluationResults.some(r => r.status === 'warning')) {
      return 'warning';
    }

    // 모두 pass면 전체 pass
    return 'pass';
  }

  /**
   * 경고 정보 생성
   * 
   * PRD FR-4.2: 경고 로그에 상세 정보 포함 (지표명, 측정값, 임계값, 차이)
   * 
   * @param evaluationResult - 평가 결과
   * @returns 경고 정보 (JSON 형식)
   */
  generateWarningInfo(evaluationResult: QualityEvaluationResult): string {
    if (evaluationResult.warnings.length === 0) {
      return JSON.stringify({ warnings: [] });
    }

    const warningInfo = {
      namespace: evaluationResult.namespace,
      context: evaluationResult.context,
      status: evaluationResult.status,
      evaluated_at: evaluationResult.evaluated_at,
      warnings: evaluationResult.warnings.map(w => ({
        metric_key: w.metric_key,
        value: w.value,
        threshold_value: w.threshold_value,
        threshold_type: evaluationResult.metricResults.find(
          r => r.key === w.metric_key
        )?.threshold?.threshold_type || 'unknown',
        difference: w.difference,
        message: w.message
      }))
    };

    return JSON.stringify(warningInfo, null, 2);
  }

  /**
   * 경고 로그를 파일에 기록
   * 
   * PRD FR-4.3: 품질 저하 발생 시 구조화된 JSON 로그 기록
   * `logs/quality-warnings-{date}.log` 형식으로 저장
   * 
   * @param evaluationResult - 평가 결과
   */
  private async logWarningToFile(evaluationResult: QualityEvaluationResult): Promise<void> {
    try {
      const logDir = path.join(process.cwd(), 'logs');
      
      // 로그 디렉토리 생성
      try {
        await fsPromises.access(logDir);
      } catch {
        await fsPromises.mkdir(logDir, { recursive: true });
      }

      // 날짜별 로그 파일명 생성 (YYYY-MM-DD 형식)
      const today = new Date().toISOString().split('T')[0];
      const logFilePath = path.join(logDir, `quality-warnings-${today}.log`);

      // 구조화된 JSON 로그 엔트리 생성
      const logEntry = {
        timestamp: evaluationResult.evaluated_at,
        namespace: evaluationResult.namespace,
        context: evaluationResult.context,
        status: evaluationResult.status,
        passed_count: evaluationResult.passedCount,
        failed_count: evaluationResult.failedCount,
        total_count: evaluationResult.totalCount,
        warnings: evaluationResult.warnings.map(w => ({
          metric_key: w.metric_key,
          value: w.value,
          threshold_value: w.threshold_value,
          threshold_type: evaluationResult.metricResults.find(
            r => r.key === w.metric_key
          )?.threshold?.threshold_type || 'unknown',
          difference: w.difference,
          message: w.message
        }))
      };

      // JSON Lines 형식으로 파일에 추가
      const logLine = JSON.stringify(logEntry) + '\n';
      await fsPromises.appendFile(logFilePath, logLine, 'utf-8');
    } catch (error) {
      // 파일 로깅 실패는 콘솔 로거에 위임
      logger.error('품질 경고 로그 파일 기록 실패', {
        namespace: evaluationResult.namespace,
        context: evaluationResult.context,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}


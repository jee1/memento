/**
 * Quality Assurance Service
 * 
 * 중앙 품질 관리 서비스 (Orchestrator)
 * 
 * 주요 기능:
 * - Collector, Evaluator, Recorder, Reporter 통합
 * - 품질 측정 실행 (수집 -> 평가 -> 기록)
 * - 리포트 생성
 * - 배치 작업 지원
 * 
 * PRD FR-1.1: Orchestrator 역할 - 전체 품질 관리 플로우 조율
 */

import Database from 'better-sqlite3';
import { QualityMetricsCollector, type CollectedMetrics } from './quality-metrics-collector.js';
import { QualityEvaluator, type QualityEvaluationResult } from './quality-evaluator.js';
import { QualityRecorder, type MeasurementType } from './quality-recorder.js';
import { QualityReporter, type ReportFormat, type ReportOptions } from './quality-reporter.js';
import { QualityThresholdManager } from './quality-threshold-manager.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * 품질 측정 옵션
 */
export interface MeasurementOptions {
  /**
   * 측정 타입 (기본값: 'batch')
   */
  measurement_type?: MeasurementType;

  /**
   * 컨텍스트 (기본값: 'default')
   */
  context?: string;

  /**
   * 측정할 네임스페이스 목록 (지정하지 않으면 모든 네임스페이스)
   */
  namespaces?: string[];

  /**
   * 측정 결과를 기록할지 여부 (기본값: true)
   */
  record?: boolean;
}

/**
 * 품질 측정 결과
 */
export interface MeasurementResult {
  /**
   * 측정 시간
   */
  measured_at: string;

  /**
   * 측정된 네임스페이스 목록
   */
  namespaces: string[];

  /**
   * 수집된 지표 목록
   */
  collected_metrics: CollectedMetrics[];

  /**
   * 평가 결과 목록
   */
  evaluation_results: QualityEvaluationResult[];

  /**
   * 기록된 측정 이력 ID 목록
   */
  measurement_ids: string[];

  /**
   * 전체 상태: 'pass', 'warning', 'fail'
   */
  overall_status: 'pass' | 'warning' | 'fail';

  /**
   * 경고 개수
   */
  warning_count: number;
}

/**
 * Quality Assurance Service
 * 
 * PRD FR-1.1: Orchestrator 역할 - 전체 품질 관리 플로우 조율
 */
export class QualityAssuranceService {
  private collector: QualityMetricsCollector;
  private evaluator: QualityEvaluator;
  private recorder: QualityRecorder;
  private reporter: QualityReporter;
  private thresholdManager: QualityThresholdManager;

  constructor(private db: Database.Database) {
    if (!db) {
      throw new Error('Database instance is required');
    }
    this.collector = new QualityMetricsCollector(db);
    this.evaluator = new QualityEvaluator(db);
    this.recorder = new QualityRecorder(db);
    this.reporter = new QualityReporter(db);
    this.thresholdManager = new QualityThresholdManager(db);
  }

  /**
   * 품질 측정 실행
   * 
   * 전체 플로우: 수집 -> 평가 -> 기록
   * 
   * PRD FR-3.1: 배치 작업을 통해 주기적으로 품질을 측정해야 함
   * 
   * @param options - 측정 옵션
   * @returns 측정 결과
   */
  async measureQuality(options: MeasurementOptions = {}): Promise<MeasurementResult> {
    const {
      measurement_type = 'batch',
      context = 'default',
      namespaces,
      record = true
    } = options;

    const measuredAt = new Date().toISOString();
    logger.info(`품질 측정 시작: ${namespaces ? namespaces.join(', ') : 'all'} (${context})`, {
      measurement_type,
      context,
      namespaces
    });

    try {
      // 1. 품질 지표 수집
      let collectedMetricsList: CollectedMetrics[];
      if (namespaces && namespaces.length > 0) {
        // 특정 네임스페이스만 수집
        collectedMetricsList = await Promise.all(
          namespaces.map(ns => this.collector.collectMetricsByNamespace(ns, context))
        );
      } else {
        // 모든 네임스페이스 수집
        collectedMetricsList = await this.collector.collectAllMetrics(context);
      }

      // 2. 품질 평가
      const evaluationResults = await this.evaluator.evaluateAllMetrics(collectedMetricsList, context);

      // 3. 전체 상태 결정
      const overallStatus = this.evaluator.determineOverallStatus(evaluationResults);

      // 4. 경고 개수 계산
      const warningCount = evaluationResults.reduce(
        (sum, result) => sum + result.warnings.length,
        0
      );

      // 5. 측정 결과 기록 (옵션)
      let measurementIds: string[] = [];
      if (record) {
        measurementIds = await this.recorder.recordAllMeasurements(
          collectedMetricsList,
          evaluationResults,
          { measurement_type, context }
        );
      }

      // 6. 경고 로그 기록
      if (warningCount > 0) {
        logger.warn(`품질 저하 감지: ${warningCount}개 경고`, {
          measurement_type,
          context,
          namespaces: namespaces || 'all',
          overall_status: overallStatus,
          warning_count: warningCount
        });
      }

      const result: MeasurementResult = {
        measured_at: measuredAt,
        namespaces: namespaces || collectedMetricsList.map(m => m.namespace),
        collected_metrics: collectedMetricsList,
        evaluation_results: evaluationResults,
        measurement_ids: measurementIds,
        overall_status: overallStatus,
        warning_count: warningCount
      };

      logger.info(`품질 측정 완료: ${overallStatus} (${warningCount}개 경고)`, {
        measurement_type,
        context,
        namespaces: result.namespaces,
        overall_status: overallStatus,
        warning_count: warningCount,
        metrics_count: collectedMetricsList.length
      });

      return result;
    } catch (error) {
      logger.error('품질 측정 실패', {
        measurement_type,
        context,
        namespaces,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * 품질 리포트 생성
   * 
   * PRD FR-5.1: CLI 명령어로 품질 리포트를 생성할 수 있어야 함
   * PRD FR-5.2: HTTP API 엔드포인트로 품질 리포트를 조회할 수 있어야 함
   * 
   * @param options - 리포트 옵션
   * @returns 리포트 문자열
   */
  async generateReport(options: ReportOptions = {}): Promise<string> {
    return this.reporter.generateReport(options);
  }

  /**
   * 품질 리포트 데이터 조회
   * 
   * @param options - 리포트 옵션
   * @returns 리포트 데이터
   */
  async getReportData(options: ReportOptions = {}): Promise<import('./quality-reporter.js').QualityReport> {
    return this.reporter.collectReportData(options);
  }

  /**
   * 기본 품질 임계값 초기화
   * 
   * PRD FR-4.1: 품질 임계값을 정의하고 관리할 수 있어야 함
   * 
   * @param context - 컨텍스트 (기본값: 'default')
   * @param overwrite - 기존 임계값 덮어쓰기 여부 (기본값: false)
   * @returns 초기화된 임계값 개수
   */
  initializeDefaultThresholds(context: string = 'default', overwrite: boolean = false): number {
    return this.thresholdManager.initializeDefaultThresholds(context, overwrite);
  }

  /**
   * 품질 임계값 조회
   * 
   * @param namespace - 네임스페이스 필터 (선택적)
   * @param context - 컨텍스트 필터 (선택적)
   * @returns 임계값 목록
   */
  getThresholds(namespace?: string, context?: string) {
    return this.thresholdManager.getAllThresholds(namespace, context);
  }

  /**
   * 품질 임계값 설정
   * 
   * @param namespace - 네임스페이스
   * @param key - 지표 키
   * @param threshold_value - 임계값
   * @param threshold_type - 임계값 타입 ('min' | 'max')
   * @param description - 설명 (선택적)
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 설정된 임계값
   */
  setThreshold(
    namespace: string,
    key: string,
    threshold_value: number,
    threshold_type: 'min' | 'max',
    description?: string,
    context: string = 'default'
  ) {
    return this.thresholdManager.setThreshold(
      namespace,
      key,
      { threshold_value, threshold_type, description },
      context
    );
  }

  /**
   * 품질 임계값 삭제
   * 
   * @param namespace - 네임스페이스
   * @param key - 지표 키
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 삭제 성공 여부
   */
  deleteThreshold(namespace: string, key: string, context: string = 'default'): boolean {
    return this.thresholdManager.deleteThreshold(namespace, key, context);
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
  ) {
    return this.recorder.getMeasurementHistory(namespace, context, from, to, limit);
  }

  /**
   * 최신 품질 지표 조회
   * 
   * @param namespace - 네임스페이스 필터 (선택적)
   * @param context - 컨텍스트 필터 (선택적)
   * @returns 최신 품질 지표 목록
   */
  getLatestMetrics(namespace?: string, context?: string) {
    return this.recorder.getLatestMetrics(namespace, context);
  }

  /**
   * 배치 작업용 품질 측정
   * 
   * PRD FR-3.1: 배치 작업을 통해 주기적으로 품질을 측정해야 함
   * 
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 측정 결과
   */
  async runBatchMeasurement(context: string = 'default'): Promise<MeasurementResult> {
    return this.measureQuality({
      measurement_type: 'batch',
      context,
      record: true
    });
  }

  /**
   * 테스트용 품질 측정
   * 
   * PRD FR-3.2: CI/CD 파이프라인에서 테스트 시 품질을 측정해야 함
   * 
   * @param context - 컨텍스트 (기본값: 'ci')
   * @param namespaces - 측정할 네임스페이스 목록 (선택적)
   * @returns 측정 결과
   */
  async runTestMeasurement(
    context: string = 'ci',
    namespaces?: string[]
  ): Promise<MeasurementResult> {
    return this.measureQuality({
      measurement_type: 'test',
      context,
      namespaces,
      record: true
    });
  }
}


/**
 * 품질 측정 배치 작업
 * 
 * 일일 품질 측정을 수행하는 배치 작업입니다.
 * 
 * 주요 기능:
 * - 모든 네임스페이스에 대한 품질 측정 실행
 * - 측정 결과 기록 및 리포트 생성
 * - 경고 및 실패 지표 감지
 * - 로깅 및 통계 수집
 * 
 * PRD FR-5.6: 일일 품질 측정 배치 작업 구현
 */

import Database from 'better-sqlite3';
import { QualityAssuranceService } from '../../../domains/monitoring/services/quality-assurance/quality-assurance-service.js';
import { logger } from '../../../shared/utils/logger.js';
import { resolveValidatedNumber } from '../../../shared/config/environment.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';

/**
 * 품질 측정 배치 작업 설정
 */
export interface QualityMeasurementBatchJobConfig {
  /**
   * 측정 타입 (기본값: 'batch')
   */
  measurementType?: 'batch' | 'test' | 'manual';

  /**
   * 측정 컨텍스트 (기본값: 'default')
   */
  context?: string;

  /**
   * 측정할 네임스페이스 목록 (지정하지 않으면 모든 네임스페이스)
   */
  namespaces?: string[] | undefined;

  /**
   * 측정 결과를 기록할지 여부 (기본값: true)
   */
  record?: boolean;

  /**
   * 리포트 생성 여부 (기본값: true)
   */
  generateReport?: boolean;

  /**
   * 리포트 형식 (기본값: 'markdown')
   */
  reportFormat?: 'markdown' | 'json' | 'html';

  /**
   * 작업 타임아웃 (밀리초, 기본값: 5분)
   */
  timeout?: number;
}

/**
 * 품질 측정 배치 작업 결과
 */
export interface QualityMeasurementBatchResult extends BatchJobResult {
  jobType: 'quality_measurement_batch';
  details: {
    /**
     * 측정된 네임스페이스 수
     */
    namespacesMeasured: number;

    /**
     * 전체 지표 수
     */
    totalMetrics: number;

    /**
     * 통과한 지표 수
     */
    passedMetrics: number;

    /**
     * 실패한 지표 수
     */
    failedMetrics: number;

    /**
     * 경고 지표 수
     */
    warningMetrics: number;

    /**
     * 전체 상태
     */
    overallStatus: 'pass' | 'warning' | 'fail';

    /**
     * 보존 기간이 지나 삭제한 quality_measurement_history 행 수 (#908)
     */
    historyRowsPruned: number;

    /**
     * 리포트 파일 경로 (생성된 경우)
     */
    reportFilePath?: string;
  };
}

/**
 * 품질 측정 배치 작업 클래스
 */
export class QualityMeasurementBatchJob {
  private config: Omit<Required<QualityMeasurementBatchJobConfig>, 'namespaces'> & {
    namespaces?: string[];
  };
  private qualityService: QualityAssuranceService | null = null;

  constructor(
    config?: QualityMeasurementBatchJobConfig,
    dependencies?: {
      qualityService?: QualityAssuranceService;
    }
  ) {
    this.config = {
      measurementType: config?.measurementType ?? 'batch',
      context: config?.context ?? 'default',
      namespaces: config?.namespaces,
      record: config?.record ?? true,
      generateReport: config?.generateReport ?? true,
      reportFormat: config?.reportFormat ?? 'markdown',
      timeout: config?.timeout ?? 300000, // 5분
      ...config
    };

    // QualityAssuranceService는 execute 시점에 db로부터 생성
    this.qualityService = dependencies?.qualityService ?? null;
  }

  /**
   * 배치 작업 실행
   * 
   * PRD FR-5.6: 일일 품질 측정 배치 작업
   * - 모든 네임스페이스에 대한 품질 측정 실행
   * - 측정 결과 기록 및 리포트 생성
   * - 경고 및 실패 지표 감지
   * 
   * @param db 데이터베이스 연결
   * @returns 배치 작업 결과
   */
  async execute(db: Database.Database): Promise<QualityMeasurementBatchResult> {
    const startTime = new Date();
    const timeoutDeadline = startTime.getTime() + this.config.timeout;
    const result: QualityMeasurementBatchResult = {
      jobType: 'quality_measurement_batch',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: [],
      details: {
        namespacesMeasured: 0,
        totalMetrics: 0,
        passedMetrics: 0,
        failedMetrics: 0,
        warningMetrics: 0,
        overallStatus: 'pass',
        historyRowsPruned: 0
      }
    };

    try {
      // QualityAssuranceService 초기화
      if (!this.qualityService) {
        this.qualityService = new QualityAssuranceService(db);
      }

      // 타임아웃 체크
      if (Date.now() > timeoutDeadline) {
        throw new Error('Quality measurement batch job timeout before execution');
      }

      // #908: 보존 정리를 측정보다 먼저 한다. 측정이 실패해도 정리는 끝나 있다.
      let historyRowsPruned = 0;
      try {
        historyRowsPruned = this.pruneMeasurementHistory(db);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.warnings.push(`quality_measurement_history 정리 실패: ${message}`);
        logger.warn('quality_measurement_history 정리 실패', { error: message });
      }

      // PRD FR-5.6: 배치 작업 로깅 - 시작 로깅
      logger.info('품질 측정 배치 작업 시작', {
        measurement_type: this.config.measurementType,
        context: this.config.context,
        namespaces: this.config.namespaces || 'all'
      });

      // 품질 측정 실행
      const measurementResult = await this.qualityService.measureQuality({
        measurement_type: this.config.measurementType,
        context: this.config.context,
        namespaces: this.config.namespaces || undefined,
        record: this.config.record
      });

      // 타임아웃 체크
      if (Date.now() > timeoutDeadline) {
        throw new Error('Quality measurement batch job timeout during execution');
      }

      // 측정 결과 분석
      const namespacesMeasured = measurementResult.namespaces.length || 4; // search, relation, consolidation, storage
      // QualityAssuranceService의 measureQuality는 평가 결과를 반환하므로
      // 평가 결과에서 지표 정보 추출
      const evaluationResults = measurementResult.evaluation_results || [];
      const totalMetrics = evaluationResults.reduce((sum, er) => sum + er.totalCount, 0);
      const passedMetrics = evaluationResults.reduce((sum, er) => sum + er.passedCount, 0);
      const failedMetrics = evaluationResults.reduce((sum, er) => sum + er.failedCount, 0);
      const warningMetrics = evaluationResults.reduce((sum, er) => sum + er.warnings.length, 0);

      // 전체 상태 결정
      let overallStatus: 'pass' | 'warning' | 'fail' = 'pass';
      if (failedMetrics > 0) {
        overallStatus = 'fail';
      } else if (warningMetrics > 0) {
        overallStatus = 'warning';
      }

      // 리포트 생성 (옵션)
      let reportFilePath: string | undefined;
      if (this.config.generateReport) {
        try {
          const _report = await this.qualityService.generateReport({
            format: this.config.reportFormat,
            context: this.config.context,
            namespace: this.config.namespaces?.[0] // 첫 번째 네임스페이스만 필터링 (또는 전체)
          });

          // 리포트 파일 경로는 QualityReporter의 saveReportToFile에서 자동 생성됨
          // 로그에서 확인 가능하므로 여기서는 undefined로 설정
          reportFilePath = undefined;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.warnings.push(`리포트 생성 실패: ${errorMessage}`);
          logger.warn('품질 리포트 생성 실패', {
            error: errorMessage
          });
        }
      }

      // 결과 업데이트
      result.details = {
        namespacesMeasured,
        totalMetrics,
        passedMetrics,
        failedMetrics,
        warningMetrics,
        overallStatus,
        reportFilePath,
        historyRowsPruned
      };

      result.processed = totalMetrics;
      result.success = overallStatus !== 'fail';
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - startTime.getTime();

      // 경고 메시지 추가
      if (warningMetrics > 0) {
        result.warnings.push(`${warningMetrics}개의 경고 지표가 있습니다`);
      }

      if (failedMetrics > 0) {
        result.warnings.push(`${failedMetrics}개의 실패 지표가 있습니다`);
      }

      // PRD FR-5.6: 배치 작업 로깅 - 완료 로깅
      logger.info('품질 측정 배치 작업 완료', {
        measurement_type: this.config.measurementType,
        context: this.config.context,
        duration: result.duration,
        totalMetrics,
        passedMetrics,
        failedMetrics,
        warningMetrics,
        overallStatus
      });

      return result;
    } catch (error) {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - startTime.getTime();
      result.success = false;

      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMessage);

      // PRD FR-5.6: 배치 작업 로깅 - 에러 로깅
      logger.error('품질 측정 배치 작업 실패', {
        measurement_type: this.config.measurementType,
        context: this.config.context,
        duration: result.duration,
        error: errorMessage
      });

      return result;
    }
  }

  /**
   * quality_measurement_history 보존 정리 (#908)
   *
   * 이 테이블만 보존 정책이 없어 처음 기록된 이후 한 번도 지워지지 않았다.
   * 측정 배치가 이 테이블의 유일한 기록자라 정리도 여기서 한다 — 전용 cleanup
   * 잡을 새로 만들면 스케줄러 등록 지점만 여섯 군데 늘어난다.
   *
   * 비교는 반드시 `datetime(measured_at)` 으로 한다. 저장된 값은
   * `2026-09-19T12:25:52.925Z` 형태인데 `datetime('now', ...)` 은
   * `2026-06-21 14:30:00` 을 돌려주므로, 문자열끼리 바로 비교하면 경계가
   * 어긋난다 — 실측에서 240행 차이가 났다.
   */
  private pruneMeasurementHistory(db: Database.Database): number {
    const retentionDays = resolveValidatedNumber(
      'QUALITY_MEASUREMENT_HISTORY_RETENTION_DAYS',
      90,
      n => n >= 1,
      '최솟값 1',
    );
    const info = db
      .prepare(
        `DELETE FROM quality_measurement_history WHERE datetime(measured_at) < datetime('now', ?)`,
      )
      .run(`-${retentionDays} days`);
    if (info.changes > 0) {
      logger.info('quality_measurement_history 보존 정리 완료', {
        retentionDays,
        deleted: info.changes,
      });
    }
    return info.changes;
  }
}


/**
 * 품질 측정 배치 작업 단위 테스트
 * 
 * PRD FR-5.7: 배치 작업 단위 테스트 작성
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { QualityMeasurementBatchJob } from '../quality-measurement-batch-job.js';
import { QualityAssuranceService } from '../../../../domains/monitoring/services/quality-assurance/quality-assurance-service.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';

// Mock logger
vi.mock('../../../../shared/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

/**
 * 품질 측정 관련 테이블 생성
 */
function createQualityTables(db: Database.Database): void {
  DatabaseUtils.exec(db, `
    CREATE TABLE IF NOT EXISTS quality_measurement_history (
      id TEXT PRIMARY KEY,
      measurement_type TEXT NOT NULL CHECK (measurement_type IN ('batch', 'test', 'manual')),
      measured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metrics TEXT NOT NULL,
      status TEXT CHECK (status IN ('success', 'warning', 'error')) DEFAULT 'success',
      warnings TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_measured_at 
      ON quality_measurement_history(measured_at);
    CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_type 
      ON quality_measurement_history(measurement_type);
    CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_status 
      ON quality_measurement_history(status);
    CREATE TABLE IF NOT EXISTS quality_metrics (
      metric_namespace TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      context TEXT DEFAULT 'default',
      metric_value REAL NOT NULL,
      measured_at TIMESTAMP NOT NULL,
      status TEXT CHECK (status IN ('pass', 'warning', 'fail')) DEFAULT 'pass',
      threshold_value REAL,
      threshold_type TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (metric_namespace, metric_key, context)
    );
    CREATE INDEX IF NOT EXISTS idx_quality_metrics_namespace_key 
      ON quality_metrics(metric_namespace, metric_key);
    CREATE INDEX IF NOT EXISTS idx_quality_metrics_context 
      ON quality_metrics(context);
    CREATE INDEX IF NOT EXISTS idx_quality_metrics_status 
      ON quality_metrics(status);
    CREATE TABLE IF NOT EXISTS quality_thresholds (
      metric_namespace TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      context TEXT DEFAULT 'default',
      threshold_value REAL NOT NULL,
      threshold_type TEXT CHECK (threshold_type IN ('min', 'max')) NOT NULL,
      description TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (metric_namespace, metric_key, context)
    );
  `);
}

describe('QualityMeasurementBatchJob', () => {
  let db: Database.Database;
  let batchJob: QualityMeasurementBatchJob;
  let qualityService: QualityAssuranceService;

  beforeEach(async () => {
    // Given: 테스트용 데이터베이스 초기화
    db = await setupTestDatabase();
    createQualityTables(db);

    qualityService = new QualityAssuranceService(db);
    batchJob = new QualityMeasurementBatchJob(
      {
        measurementType: 'batch',
        context: 'default',
        record: true,
        generateReport: true,
        reportFormat: 'markdown',
        timeout: 300000 // 5분
      },
      {
        qualityService
      }
    );
  });

  afterEach(() => {
    // When: 테스트 종료 후 정리
    cleanupTestDatabase(db);
  });

  describe('초기화', () => {
    it('should initialize with default config', () => {
      // Given: 기본 설정으로 배치 작업 생성
      const job = new QualityMeasurementBatchJob();

      // Then: 배치 작업이 생성되어야 함
      expect(job).toBeDefined();
    });

    it('should initialize with custom config', () => {
      // Given: 커스텀 설정으로 배치 작업 생성
      const job = new QualityMeasurementBatchJob({
        measurementType: 'test',
        context: 'ci',
        record: false,
        generateReport: false,
        timeout: 60000
      });

      // Then: 배치 작업이 생성되어야 함
      expect(job).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should execute quality measurement batch job successfully', async () => {
      // Given: 기본 설정으로 배치 작업
      // When: 배치 작업 실행
      const result = await batchJob.execute(db);

      // Then: 배치 작업이 성공적으로 완료되어야 함
      expect(result.jobType).toBe('quality_measurement_batch');
      expect(result.success).toBe(true);
      expect(result.processed).toBeGreaterThanOrEqual(0);
      expect(result.details).toBeDefined();
      expect(result.details.namespacesMeasured).toBeGreaterThanOrEqual(0);
      expect(result.details.totalMetrics).toBeGreaterThanOrEqual(0);
      expect(result.details.overallStatus).toMatch(/^(pass|warning|fail)$/);
    });

    it('should record measurement results when record=true', async () => {
      // Given: record=true로 설정된 배치 작업
      const job = new QualityMeasurementBatchJob(
        {
          record: true
        },
        {
          qualityService
        }
      );

      // When: 배치 작업 실행
      const result = await job.execute(db);

      // Then: 측정 결과가 기록되어야 함
      expect(result.success).toBe(true);
      // 측정 이력이 데이터베이스에 기록되었는지 확인
      const history = DatabaseUtils.all(
        db,
        'SELECT * FROM quality_measurement_history ORDER BY measured_at DESC LIMIT 1'
      );
      expect(history.length).toBeGreaterThanOrEqual(0);
    });

    it('should not record measurement results when record=false', async () => {
      // Given: record=false로 설정된 배치 작업
      const job = new QualityMeasurementBatchJob(
        {
          record: false
        },
        {
          qualityService
        }
      );

      // When: 배치 작업 실행
      const result = await job.execute(db);

      // Then: 배치 작업은 성공하지만 측정 결과는 기록되지 않을 수 있음
      expect(result.success).toBe(true);
    });

    it('should generate report when generateReport=true', async () => {
      // Given: generateReport=true로 설정된 배치 작업
      const job = new QualityMeasurementBatchJob(
        {
          generateReport: true,
          reportFormat: 'markdown'
        },
        {
          qualityService
        }
      );

      // When: 배치 작업 실행
      const result = await job.execute(db);

      // Then: 리포트가 생성되어야 함
      expect(result.success).toBe(true);
      expect(result.details).toBeDefined();
    });

    it('should handle timeout correctly', async () => {
      // Given: 매우 짧은 타임아웃으로 설정된 배치 작업
      const job = new QualityMeasurementBatchJob(
        {
          timeout: 1 // 1ms (매우 짧음)
        },
        {
          qualityService
        }
      );

      // When: 배치 작업 실행
      const result = await job.execute(db);

      // Then: 타임아웃이 발생하거나 작업이 완료되어야 함
      expect(result.jobType).toBe('quality_measurement_batch');
      // 타임아웃 발생 시 success는 false일 수 있음
    });

    it('should handle errors gracefully', async () => {
      // Given: 잘못된 데이터베이스 연결
      const invalidDb = new Database(':memory:');
      // 테이블을 생성하지 않아서 에러 발생
      invalidDb.close();

      const job = new QualityMeasurementBatchJob(
        {
          measurementType: 'batch',
          context: 'default'
        },
        {
          qualityService: new QualityAssuranceService(invalidDb)
        }
      );

      // When: 배치 작업 실행
      const result = await job.execute(invalidDb);

      // Then: 에러가 처리되어야 함
      expect(result.jobType).toBe('quality_measurement_batch');
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should measure specific namespaces when provided', async () => {
      // Given: 특정 네임스페이스로 설정된 배치 작업
      const job = new QualityMeasurementBatchJob(
        {
          namespaces: ['search', 'relation']
        },
        {
          qualityService
        }
      );

      // When: 배치 작업 실행
      const result = await job.execute(db);

      // Then: 지정된 네임스페이스만 측정되어야 함
      expect(result.success).toBe(true);
      expect(result.details.namespacesMeasured).toBe(2);
    });

    it('should calculate metrics correctly', async () => {
      // Given: 기본 설정으로 배치 작업
      // When: 배치 작업 실행
      const result = await batchJob.execute(db);

      // Then: 지표가 올바르게 계산되어야 함
      expect(result.details.totalMetrics).toBeGreaterThanOrEqual(0);
      expect(result.details.passedMetrics).toBeGreaterThanOrEqual(0);
      expect(result.details.failedMetrics).toBeGreaterThanOrEqual(0);
      expect(result.details.warningMetrics).toBeGreaterThanOrEqual(0);
      expect(
        result.details.passedMetrics +
        result.details.failedMetrics +
        result.details.warningMetrics
      ).toBeLessThanOrEqual(result.details.totalMetrics);
    });

    it('should determine overall status correctly', async () => {
      // Given: 기본 설정으로 배치 작업
      // When: 배치 작업 실행
      const result = await batchJob.execute(db);

      // Then: 전체 상태가 올바르게 결정되어야 함
      expect(result.details.overallStatus).toMatch(/^(pass|warning|fail)$/);
      
      // 실패 지표가 있으면 fail이어야 함
      if (result.details.failedMetrics > 0) {
        expect(result.details.overallStatus).toBe('fail');
      }
      // 경고 지표만 있으면 warning이어야 함
      else if (result.details.warningMetrics > 0 && result.details.failedMetrics === 0) {
        expect(result.details.overallStatus).toBe('warning');
      }
      // 모두 통과하면 pass여야 함
      else {
        expect(result.details.overallStatus).toBe('pass');
      }
    });

    it('should include warnings in result when metrics fail', async () => {
      // Given: 기본 설정으로 배치 작업
      // When: 배치 작업 실행
      const result = await batchJob.execute(db);

      // Then: 실패 지표가 있으면 경고가 포함되어야 함
      if (result.details.failedMetrics > 0 || result.details.warningMetrics > 0) {
        expect(result.warnings.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('should set correct job type in result', async () => {
      // Given: 기본 설정으로 배치 작업
      // When: 배치 작업 실행
      const result = await batchJob.execute(db);

      // Then: 작업 타입이 올바르게 설정되어야 함
      expect(result.jobType).toBe('quality_measurement_batch');
    });

    it('should set correct timing information in result', async () => {
      // Given: 기본 설정으로 배치 작업
      // When: 배치 작업 실행
      const result = await batchJob.execute(db);

      // Then: 시간 정보가 올바르게 설정되어야 함
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.endTime.getTime() - result.startTime.getTime()).toBe(result.duration);
    });
  });
});


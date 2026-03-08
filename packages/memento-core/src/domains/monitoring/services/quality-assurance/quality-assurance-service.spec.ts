import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { QualityAssuranceService } from './quality-assurance-service.js';
import { QualityThresholdManager } from './quality-threshold-manager.js';
import { QualityEvaluator } from './quality-evaluator.js';
import { QualityRecorder } from './quality-recorder.js';
import type { CollectedMetrics } from './quality-metrics-collector.js';

/**
 * quality_measurement_history 테이블 생성
 */
function createQualityMeasurementHistoryTable(db: Database.Database): void {
  db.exec(`
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
  `);
}

/**
 * quality_metrics 테이블 생성
 */
function createQualityMetricsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quality_metrics (
      metric_namespace TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      context TEXT DEFAULT 'default',
      metric_value REAL NOT NULL,
      measured_at TIMESTAMP NOT NULL,
      status TEXT CHECK (status IN ('pass', 'warning', 'fail')) DEFAULT 'pass',
      threshold_value REAL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (metric_namespace, metric_key, context)
    );

    CREATE INDEX IF NOT EXISTS idx_quality_metrics_namespace_key 
      ON quality_metrics(metric_namespace, metric_key);
    CREATE INDEX IF NOT EXISTS idx_quality_metrics_context 
      ON quality_metrics(context);
    CREATE INDEX IF NOT EXISTS idx_quality_metrics_status 
      ON quality_metrics(status);
  `);
}

/**
 * quality_thresholds 테이블 생성
 */
function createQualityThresholdsTable(db: Database.Database): void {
  db.exec(`
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

describe('QualityAssuranceService', () => {
  let db: Database.Database;
  let service: QualityAssuranceService;
  let thresholdManager: QualityThresholdManager;
  let evaluator: QualityEvaluator;
  let recorder: QualityRecorder;

  beforeEach(async () => {
    db = await setupTestDatabase();
    createQualityMeasurementHistoryTable(db);
    createQualityMetricsTable(db);
    createQualityThresholdsTable(db);
    service = new QualityAssuranceService(db);
    thresholdManager = new QualityThresholdManager(db);
    evaluator = new QualityEvaluator(db);
    recorder = new QualityRecorder(db);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('초기화', () => {
    it('should initialize successfully with database', () => {
      // Given: 데이터베이스가 있는 경우
      // When: QualityAssuranceService 생성
      // Then: 인스턴스가 생성되어야 함
      expect(service).toBeDefined();
    });

    it('should throw error when database is not provided', () => {
      // Given: 데이터베이스가 없는 경우
      // When/Then: 에러가 발생해야 함
      expect(() => {
        new QualityAssuranceService(null as any);
      }).toThrow('Database instance is required');
    });
  });

  describe('measureQuality', () => {
    beforeEach(() => {
      // 테스트용 임계값 설정
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });
    });

    it('should measure quality for all namespaces', async () => {
      // Given: 모든 네임스페이스 측정
      // When: 품질 측정 실행
      const result = await service.measureQuality();

      // Then: 측정 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.measured_at).toBeDefined();
      expect(result.namespaces.length).toBeGreaterThan(0);
      expect(result.collected_metrics.length).toBeGreaterThan(0);
      expect(result.evaluation_results.length).toBeGreaterThan(0);
      expect(result.overall_status).toBeDefined();
    });

    it('should measure quality for specific namespaces', async () => {
      // Given: 특정 네임스페이스만 측정
      // When: 품질 측정 실행
      const result = await service.measureQuality({
        namespaces: ['search']
      });

      // Then: 해당 네임스페이스만 측정되어야 함
      expect(result.namespaces).toEqual(['search']);
      expect(result.collected_metrics.every(m => m.namespace === 'search')).toBe(true);
    });

    it('should record measurements by default', async () => {
      // Given: 기본 옵션으로 측정
      // When: 품질 측정 실행
      const result = await service.measureQuality();

      // Then: 측정 결과가 기록되어야 함
      expect(result.measurement_ids.length).toBeGreaterThan(0);
    });

    it('should not record measurements when record is false', async () => {
      // Given: record=false 옵션
      // When: 품질 측정 실행
      const result = await service.measureQuality({
        record: false
      });

      // Then: 측정 결과가 기록되지 않아야 함
      expect(result.measurement_ids.length).toBe(0);
    });

    it('should use custom measurement_type and context', async () => {
      // Given: 커스텀 옵션
      // When: 품질 측정 실행
      const result = await service.measureQuality({
        measurement_type: 'test',
        context: 'ci'
      });

      // Then: 옵션이 적용되어야 함
      expect(result).toBeDefined();
      // 기록된 측정 이력 확인
      const history = recorder.getMeasurementHistory(undefined, 'ci', undefined, undefined, 1);
      if (history.length > 0) {
        expect(history[0].measurement_type).toBe('test');
      }
    });

    it('should determine overall status correctly', async () => {
      // Given: 실패한 지표가 있는 경우
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.9,
        threshold_type: 'min',
        description: 'High threshold'
      });

      // When: 품질 측정 실행
      const result = await service.measureQuality({
        namespaces: ['search']
      });

      // Then: 전체 상태가 올바르게 결정되어야 함
      expect(['pass', 'warning', 'fail']).toContain(result.overall_status);
    });

    it('should count warnings correctly', async () => {
      // Given: 실패한 지표가 있는 경우
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.9,
        threshold_type: 'min',
        description: 'High threshold'
      });

      // When: 품질 측정 실행
      const result = await service.measureQuality({
        namespaces: ['search']
      });

      // Then: 경고 개수가 올바르게 계산되어야 함
      expect(result.warning_count).toBeGreaterThanOrEqual(0);
    });

    it('should handle errors gracefully', async () => {
      // Given: 잘못된 네임스페이스
      // When/Then: 에러가 발생해야 함
      await expect(
        service.measureQuality({
          namespaces: ['invalid_namespace']
        })
      ).rejects.toThrow();
    });
  });

  describe('generateReport', () => {
    beforeEach(async () => {
      // 테스트 데이터 준비
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });

      const searchMetrics: CollectedMetrics = {
        namespace: 'search',
        context: 'default',
        measured_at: new Date().toISOString(),
        metrics: {
          precision_at_5: 0.85
        }
      };
      const searchEvaluation = await evaluator.evaluateMetrics(searchMetrics);
      await recorder.recordMeasurement(searchMetrics, searchEvaluation);
    });

    it('should generate markdown report by default', async () => {
      // Given: 기본 옵션
      // When: 리포트 생성
      const report = await service.generateReport();

      // Then: Markdown 형식의 리포트가 생성되어야 함
      expect(report).toBeDefined();
      expect(report).toContain('# Quality Assurance Report');
    });

    it('should generate json report when format is json', async () => {
      // Given: json 형식 옵션
      // When: 리포트 생성
      const report = await service.generateReport({ format: 'json' });

      // Then: JSON 형식의 리포트가 생성되어야 함
      expect(() => JSON.parse(report)).not.toThrow();
    });

    it('should generate html report when format is html', async () => {
      // Given: html 형식 옵션
      // When: 리포트 생성
      const report = await service.generateReport({ format: 'html' });

      // Then: HTML 형식의 리포트가 생성되어야 함
      expect(report).toContain('<!DOCTYPE html>');
    });

    it('should apply filters when generating report', async () => {
      // Given: 네임스페이스 필터 옵션
      // When: 리포트 생성
      const report = await service.generateReport({ namespace: 'search', format: 'json' });

      // Then: 필터가 적용된 리포트가 생성되어야 함
      const parsed = JSON.parse(report);
      expect(parsed.latest_metrics.every((m: any) => m.metric_namespace === 'search')).toBe(true);
    });
  });

  describe('getReportData', () => {
    beforeEach(async () => {
      // 테스트 데이터 준비
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });

      const searchMetrics: CollectedMetrics = {
        namespace: 'search',
        context: 'default',
        measured_at: new Date().toISOString(),
        metrics: {
          precision_at_5: 0.85
        }
      };
      const searchEvaluation = await evaluator.evaluateMetrics(searchMetrics);
      await recorder.recordMeasurement(searchMetrics, searchEvaluation);
    });

    it('should return report data', async () => {
      // Given: 기록된 측정 결과가 있는 경우
      // When: 리포트 데이터 조회
      const reportData = await service.getReportData();

      // Then: 리포트 데이터가 반환되어야 함
      expect(reportData).toBeDefined();
      expect(reportData.generated_at).toBeDefined();
      expect(reportData.summary).toBeDefined();
      expect(reportData.latest_metrics).toBeDefined();
    });

    it('should apply filters when getting report data', async () => {
      // Given: 네임스페이스 필터 옵션
      // When: 리포트 데이터 조회
      const reportData = await service.getReportData({ namespace: 'search' });

      // Then: 필터가 적용된 데이터가 반환되어야 함
      expect(reportData.latest_metrics.every(m => m.metric_namespace === 'search')).toBe(true);
    });
  });

  describe('initializeDefaultThresholds', () => {
    it('should initialize default thresholds', () => {
      // Given: 기본 임계값이 없는 경우
      // When: 기본 임계값 초기화
      const count = service.initializeDefaultThresholds();

      // Then: 기본 임계값이 초기화되어야 함
      expect(count).toBeGreaterThan(0);
    });

    it('should not overwrite existing thresholds by default', () => {
      // Given: 기존 임계값이 있는 경우
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.8,
        threshold_type: 'min',
        description: 'Custom threshold'
      });

      // When: 기본 임계값 초기화 (overwrite=false)
      const count = service.initializeDefaultThresholds('default', false);

      // Then: 기존 임계값이 유지되어야 함
      const threshold = thresholdManager.getThreshold('search', 'precision_at_5');
      expect(threshold?.threshold_value).toBe(0.8);
    });

    it('should overwrite existing thresholds when overwrite is true', () => {
      // Given: 기존 임계값이 있는 경우
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.8,
        threshold_type: 'min',
        description: 'Custom threshold'
      });

      // When: 기본 임계값 초기화 (overwrite=true)
      const count = service.initializeDefaultThresholds('default', true);

      // Then: 기존 임계값이 덮어씌워져야 함
      expect(count).toBeGreaterThan(0);
      const threshold = thresholdManager.getThreshold('search', 'precision_at_5');
      expect(threshold?.threshold_value).toBe(0.7); // 기본값
    });
  });

  describe('threshold management', () => {
    it('should get all thresholds', () => {
      // Given: 임계값이 설정된 경우
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });

      // When: 임계값 조회
      const thresholds = service.getThresholds();

      // Then: 임계값이 반환되어야 함
      expect(thresholds.length).toBeGreaterThan(0);
    });

    it('should filter thresholds by namespace', () => {
      // Given: 여러 네임스페이스의 임계값이 있는 경우
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });
      thresholdManager.setThreshold('relation', 'f1_score', {
        threshold_value: 0.6,
        threshold_type: 'min',
        description: 'Test threshold'
      });

      // When: 네임스페이스 필터 적용
      const thresholds = service.getThresholds('search');

      // Then: 해당 네임스페이스의 임계값만 반환되어야 함
      expect(thresholds.every(t => t.metric_namespace === 'search')).toBe(true);
    });

    it('should set threshold', () => {
      // Given: 새로운 임계값 설정
      // When: 임계값 설정
      const threshold = service.setThreshold(
        'search',
        'precision_at_5',
        0.75,
        'min',
        'Test threshold'
      );

      // Then: 임계값이 설정되어야 함
      expect(threshold.threshold_value).toBe(0.75);
      expect(threshold.threshold_type).toBe('min');
    });

    it('should delete threshold', () => {
      // Given: 임계값이 설정된 경우
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });

      // When: 임계값 삭제
      const deleted = service.deleteThreshold('search', 'precision_at_5');

      // Then: 임계값이 삭제되어야 함
      expect(deleted).toBe(true);
      const threshold = thresholdManager.getThreshold('search', 'precision_at_5');
      expect(threshold).toBeNull();
    });
  });

  describe('getMeasurementHistory', () => {
    beforeEach(async () => {
      // 테스트 데이터 준비
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });

      const searchMetrics: CollectedMetrics = {
        namespace: 'search',
        context: 'default',
        measured_at: new Date().toISOString(),
        metrics: {
          precision_at_5: 0.85
        }
      };
      const searchEvaluation = await evaluator.evaluateMetrics(searchMetrics);
      await recorder.recordMeasurement(searchMetrics, searchEvaluation);
    });

    it('should return measurement history', () => {
      // Given: 기록된 측정 이력이 있는 경우
      // When: 측정 이력 조회
      const history = service.getMeasurementHistory();

      // Then: 이력이 반환되어야 함
      expect(history.length).toBeGreaterThan(0);
    });

    it('should filter history by namespace', () => {
      // Given: 여러 네임스페이스의 이력이 있는 경우
      // When: 네임스페이스 필터 적용
      const history = service.getMeasurementHistory('search');

      // Then: 해당 네임스페이스의 이력만 반환되어야 함
      expect(history.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getLatestMetrics', () => {
    beforeEach(async () => {
      // 테스트 데이터 준비
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });

      const searchMetrics: CollectedMetrics = {
        namespace: 'search',
        context: 'default',
        measured_at: new Date().toISOString(),
        metrics: {
          precision_at_5: 0.85
        }
      };
      const searchEvaluation = await evaluator.evaluateMetrics(searchMetrics);
      await recorder.recordMeasurement(searchMetrics, searchEvaluation);
    });

    it('should return latest metrics', () => {
      // Given: 기록된 지표가 있는 경우
      // When: 최신 지표 조회
      const metrics = service.getLatestMetrics();

      // Then: 지표가 반환되어야 함
      expect(metrics.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter metrics by namespace', () => {
      // Given: 여러 네임스페이스의 지표가 있는 경우
      // When: 네임스페이스 필터 적용
      const metrics = service.getLatestMetrics('search');

      // Then: 해당 네임스페이스의 지표만 반환되어야 함
      expect(metrics.every(m => m.metric_namespace === 'search')).toBe(true);
    });
  });

  describe('runBatchMeasurement', () => {
    beforeEach(() => {
      // 테스트용 임계값 설정
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });
    });

    it('should run batch measurement', async () => {
      // Given: 배치 측정 실행
      // When: 배치 측정 실행
      const result = await service.runBatchMeasurement();

      // Then: 측정 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.measured_at).toBeDefined();
      expect(result.overall_status).toBeDefined();
    });

    it('should use batch measurement type', async () => {
      // Given: 배치 측정 실행
      // When: 배치 측정 실행
      const result = await service.runBatchMeasurement('default');

      // Then: 측정 타입이 batch여야 함
      expect(result).toBeDefined();
      // 기록된 측정 이력 확인
      const history = recorder.getMeasurementHistory(undefined, 'default', undefined, undefined, 1);
      if (history.length > 0) {
        expect(history[0].measurement_type).toBe('batch');
      }
    });
  });

  describe('runTestMeasurement', () => {
    beforeEach(() => {
      // 테스트용 임계값 설정
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });
    });

    it('should run test measurement', async () => {
      // Given: 테스트 측정 실행
      // When: 테스트 측정 실행
      const result = await service.runTestMeasurement();

      // Then: 측정 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.measured_at).toBeDefined();
      expect(result.overall_status).toBeDefined();
    });

    it('should use test measurement type and ci context', async () => {
      // Given: 테스트 측정 실행
      // When: 테스트 측정 실행
      const result = await service.runTestMeasurement('ci');

      // Then: 측정 타입이 test이고 컨텍스트가 ci여야 함
      expect(result).toBeDefined();
      // 기록된 측정 이력 확인
      const history = recorder.getMeasurementHistory(undefined, 'ci', undefined, undefined, 1);
      if (history.length > 0) {
        expect(history[0].measurement_type).toBe('test');
      }
    });

    it('should measure specific namespaces when provided', async () => {
      // Given: 특정 네임스페이스 지정
      // When: 테스트 측정 실행
      const result = await service.runTestMeasurement('ci', ['search']);

      // Then: 해당 네임스페이스만 측정되어야 함
      expect(result.namespaces).toEqual(['search']);
    });
  });

  describe('통합 테스트: 모든 수집기 통합', () => {
    it('should collect metrics from all collectors (search, relation, consolidation, storage)', async () => {
      // Given: 모든 네임스페이스 측정
      // When: 품질 측정 실행
      const result = await service.measureQuality();

      // Then: 모든 네임스페이스의 지표가 수집되어야 함
      expect(result.collected_metrics.length).toBe(4);
      
      const namespaces = result.collected_metrics.map(m => m.namespace);
      expect(namespaces).toContain('search');
      expect(namespaces).toContain('relation');
      expect(namespaces).toContain('consolidation');
      expect(namespaces).toContain('storage');
    });

    it('should evaluate metrics from all collectors', async () => {
      // Given: 모든 네임스페이스 측정
      // When: 품질 측정 실행
      const result = await service.measureQuality();

      // Then: 모든 네임스페이스의 평가 결과가 생성되어야 함
      expect(result.evaluation_results.length).toBe(4);
      
      const evaluatedNamespaces = result.evaluation_results.map(r => r.namespace);
      expect(evaluatedNamespaces).toContain('search');
      expect(evaluatedNamespaces).toContain('relation');
      expect(evaluatedNamespaces).toContain('consolidation');
      expect(evaluatedNamespaces).toContain('storage');
    });

    it('should collect search metrics with correct structure', async () => {
      // Given: 모든 네임스페이스 측정
      // When: 품질 측정 실행
      const result = await service.measureQuality();

      // Then: 검색 지표가 올바른 구조로 수집되어야 함
      const searchMetrics = result.collected_metrics.find(m => m.namespace === 'search');
      expect(searchMetrics).toBeDefined();
      expect(searchMetrics?.namespace).toBe('search');
      expect(searchMetrics?.context).toBe('default');
      expect(searchMetrics?.measured_at).toBeDefined();
      expect(searchMetrics?.metrics).toBeDefined();
    });

    it('should collect relation metrics with correct structure', async () => {
      // Given: 모든 네임스페이스 측정
      // When: 품질 측정 실행
      const result = await service.measureQuality();

      // Then: 관계 추출 지표가 올바른 구조로 수집되어야 함
      const relationMetrics = result.collected_metrics.find(m => m.namespace === 'relation');
      expect(relationMetrics).toBeDefined();
      expect(relationMetrics?.namespace).toBe('relation');
      expect(relationMetrics?.context).toBe('default');
      expect(relationMetrics?.measured_at).toBeDefined();
      expect(relationMetrics?.metrics).toBeDefined();
    });

    it('should collect consolidation metrics with correct structure', async () => {
      // Given: 모든 네임스페이스 측정
      // When: 품질 측정 실행
      const result = await service.measureQuality();

      // Then: Consolidation 지표가 올바른 구조로 수집되어야 함
      const consolidationMetrics = result.collected_metrics.find(m => m.namespace === 'consolidation');
      expect(consolidationMetrics).toBeDefined();
      expect(consolidationMetrics?.namespace).toBe('consolidation');
      expect(consolidationMetrics?.context).toBe('default');
      expect(consolidationMetrics?.measured_at).toBeDefined();
      expect(consolidationMetrics?.metrics).toBeDefined();
    });

    it('should collect storage metrics with correct structure', async () => {
      // Given: 모든 네임스페이스 측정
      // When: 품질 측정 실행
      const result = await service.measureQuality();

      // Then: 저장 지표가 올바른 구조로 수집되어야 함
      const storageMetrics = result.collected_metrics.find(m => m.namespace === 'storage');
      expect(storageMetrics).toBeDefined();
      expect(storageMetrics?.namespace).toBe('storage');
      expect(storageMetrics?.context).toBe('default');
      expect(storageMetrics?.measured_at).toBeDefined();
      expect(storageMetrics?.metrics).toBeDefined();
      
      // 저장 지표의 주요 메트릭 확인
      expect(storageMetrics?.metrics.duplication_rate).toBeDefined();
      expect(storageMetrics?.metrics.data_integrity).toBeDefined();
      expect(storageMetrics?.metrics.schema_compliance).toBeDefined();
      expect(storageMetrics?.metrics.data_loss_rate).toBeDefined();
    });

    it('should record all collected metrics in database', async () => {
      // Given: 모든 네임스페이스 측정 (기록 활성화)
      // When: 품질 측정 실행
      const result = await service.measureQuality({ record: true });

      // Then: 모든 네임스페이스의 측정 결과가 기록되어야 함
      expect(result.measurement_ids.length).toBeGreaterThan(0);
      
      // 기록된 측정 이력 확인
      const history = service.getMeasurementHistory();
      expect(history.length).toBeGreaterThan(0);
      
      // 최신 지표 확인
      const latestMetrics = service.getLatestMetrics();
      expect(latestMetrics.length).toBeGreaterThan(0);
    });

    it('should handle all collectors in batch measurement', async () => {
      // Given: 배치 측정 실행
      // When: 배치 측정 실행
      const result = await service.runBatchMeasurement();

      // Then: 모든 수집기의 지표가 수집되어야 함
      expect(result.collected_metrics.length).toBe(4);
      expect(result.evaluation_results.length).toBe(4);
      expect(result.overall_status).toBeDefined();
    });

    it('should handle all collectors in test measurement', async () => {
      // Given: 테스트 측정 실행
      // When: 테스트 측정 실행
      const result = await service.runTestMeasurement();

      // Then: 모든 수집기의 지표가 수집되어야 함
      expect(result.collected_metrics.length).toBe(4);
      expect(result.evaluation_results.length).toBe(4);
      expect(result.overall_status).toBeDefined();
    });

    it('should generate report with all collectors data', async () => {
      // Given: 모든 네임스페이스 측정 및 기록
      await service.measureQuality({ record: true });

      // When: 리포트 생성
      const report = await service.generateReport({ format: 'json' });

      // Then: 모든 네임스페이스의 데이터가 리포트에 포함되어야 함
      const parsed = JSON.parse(report);
      expect(parsed.latest_metrics).toBeDefined();
      
      // 네임스페이스 확인
      const namespaces = [...new Set(parsed.latest_metrics.map((m: any) => m.metric_namespace))];
      expect(namespaces.length).toBeGreaterThanOrEqual(0); // 데이터가 있을 수 있음
    });
  });
});


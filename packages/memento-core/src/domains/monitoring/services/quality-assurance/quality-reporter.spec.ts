import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { QualityReporter, isReportFormat, type ReportFormat } from './quality-reporter.js';
import { QualityRecorder } from './quality-recorder.js';
import { QualityEvaluator } from './quality-evaluator.js';
import { QualityThresholdManager } from './quality-threshold-manager.js';
import type { CollectedMetrics } from './quality-metrics-collector.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';

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

describe('QualityReporter', () => {
  let db: Database.Database;
  let reporter: QualityReporter;
  let recorder: QualityRecorder;
  let evaluator: QualityEvaluator;
  let thresholdManager: QualityThresholdManager;

  beforeEach(async () => {
    db = await setupTestDatabase();
    createQualityMeasurementHistoryTable(db);
    createQualityMetricsTable(db);
    createQualityThresholdsTable(db);
    reporter = new QualityReporter(db);
    recorder = new QualityRecorder(db);
    evaluator = new QualityEvaluator(db);
    thresholdManager = new QualityThresholdManager(db);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('초기화', () => {
    it('should initialize successfully with database', () => {
      // Given: 데이터베이스가 있는 경우
      // When: QualityReporter 생성
      // Then: 인스턴스가 생성되어야 함
      expect(reporter).toBeDefined();
    });

    it('should throw error when database is not provided', () => {
      // Given: 데이터베이스가 없는 경우
      // When/Then: 에러가 발생해야 함
      expect(() => {
        new QualityReporter(null as any);
      }).toThrow('Database instance is required');
    });
  });

  describe('collectReportData', () => {
    beforeEach(async () => {
      // 테스트 데이터 준비
      thresholdManager.setThreshold('search', 'precision_at_5', {
        threshold_value: 0.7,
        threshold_type: 'min',
        description: 'Test threshold'
      });
      thresholdManager.setThreshold('search', 'recall_at_5', {
        threshold_value: 0.6,
        threshold_type: 'min',
        description: 'Test threshold'
      });
      thresholdManager.setThreshold('relation', 'f1_score', {
        threshold_value: 0.6,
        threshold_type: 'min',
        description: 'Test threshold'
      });

      // 측정 결과 기록
      const searchMetrics: CollectedMetrics = {
        namespace: 'search',
        context: 'default',
        measured_at: new Date().toISOString(),
        metrics: {
          precision_at_5: 0.85,
          recall_at_5: 0.72
        }
      };
      const searchEvaluation = await evaluator.evaluateMetrics(searchMetrics);
      await recorder.recordMeasurement(searchMetrics, searchEvaluation);

      const relationMetrics: CollectedMetrics = {
        namespace: 'relation',
        context: 'default',
        measured_at: new Date().toISOString(),
        metrics: {
          f1_score: 0.75
        }
      };
      const relationEvaluation = await evaluator.evaluateMetrics(relationMetrics);
      await recorder.recordMeasurement(relationMetrics, relationEvaluation);
    });

    it('should collect report data with all metrics', async () => {
      // Given: 기록된 측정 결과가 있는 경우
      // When: 리포트 데이터 수집
      const reportData = await reporter.collectReportData();

      // Then: 리포트 데이터가 올바르게 수집되어야 함
      expect(reportData).toBeDefined();
      expect(reportData.generated_at).toBeDefined();
      expect(reportData.summary).toBeDefined();
      expect(reportData.summary.total_metrics).toBeGreaterThan(0);
      expect(reportData.latest_metrics.length).toBeGreaterThan(0);
      expect(reportData.history.length).toBeGreaterThan(0);
    });

    it('should calculate summary correctly', async () => {
      // Given: 기록된 측정 결과가 있는 경우
      // When: 리포트 데이터 수집
      const reportData = await reporter.collectReportData();

      // Then: 요약 정보가 올바르게 계산되어야 함
      expect(reportData.summary.total_metrics).toBe(3); // precision_at_5, recall_at_5, f1_score
      expect(reportData.summary.passed_metrics).toBeGreaterThanOrEqual(0);
      expect(reportData.summary.failed_metrics).toBeGreaterThanOrEqual(0);
      expect(reportData.summary.warning_metrics).toBeGreaterThanOrEqual(0);
      expect(reportData.summary.namespace_status.length).toBeGreaterThan(0);
    });

    it('should filter by namespace', async () => {
      // Given: 여러 네임스페이스의 측정 결과가 있는 경우
      // When: 네임스페이스 필터 적용
      const reportData = await reporter.collectReportData({ namespace: 'search' });

      // Then: 해당 네임스페이스의 지표만 포함되어야 함
      expect(reportData.latest_metrics.every(m => m.metric_namespace === 'search')).toBe(true);
    });

    it('should filter by context', async () => {
      // Given: 여러 컨텍스트의 측정 결과가 있는 경우
      // When: 컨텍스트 필터 적용
      const reportData = await reporter.collectReportData({ context: 'default' });

      // Then: 해당 컨텍스트의 지표만 포함되어야 함
      expect(reportData.latest_metrics.every(m => m.context === 'default')).toBe(true);
    });

    it('should include warnings for failed metrics', async () => {
      // Given: 실패한 지표가 있는 경우
      const failedMetrics: CollectedMetrics = {
        namespace: 'search',
        context: 'default',
        measured_at: new Date().toISOString(),
        metrics: {
          precision_at_5: 0.65 // 임계값 0.7 미만
        }
      };
      const failedEvaluation = await evaluator.evaluateMetrics(failedMetrics);
      await recorder.recordMeasurement(failedMetrics, failedEvaluation);

      // When: 리포트 데이터 수집
      const reportData = await reporter.collectReportData({ namespace: 'search' });

      // Then: 경고 정보가 포함되어야 함
      expect(reportData.warnings.length).toBeGreaterThan(0);
      expect(reportData.warnings[0].metric_namespace).toBe('search');
      expect(reportData.warnings[0].metric_key).toBe('precision_at_5');
      expect(reportData.warnings[0].measured_value).toBe(0.65);
      expect(reportData.warnings[0].threshold_value).toBe(0.7);
    });

    it('should include threshold_type in latest_metrics', async () => {
      // Given: 기록된 측정 결과가 있는 경우
      // When: 리포트 데이터 수집
      const reportData = await reporter.collectReportData();

      // Then: 최신 지표에 threshold_type이 포함되어야 함
      const metricWithThreshold = reportData.latest_metrics.find(
        m => m.threshold_value !== null
      );
      if (metricWithThreshold) {
        expect(metricWithThreshold.threshold_type).toBeDefined();
        expect(['min', 'max']).toContain(metricWithThreshold.threshold_type);
      }
    });
  });

  describe('generateMarkdownReport', () => {
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

    it('should generate markdown report', async () => {
      // Given: 리포트 데이터가 있는 경우
      const reportData = await reporter.collectReportData();

      // When: Markdown 리포트 생성
      const markdown = reporter.generateMarkdownReport(reportData);

      // Then: Markdown 형식의 리포트가 생성되어야 함
      expect(markdown).toBeDefined();
      expect(markdown).toContain('# Quality Assurance Report');
      expect(markdown).toContain('## 요약');
      expect(markdown).toContain('## 최신 품질 지표');
    });

    it('should include summary in markdown', async () => {
      // Given: 리포트 데이터가 있는 경우
      const reportData = await reporter.collectReportData();

      // When: Markdown 리포트 생성
      const markdown = reporter.generateMarkdownReport(reportData);

      // Then: 요약 정보가 포함되어야 함
      expect(markdown).toContain('전체 상태');
      expect(markdown).toContain('총 지표 수');
      expect(markdown).toContain('통과 지표');
      expect(markdown).toContain('실패 지표');
    });

    it('should include warnings section when warnings exist', async () => {
      // Given: 경고가 있는 리포트 데이터
      const failedMetrics: CollectedMetrics = {
        namespace: 'search',
        context: 'default',
        measured_at: new Date().toISOString(),
        metrics: {
          precision_at_5: 0.65 // 임계값 미달
        }
      };
      const failedEvaluation = await evaluator.evaluateMetrics(failedMetrics);
      await recorder.recordMeasurement(failedMetrics, failedEvaluation);

      const reportData = await reporter.collectReportData({ namespace: 'search' });

      // When: Markdown 리포트 생성
      const markdown = reporter.generateMarkdownReport(reportData);

      // Then: 경고 섹션이 포함되어야 함
      expect(markdown).toContain('## ⚠️ 경고');
      expect(markdown).toContain('precision_at_5');
    });

    it('should include namespace status section', async () => {
      // Given: 리포트 데이터가 있는 경우
      const reportData = await reporter.collectReportData();

      // When: Markdown 리포트 생성
      const markdown = reporter.generateMarkdownReport(reportData);

      // Then: 네임스페이스별 상태 섹션이 포함되어야 함
      if (reportData.summary.namespace_status.length > 0) {
        expect(markdown).toContain('## 네임스페이스별 상태');
      }
    });
  });

  describe('generateJsonReport', () => {
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

    it('should generate json report', async () => {
      // Given: 리포트 데이터가 있는 경우
      const reportData = await reporter.collectReportData();

      // When: JSON 리포트 생성
      const json = reporter.generateJsonReport(reportData);

      // Then: JSON 형식의 리포트가 생성되어야 함
      expect(json).toBeDefined();
      expect(() => JSON.parse(json)).not.toThrow();
      
      const parsed = JSON.parse(json);
      expect(parsed.generated_at).toBeDefined();
      expect(parsed.summary).toBeDefined();
      expect(parsed.latest_metrics).toBeDefined();
    });

    it('should include all report data in json', async () => {
      // Given: 리포트 데이터가 있는 경우
      const reportData = await reporter.collectReportData();

      // When: JSON 리포트 생성
      const json = reporter.generateJsonReport(reportData);
      const parsed = JSON.parse(json);

      // Then: 모든 리포트 데이터가 포함되어야 함
      expect(parsed.summary).toEqual(reportData.summary);
      expect(parsed.latest_metrics).toEqual(reportData.latest_metrics);
      expect(parsed.warnings).toEqual(reportData.warnings);
      expect(parsed.history).toBeDefined();
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
      const report = await reporter.generateReport();

      // Then: Markdown 형식의 리포트가 생성되어야 함
      expect(report).toContain('# Quality Assurance Report');
    });

    it('should generate markdown report when format is markdown', async () => {
      // Given: markdown 형식 옵션
      // When: 리포트 생성
      const report = await reporter.generateReport({ format: 'markdown' });

      // Then: Markdown 형식의 리포트가 생성되어야 함
      expect(report).toContain('# Quality Assurance Report');
    });

    it('should generate json report when format is json', async () => {
      // Given: json 형식 옵션
      // When: 리포트 생성
      const report = await reporter.generateReport({ format: 'json' });

      // Then: JSON 형식의 리포트가 생성되어야 함
      expect(() => JSON.parse(report)).not.toThrow();
      const parsed = JSON.parse(report);
      expect(parsed.generated_at).toBeDefined();
    });

    it('should reject html as a report format', async () => {
      expect(isReportFormat('html')).toBe(false);
      await expect(
        reporter.generateReport({ format: 'html' as ReportFormat })
      ).rejects.toThrow('Unsupported report format');
    });

    it('should throw error for unsupported format', async () => {
      // Given: 지원하지 않는 형식
      // When/Then: 에러가 발생해야 함
      await expect(
        reporter.generateReport({ format: 'xml' as ReportFormat })
      ).rejects.toThrow('Unsupported report format');
    });

    it('should apply filters when generating report', async () => {
      // Given: 네임스페이스 필터 옵션
      // When: 리포트 생성
      const report = await reporter.generateReport({ namespace: 'search', format: 'json' });

      // Then: 필터가 적용된 리포트가 생성되어야 함
      const parsed = JSON.parse(report);
      expect(parsed.latest_metrics.every((m: any) => m.metric_namespace === 'search')).toBe(true);
    });
  });

  describe('unmeasured 판정', () => {
    it('should keep a namespace without measurement history as unmeasured with zero counts', async () => {
      const reportData = await reporter.collectReportData({ namespace: 'search' });

      expect(reportData.summary.namespace_status).toEqual([
        {
          namespace: 'search',
          status: 'unmeasured',
          metrics_count: 0,
          passed_count: 0,
          failed_count: 0,
          no_threshold_count: 0,
          unmeasured_count: 0
        }
      ]);
    });

    it('should rank a warning namespace above unmeasured namespaces listed before it', async () => {
      db.prepare(
        `INSERT INTO quality_metrics (metric_namespace, metric_key, context, metric_value, measured_at, status)
         VALUES ('storage', 'integrity', 'default', 0.5, ?, 'warning')`
      ).run(new Date().toISOString());

      const reportData = await reporter.collectReportData();

      const byNamespace = Object.fromEntries(
        reportData.summary.namespace_status.map(ns => [ns.namespace, ns.status])
      );
      expect(byNamespace).toMatchObject({ search: 'unmeasured', relation: 'unmeasured', storage: 'warning' });
      expect(reportData.summary.overall_status).toBe('warning');
    });
  });

  describe('미측정 전환과 이력 보강 (#1812)', () => {
    async function record(metrics: CollectedMetrics): Promise<void> {
      await recorder.recordMeasurement(metrics, await evaluator.evaluateMetrics(metrics), { context: metrics.context });
    }

    it('should drop the old number of a metric that became unmeasured and keep the measured one', async () => {
      await record({
        namespace: 'search',
        context: 'nightly',
        measured_at: '2026-11-19T00:00:00.000Z',
        metrics: { precision_at_5: 0.7 }
      });
      await record({
        namespace: 'search',
        context: 'default',
        measured_at: '2026-11-19T00:00:00.000Z',
        metrics: { precision_at_5: 0.8, recall_at_5: 0.5 }
      });
      await record({
        namespace: 'search',
        context: 'default',
        measured_at: '2026-11-20T00:00:00.000Z',
        metrics: { precision_at_5: 0, recall_at_5: 0.6 },
        metric_states: { precision_at_5: 'unmeasured_no_ground_truth', recall_at_5: 'measured' }
      });

      const reportData = await reporter.collectReportData({ namespace: 'search' });

      const byKey = Object.fromEntries(reportData.latest_metrics.map(m => [m.metric_key, m]));
      expect(byKey.precision_at_5).toMatchObject({
        metric_value: null,
        status: 'unmeasured',
        measurement_state: 'unmeasured_no_ground_truth'
      });
      expect(byKey.recall_at_5).toMatchObject({ metric_value: 0.6 });

      const nightly = db.prepare(
        `SELECT metric_value FROM quality_metrics WHERE metric_namespace = 'search' AND metric_key = 'precision_at_5' AND context = 'nightly'`
      ).get();
      expect(nightly).toEqual({ metric_value: 0.7 });
    });

    it('should stamp an unmeasured row with the measurement time, not the report time', async () => {
      await record({
        namespace: 'search',
        context: 'default',
        measured_at: '2026-11-19T00:00:00.000Z',
        metrics: { precision_at_5: 0 },
        metric_states: { precision_at_5: 'unmeasured_no_ground_truth' }
      });

      const reportData = await reporter.collectReportData({ namespace: 'search' });

      const row = reportData.latest_metrics.find(m => m.metric_key === 'precision_at_5');
      expect(row).toMatchObject({ status: 'unmeasured', measured_at: '2026-11-19T00:00:00.000Z' });
    });

    it('should keep a history entry whose metrics JSON.parse rejects and still render markdown', async () => {
      // SQLite JSON_EXTRACT 는 JSON5 를 읽어 이력 조회를 통과하지만 JSON.parse 는 거부한다.
      db.prepare(
        `INSERT INTO quality_measurement_history (id, measurement_type, measured_at, metrics, status)
         VALUES ('quality_broken', 'batch', ?, ?, 'success')`
      ).run(new Date().toISOString(), "{namespace:'search',context:'default'}");

      const reportData = await reporter.collectReportData();

      const broken = reportData.history.find(h => h.id === 'quality_broken');
      expect(broken).toBeDefined();
      expect(broken?.namespace).toBeUndefined();
      expect(reporter.generateMarkdownReport(reportData)).toContain('| quality_broken... | batch | N/A | N/A |');
    });
  });
});

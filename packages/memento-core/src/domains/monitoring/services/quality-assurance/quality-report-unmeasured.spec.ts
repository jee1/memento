import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { QualityAssuranceService } from './quality-assurance-service.js';
import { QualityReporter } from './quality-reporter.js';
import { QualityThresholdManager } from './quality-threshold-manager.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import type { RepositoryProvider } from '../../../../shared/ports/repository-provider.port.js';

const stubRepositories = {} as RepositoryProvider;

function createQualityTables(db: Database.Database): void {
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

function insertStaleConsolidationRow(db: Database.Database): void {
  DatabaseUtils.run(
    db,
    `INSERT INTO quality_metrics (metric_namespace, metric_key, context, metric_value, measured_at, status)
     VALUES ('consolidation', 'kendalls_tau', 'default', 0, '2026-10-05T01:11:06.060Z', 'pass')`
  );
}

describe('일일 품질 리포트 미측정·죽은 지표·임계값 없음 (#1650)', () => {
  let db: Database.Database;
  let service: QualityAssuranceService;

  beforeEach(async () => {
    db = await setupTestDatabase();
    createQualityTables(db);
    service = new QualityAssuranceService(db, stubRepositories);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  it('정답셋이 없는 search 를 namespace_status 와 overall 에 unmeasured 로 드러낸다', async () => {
    await service.measureQuality();

    const report = await new QualityReporter(db).collectReportData();

    const search = report.summary.namespace_status.find(ns => ns.namespace === 'search');
    expect(search?.status).toBe('unmeasured');
    // unmeasured severity 변이(STATUS_SEVERITY.unmeasured=-1)를 잡으려면 overall 을 직접 고정 (#1661).
    expect(report.summary.overall_status).toBe('unmeasured');
    const searchRows = report.latest_metrics.filter(m => m.metric_namespace === 'search');
    expect(searchRows.length).toBeGreaterThan(0);
    expect(searchRows.every(m => m.status === 'unmeasured')).toBe(true);
  });

  it('측정 기록이 한 번도 없는 QUALITY_NAMESPACES 도 unmeasured 로 남긴다 (#1661)', async () => {
    const report = await new QualityReporter(db).collectReportData();

    for (const ns of ['search', 'relation', 'storage'] as const) {
      const entry = report.summary.namespace_status.find(row => row.namespace === ns);
      expect(entry, ns).toBeDefined();
      expect(entry?.status).toBe('unmeasured');
    }
    expect(report.summary.overall_status).toBe('unmeasured');
  });

  it('제거된 consolidation 지표는 측정 뒤 quality_metrics 와 리포트에서 사라진다', async () => {
    insertStaleConsolidationRow(db);

    await service.measureQuality();

    const report = await new QualityReporter(db).collectReportData();
    expect(report.summary.namespace_status.some(ns => ns.namespace === 'consolidation')).toBe(false);
    expect(report.latest_metrics.some(m => m.metric_namespace === 'consolidation')).toBe(false);
    expect(service.getLatestMetrics('consolidation')).toHaveLength(0);
  });

  it('임계값이 없는 지표는 pass 가 아니라 no_threshold 로 집계한다', async () => {
    await service.measureQuality();

    const report = await new QualityReporter(db).collectReportData();

    const storageRows = report.latest_metrics.filter(m => m.metric_namespace === 'storage');
    expect(storageRows.length).toBeGreaterThan(0);
    expect(storageRows.every(m => m.status === 'no_threshold')).toBe(true);
    expect(report.summary.passed_metrics).toBe(0);
    expect(report.summary.no_threshold_metrics).toBe(
      report.latest_metrics.filter(m => m.status === 'no_threshold').length
    );
    const storage = report.summary.namespace_status.find(ns => ns.namespace === 'storage');
    expect(storage?.status).toBe('no_threshold');
    expect(storage?.passed_count).toBe(0);
  });

  it('임계값이 있고 통과한 지표만 pass 로 집계한다', async () => {
    new QualityThresholdManager(db).setThreshold('storage', 'data_integrity', {
      threshold_value: 0.5,
      threshold_type: 'min',
      description: 'test',
    });
    await service.measureQuality();

    const report = await new QualityReporter(db).collectReportData({ namespace: 'storage' });

    const integrity = report.latest_metrics.find(m => m.metric_key === 'data_integrity');
    expect(integrity?.status).toBe('pass');
    expect(report.summary.passed_metrics).toBe(1);
    expect(report.summary.overall_status).toBe('no_threshold');
  });
});

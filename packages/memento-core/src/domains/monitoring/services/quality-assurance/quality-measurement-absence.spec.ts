import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { RelationMetricsCollector } from './relation-metrics-collector.js';
import { SearchMetricsCollector } from './search-metrics-collector.js';
import { QualityEvaluator } from './quality-evaluator.js';
import { QualityRecorder } from './quality-recorder.js';
import { QualityThresholdManager } from './quality-threshold-manager.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { QUALITY_METRIC_STATE } from './quality-metric-measurement.js';
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

describe('quality measurement absence (#1560)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
    createQualityTables(db);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  it('relation collector does not emit numeric zero without ground truth', async () => {
    const collector = new RelationMetricsCollector(db);
    const collected = await collector.collect('default');

    expect(collected.metadata?.has_ground_truth).toBe(false);
    expect(collected.metrics.precision).toBeUndefined();
    expect(collected.metric_states?.precision).toBe(
      QUALITY_METRIC_STATE.UNMEASURED_NO_GROUND_TRUTH
    );
  });

  it('search collector does not emit numeric zero without ground truth', async () => {
    const collector = new SearchMetricsCollector(db, stubRepositories);
    const collected = await collector.collect('default');

    expect(collected.metadata?.has_ground_truth).toBe(false);
    expect(collected.metrics.precision_at_5).toBeUndefined();
    expect(collected.metric_states?.precision_at_5).toBe(
      QUALITY_METRIC_STATE.UNMEASURED_NO_GROUND_TRUTH
    );
  });

  it('recorder preserves metadata and does not persist false zero for relation', async () => {
    const collector = new RelationMetricsCollector(db);
    const evaluator = new QualityEvaluator(db);
    const recorder = new QualityRecorder(db);
    const thresholds = new QualityThresholdManager(db);

    thresholds.setThreshold('relation', 'precision', {
      threshold_value: 0.5,
      threshold_type: 'min',
      description: 'test',
    });
    thresholds.setThreshold('relation', 'recall', {
      threshold_value: 0.5,
      threshold_type: 'min',
      description: 'test',
    });

    const collected = await collector.collect('default');
    const evaluation = await evaluator.evaluateMetrics(collected);
    expect(evaluation.status).toBe('pass');
    expect(evaluation.failedCount).toBe(0);

    const measurementId = await recorder.recordMeasurement(collected, evaluation);
    const history = DatabaseUtils.get(
      db,
      'SELECT metrics FROM quality_measurement_history WHERE id = ?',
      [measurementId]
    ) as { metrics: string };

    const payload = JSON.parse(history.metrics) as {
      metadata: { has_ground_truth: boolean };
      metric_states: Record<string, string>;
      metrics: Record<string, number>;
      unmeasured_metrics: Array<{ key: string }>;
    };

    expect(payload.metadata.has_ground_truth).toBe(false);
    expect(payload.metric_states.precision).toBe(QUALITY_METRIC_STATE.UNMEASURED_NO_GROUND_TRUTH);
    expect(payload.metrics.precision).toBeUndefined();
    expect(payload.unmeasured_metrics.some(m => m.key === 'precision')).toBe(true);

    const precisionRow = DatabaseUtils.get(
      db,
      'SELECT * FROM quality_metrics WHERE metric_namespace = ? AND metric_key = ?',
      ['relation', 'precision']
    );
    expect(precisionRow).toBeUndefined();
  });

  it('search path round-trip: collector → evaluator → recorder', async () => {
    const collector = new SearchMetricsCollector(db, stubRepositories);
    const evaluator = new QualityEvaluator(db);
    const recorder = new QualityRecorder(db);
    const thresholds = new QualityThresholdManager(db);

    thresholds.setThreshold('search', 'precision_at_5', {
      threshold_value: 0.7,
      threshold_type: 'min',
      description: 'test',
    });

    const collected = await collector.collect('default');
    const evaluation = await evaluator.evaluateMetrics(collected);
    expect(evaluation.status).toBe('pass');

    await recorder.recordMeasurement(collected, evaluation);

    const row = DatabaseUtils.get(
      db,
      'SELECT * FROM quality_metrics WHERE metric_namespace = ? AND metric_key = ?',
      ['search', 'precision_at_5']
    );
    expect(row).toBeUndefined();
  });
});

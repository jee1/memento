/**
 * 품질 보증 테이블 보정 (마이그레이션 009와 동일 DDL, idempotent).
 * quality_measurement_history, quality_metrics, quality_thresholds 및 인덱스.
 */

import Database from 'better-sqlite3';

export function ensureQualityAssuranceSchema(db: Database.Database): void {
  if (!db.open) {
    return;
  }
  db.exec(`
CREATE TABLE IF NOT EXISTS quality_measurement_history (
  id TEXT PRIMARY KEY,
  measurement_type TEXT NOT NULL CHECK (measurement_type IN ('batch', 'test', 'manual')),
  measured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metrics TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'warning', 'error')) DEFAULT 'success',
  warnings TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quality_metrics (
  metric_namespace TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT 'default',
  metric_value REAL NOT NULL,
  measured_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'warning', 'fail')) DEFAULT 'pass',
  threshold_value REAL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (metric_namespace, metric_key, context)
);

CREATE TABLE IF NOT EXISTS quality_thresholds (
  metric_namespace TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT 'default',
  threshold_value REAL NOT NULL,
  threshold_type TEXT NOT NULL CHECK (threshold_type IN ('min', 'max')),
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (metric_namespace, metric_key, context)
);

CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_measured_at
  ON quality_measurement_history(measured_at);
CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_type
  ON quality_measurement_history(measurement_type);
CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_status
  ON quality_measurement_history(status);

CREATE INDEX IF NOT EXISTS idx_quality_metrics_namespace_key
  ON quality_metrics(metric_namespace, metric_key);
CREATE INDEX IF NOT EXISTS idx_quality_metrics_context
  ON quality_metrics(context);
CREATE INDEX IF NOT EXISTS idx_quality_metrics_status
  ON quality_metrics(status);
CREATE INDEX IF NOT EXISTS idx_quality_metrics_measured_at
  ON quality_metrics(measured_at);

CREATE INDEX IF NOT EXISTS idx_quality_thresholds_namespace_key
  ON quality_thresholds(metric_namespace, metric_key);
CREATE INDEX IF NOT EXISTS idx_quality_thresholds_context
  ON quality_thresholds(context);
`);
}

/**
 * Migration: 028 — telemetry_daily_metrics
 * Version: 28.0
 * Note: owner_id uses empty string for "global" bucket so UNIQUE(date, event_type, owner_id) works in SQLite.
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class TelemetryDailyMetricsMigration implements Migration {
  version = '28.0';
  name = 'telemetry-daily-metrics';
  description = 'Create telemetry_daily_metrics for rolled-up telemetry';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async validateAfter(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry_daily_metrics (
        id              TEXT PRIMARY KEY,
        date            TEXT NOT NULL,
        event_type      TEXT NOT NULL,
        owner_id        TEXT NOT NULL DEFAULT '',
        event_count     INTEGER NOT NULL DEFAULT 0,
        avg_latency_ms  REAL,
        error_count     INTEGER NOT NULL DEFAULT 0,
        updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(date, event_type, owner_id)
      );

      CREATE INDEX IF NOT EXISTS idx_tdm_date       ON telemetry_daily_metrics(date);
      CREATE INDEX IF NOT EXISTS idx_tdm_event_type ON telemetry_daily_metrics(event_type);
      CREATE INDEX IF NOT EXISTS idx_tdm_owner_id   ON telemetry_daily_metrics(owner_id);
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec(`DROP TABLE IF EXISTS telemetry_daily_metrics;`);
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('28.0');
    }
  }
}

export default TelemetryDailyMetricsMigration;

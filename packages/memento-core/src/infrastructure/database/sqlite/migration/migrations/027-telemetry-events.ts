/**
 * Migration: 027 — telemetry_events
 * Version: 27.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class TelemetryEventsMigration implements Migration {
  version = '27.0';
  name = 'telemetry-events';
  description = 'Create telemetry_events table for MCP tool observability';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async validateAfter(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id          TEXT PRIMARY KEY,
        event_type  TEXT NOT NULL,
        request_id  TEXT NOT NULL,
        owner_id    TEXT,
        latency_ms  INTEGER,
        outcome     TEXT NOT NULL,
        error_code  TEXT,
        extra_data  TEXT,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE INDEX IF NOT EXISTS idx_te_event_type  ON telemetry_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_te_request_id  ON telemetry_events(request_id);
      CREATE INDEX IF NOT EXISTS idx_te_owner_id    ON telemetry_events(owner_id);
      CREATE INDEX IF NOT EXISTS idx_te_created_at  ON telemetry_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_te_outcome_err ON telemetry_events(outcome)
        WHERE outcome != 'success';
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec(`DROP TABLE IF EXISTS telemetry_events;`);
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('27.0');
    }
  }
}

export default TelemetryEventsMigration;

/**
 * Migration: 058 — llm usage attempt/logical (#1546)
 * Version: 58.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class LlmUsageTelemetryMigration implements Migration {
  version = '58.0';
  name = 'llm-usage-telemetry';
  description = 'Per-feature LLM attempt and logical outcome rows for quota observability (#1546)';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_usage_attempt (
        id                  TEXT PRIMARY KEY,
        logical_request_id  TEXT NOT NULL,
        attempt_index       INTEGER NOT NULL,
        feature             TEXT NOT NULL,
        provider            TEXT NOT NULL,
        model               TEXT NOT NULL,
        outcome             TEXT NOT NULL,
        failure_reason      TEXT,
        attempt_coverage    TEXT NOT NULL,
        input_tokens        INTEGER,
        output_tokens       INTEGER,
        usage_unknown       INTEGER NOT NULL DEFAULT 0,
        latency_ms          INTEGER,
        run_id              TEXT,
        pacific_date        TEXT NOT NULL,
        created_at          TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_usage_attempt_pacific_feature
        ON llm_usage_attempt(pacific_date, feature);
      CREATE INDEX IF NOT EXISTS idx_llm_usage_attempt_logical
        ON llm_usage_attempt(logical_request_id);

      CREATE TABLE IF NOT EXISTS llm_usage_logical (
        id                  TEXT PRIMARY KEY,
        logical_request_id  TEXT NOT NULL UNIQUE,
        feature             TEXT NOT NULL,
        provider            TEXT,
        model               TEXT,
        final_path          TEXT NOT NULL,
        final_reason        TEXT,
        attempt_count       INTEGER NOT NULL,
        rate_limited_count  INTEGER NOT NULL,
        run_id              TEXT,
        pacific_date        TEXT NOT NULL,
        created_at          TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_usage_logical_pacific_feature
        ON llm_usage_logical(pacific_date, feature);
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec(`
      DROP TABLE IF EXISTS llm_usage_logical;
      DROP TABLE IF EXISTS llm_usage_attempt;
    `);
    const ver = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memento_schema_version'`)
      .get();
    if (ver) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('58.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const t = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='llm_usage_attempt'`)
      .get();
    if (!t) {
      throw new Error('Migration 058 did not create llm_usage_attempt');
    }
  }
}

export default LlmUsageTelemetryMigration;

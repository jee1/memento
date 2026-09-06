/**
 * Migration: 044 — job_run
 * Version: 44.0
 * Durable batch job execution history (Issue #833).
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

function objectExists(db: Database.Database, type: 'table' | 'index', name: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name),
  );
}

export class JobRunMigration implements Migration {
  version = '44.0';
  name = 'job-run';
  description = 'Add durable job_run table for schedule/manual batch execution history';

  async validateBefore(_db: Database.Database): Promise<void> {
    // no dependency on other tables
  }

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS job_run (
        id TEXT PRIMARY KEY,
        job_name TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        success INTEGER NOT NULL CHECK (success IN (0, 1)),
        duration_ms INTEGER NOT NULL,
        processed INTEGER,
        error_count INTEGER,
        details_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_job_run_job_started
        ON job_run(job_name, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_job_run_started
        ON job_run(started_at);
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS job_run');
    if (objectExists(db, 'table', 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!objectExists(db, 'table', 'job_run')) {
      throw new Error('Migration 044 did not create job_run table');
    }
  }
}

export default JobRunMigration;

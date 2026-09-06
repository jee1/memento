/**
 * Migration: 046 — job_run_log
 * Version: 46.0
 * Structured log lines linked to job_run (Issue #834).
 * (045 is vec-orphan-cleanup on main — do not reuse.)
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

function objectExists(db: Database.Database, type: 'table' | 'index', name: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name),
  );
}

export class JobRunLogMigration implements Migration {
  version = '46.0';
  name = 'job-run-log';
  description = 'Add job_run_log table for structured per-run logs (FK CASCADE to job_run)';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!objectExists(db, 'table', 'job_run')) {
      throw new Error('Migration 046 requires job_run table (044)');
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS job_run_log (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        ts TEXT NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
        message TEXT NOT NULL,
        context_json TEXT,
        FOREIGN KEY (run_id) REFERENCES job_run(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_job_run_log_run_ts
        ON job_run_log(run_id, ts ASC, id ASC);
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS job_run_log');
    if (objectExists(db, 'table', 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!objectExists(db, 'table', 'job_run_log')) {
      throw new Error('Migration 046 did not create job_run_log table');
    }
  }
}

export default JobRunLogMigration;

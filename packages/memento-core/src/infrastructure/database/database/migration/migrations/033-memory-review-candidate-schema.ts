/**
 * Migration: 033 — memory_review_candidate table (Issue #240)
 * Version: 33.0
 */
import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class MemoryReviewCandidateSchemaMigration implements Migration {
  version = '33.0';
  name = 'memory-review-candidate-schema';
  description =
    'Create memory_review_candidate for automatic memory review MVP (Issue #240)';

  private tableExists(db: Database.Database, tableName: string): boolean {
    const result = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(tableName);
    return !!result;
  }

  private indexExists(db: Database.Database, indexName: string): boolean {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
      .get(indexName) as { name: string } | undefined;
    return !!row;
  }

  async validateBefore(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_item')) {
      throw new Error('memory_item table does not exist. Cannot apply migration 033.');
    }
  }

  async up(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_item')) {
      return;
    }
    db.exec(`
CREATE TABLE IF NOT EXISTS memory_review_candidate (
  id TEXT PRIMARY KEY NOT NULL,
  memory_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','reviewed','dismissed','expired')),
  priority REAL NOT NULL,
  reason TEXT NOT NULL,
  due_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  dismissed_at TEXT,
  metadata_json TEXT,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
);
`);
    if (!this.indexExists(db, 'idx_memory_review_candidate_pending_memory_id')) {
      db.exec(`
CREATE UNIQUE INDEX idx_memory_review_candidate_pending_memory_id
  ON memory_review_candidate(memory_id)
  WHERE status = 'pending';
`);
    }
    if (!this.indexExists(db, 'idx_memory_review_candidate_queue')) {
      db.exec(`
CREATE INDEX idx_memory_review_candidate_queue
  ON memory_review_candidate(status, priority DESC, due_at ASC);
`);
    }
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_memory_review_candidate_queue');
    db.exec('DROP INDEX IF EXISTS idx_memory_review_candidate_pending_memory_id');
    db.exec('DROP TABLE IF EXISTS memory_review_candidate');
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('33.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_item')) {
      return;
    }
    if (!this.tableExists(db, 'memory_review_candidate')) {
      throw new Error('memory_review_candidate table was not created');
    }
    if (!this.indexExists(db, 'idx_memory_review_candidate_pending_memory_id')) {
      throw new Error('idx_memory_review_candidate_pending_memory_id was not created');
    }
    if (!this.indexExists(db, 'idx_memory_review_candidate_queue')) {
      throw new Error('idx_memory_review_candidate_queue was not created');
    }
  }
}

export default MemoryReviewCandidateSchemaMigration;

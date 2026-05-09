/**
 * Migration: 034 — memory_review_queue_health_snapshot (Issue #294)
 * Version: 34.0
 */
import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class ReviewQueueHealthSnapshotMigration implements Migration {
  version = '34.0';
  name = 'review-queue-health-snapshot';
  description =
    'Append-only samples of pending review queue health metrics for trend views (Issue #294)';

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
    if (!this.tableExists(db, 'memory_review_candidate')) {
      throw new Error(
        'memory_review_candidate table does not exist. Apply migration 033 before 034.',
      );
    }
  }

  async up(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_review_candidate')) {
      return;
    }
    db.exec(`
CREATE TABLE IF NOT EXISTS memory_review_queue_health_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sampled_at TEXT NOT NULL,
  pending_total INTEGER NOT NULL,
  created_last_1h INTEGER NOT NULL,
  reviewed_last_1h INTEGER NOT NULL,
  dismissed_last_1h INTEGER NOT NULL,
  expired_last_1h INTEGER NOT NULL,
  created_last_24h INTEGER NOT NULL,
  reviewed_last_24h INTEGER NOT NULL,
  dismissed_last_24h INTEGER NOT NULL,
  expired_last_24h INTEGER NOT NULL,
  net_flow_1h INTEGER NOT NULL,
  processing_ratio_1h REAL
);
`);
    if (!this.indexExists(db, 'idx_memory_review_queue_health_sampled')) {
      db.exec(`
CREATE INDEX idx_memory_review_queue_health_sampled
  ON memory_review_queue_health_snapshot(sampled_at DESC);
`);
    }
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_memory_review_queue_health_sampled');
    db.exec('DROP TABLE IF EXISTS memory_review_queue_health_snapshot');
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('34.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_review_candidate')) {
      return;
    }
    if (!this.tableExists(db, 'memory_review_queue_health_snapshot')) {
      throw new Error('memory_review_queue_health_snapshot table was not created');
    }
    if (!this.indexExists(db, 'idx_memory_review_queue_health_sampled')) {
      throw new Error('idx_memory_review_queue_health_sampled was not created');
    }
  }
}

export default ReviewQueueHealthSnapshotMigration;

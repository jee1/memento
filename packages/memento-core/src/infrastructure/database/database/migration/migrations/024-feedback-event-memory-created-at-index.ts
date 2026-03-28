/**
 * Migration: 024 - feedback_event (memory_id, created_at) composite index
 * Version: 24.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class FeedbackEventMemoryCreatedAtIndexMigration implements Migration {
  version = '24.0';
  name = 'feedback-event-memory-created-at-index';
  description =
    'Composite index on feedback_event(memory_id, created_at) for sliding-window net score queries';

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

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'feedback_event')) {
      return;
    }
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_feedback_memory_created_at ON feedback_event(memory_id, created_at)'
    );
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_feedback_memory_created_at');
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('24.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'feedback_event')) {
      return;
    }
    if (!this.indexExists(db, 'idx_feedback_memory_created_at')) {
      throw new Error('idx_feedback_memory_created_at index was not created');
    }
  }
}

export default FeedbackEventMemoryCreatedAtIndexMigration;

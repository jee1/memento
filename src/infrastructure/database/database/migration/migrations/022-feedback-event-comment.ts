/**
 * Migration: 022 - feedback_event comment (HTTP client text feedback)
 * Version: 22.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class FeedbackEventCommentMigration implements Migration {
  version = '22.0';
  name = 'feedback-event-comment';
  description = 'Add optional comment TEXT to feedback_event for client feedback messages';

  private tableExists(db: Database.Database, tableName: string): boolean {
    const result = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(tableName);
    return !!result;
  }

  private columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
    return columns.some((col) => col.name === columnName);
  }

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'feedback_event')) {
      return;
    }
    if (!this.columnExists(db, 'feedback_event', 'comment')) {
      db.exec('ALTER TABLE feedback_event ADD COLUMN comment TEXT');
    }
  }

  async down(db: Database.Database): Promise<void> {
    try {
      db.exec('ALTER TABLE feedback_event DROP COLUMN comment');
    } catch {
      /* SQLite < 3.35 */
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('22.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'feedback_event')) {
      return;
    }
    if (!this.columnExists(db, 'feedback_event', 'comment')) {
      throw new Error('comment column was not created on feedback_event');
    }
  }
}

export default FeedbackEventCommentMigration;

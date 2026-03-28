/**
 * Migration: 023 - feedback_event score_breakdown_json (US3: negative feedback context)
 * Version: 23.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class FeedbackEventScoreBreakdownMigration implements Migration {
  version = '23.0';
  name = 'feedback-event-score-breakdown';
  description = 'Add optional score_breakdown_json TEXT for recall score_breakdown snapshot on feedback';

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
    if (!this.columnExists(db, 'feedback_event', 'score_breakdown_json')) {
      db.exec('ALTER TABLE feedback_event ADD COLUMN score_breakdown_json TEXT');
    }
  }

  async down(db: Database.Database): Promise<void> {
    try {
      db.exec('ALTER TABLE feedback_event DROP COLUMN score_breakdown_json');
    } catch {
      /* SQLite < 3.35 */
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('23.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'feedback_event')) {
      return;
    }
    if (!this.columnExists(db, 'feedback_event', 'score_breakdown_json')) {
      throw new Error('score_breakdown_json column was not created on feedback_event');
    }
  }
}

export default FeedbackEventScoreBreakdownMigration;

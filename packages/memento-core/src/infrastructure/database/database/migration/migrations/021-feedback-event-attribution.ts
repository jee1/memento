/**
 * Migration: 021 - feedback_event session_id, agent_id (Recall Quality Feedback Loop)
 * Version: 21.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class FeedbackEventAttributionMigration implements Migration {
  version = '21.0';
  name = 'feedback-event-attribution';
  description = 'Add session_id and agent_id to feedback_event for MCP feedback attribution';

  private tableExists(db: Database.Database, tableName: string): boolean {
    const result = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(tableName);
    return !!result;
  }

  private columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
    return columns.some(col => col.name === columnName);
  }

  private indexExists(db: Database.Database, indexName: string): boolean {
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name=?`
    ).get(indexName) as { name: string } | undefined;
    return !!row;
  }

  async validateBefore(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'feedback_event')) {
      return;
    }
    const hasSession = this.columnExists(db, 'feedback_event', 'session_id');
    const hasAgent = this.columnExists(db, 'feedback_event', 'agent_id');
    if (hasSession !== hasAgent) {
      throw new Error(
        'feedback_event has partial attribution columns (session_id/agent_id). Manual fix required.'
      );
    }
    if (hasSession && hasAgent) {
      return;
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      const row = db.prepare(
        `SELECT version FROM memento_schema_version WHERE version = ?`
      ).get('21.0') as { version: string } | undefined;
      if (row) {
        throw new Error('Migration 021 has already been applied. Current schema version: 21.0');
      }
    }
  }

  async up(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'feedback_event')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS feedback_event (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          event TEXT CHECK (event IN ('used', 'edited', 'neglected', 'helpful', 'not_helpful')) NOT NULL,
          score REAL,
          comment TEXT,
          session_id TEXT,
          agent_id TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_feedback_memory_id ON feedback_event(memory_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_event ON feedback_event(event);
        CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback_event(created_at);
        CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback_event(session_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback_event(agent_id);
      `);
      return;
    }
    if (!this.columnExists(db, 'feedback_event', 'session_id')) {
      db.exec('ALTER TABLE feedback_event ADD COLUMN session_id TEXT');
    }
    if (!this.columnExists(db, 'feedback_event', 'agent_id')) {
      db.exec('ALTER TABLE feedback_event ADD COLUMN agent_id TEXT');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback_event(session_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback_event(agent_id)');
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_feedback_session');
    db.exec('DROP INDEX IF EXISTS idx_feedback_agent');
    try {
      db.exec('ALTER TABLE feedback_event DROP COLUMN session_id');
    } catch {
      /* SQLite < 3.35 */
    }
    try {
      db.exec('ALTER TABLE feedback_event DROP COLUMN agent_id');
    } catch {
      /* SQLite < 3.35 */
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('21.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.columnExists(db, 'feedback_event', 'session_id')) {
      throw new Error('session_id column was not created on feedback_event');
    }
    if (!this.columnExists(db, 'feedback_event', 'agent_id')) {
      throw new Error('agent_id column was not created on feedback_event');
    }
    if (!this.indexExists(db, 'idx_feedback_session')) {
      throw new Error('idx_feedback_session index was not created');
    }
    if (!this.indexExists(db, 'idx_feedback_agent')) {
      throw new Error('idx_feedback_agent index was not created');
    }
  }
}

export default FeedbackEventAttributionMigration;

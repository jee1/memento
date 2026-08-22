/**
 * Migration: 016 - memory_item process_id, session_id (Attribution)
 * Description: Add process_id and session_id to memory_item for Memori-style attribution (Issue #87)
 * Version: 16.0
 * Date: 2026-02-07
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

/**
 * Memory Item Attribution Migration (process_id, session_id)
 *
 * Adds process_id and session_id columns and indexes for entity/process/session attribution.
 * owner_id = entity; process_id = agent/program; session_id = workflow/session.
 * NULL = backward compatible (existing rows unchanged).
 */
export class MemoryItemAttributionMigration implements Migration {
  version = '16.0';
  name = 'memory-item-attribution';
  description = 'Add process_id and session_id to memory_item (Issue #87 Memori Attribution)';

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
    if (!this.tableExists(db, 'memory_item')) {
      throw new Error('memory_item table does not exist. Cannot proceed with migration.');
    }
    if (this.columnExists(db, 'memory_item', 'process_id')) {
      throw new Error('process_id column already exists. Migration 016 may have been applied.');
    }
    if (this.columnExists(db, 'memory_item', 'session_id')) {
      throw new Error('session_id column already exists. Migration 016 may have been applied.');
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      const row = db.prepare(
        `SELECT version FROM memento_schema_version WHERE version = ?`
      ).get('16.0') as { version: string } | undefined;
      if (row) {
        throw new Error('Migration 016 has already been applied. Current schema version: 16.0');
      }
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec('ALTER TABLE memory_item ADD COLUMN process_id TEXT NULL');
    db.exec('ALTER TABLE memory_item ADD COLUMN session_id TEXT NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_item_process_id ON memory_item(process_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_item_session_id ON memory_item(session_id)');
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_memory_item_process_id');
    db.exec('DROP INDEX IF EXISTS idx_memory_item_session_id');
    try {
      db.exec('ALTER TABLE memory_item DROP COLUMN process_id');
    } catch {
      // SQLite < 3.35 does not support DROP COLUMN
    }
    try {
      db.exec('ALTER TABLE memory_item DROP COLUMN session_id');
    } catch {
      // SQLite < 3.35 does not support DROP COLUMN
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('16.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.columnExists(db, 'memory_item', 'process_id')) {
      throw new Error('process_id column was not created');
    }
    if (!this.columnExists(db, 'memory_item', 'session_id')) {
      throw new Error('session_id column was not created');
    }
    if (!this.indexExists(db, 'idx_memory_item_process_id')) {
      throw new Error('idx_memory_item_process_id index was not created');
    }
    if (!this.indexExists(db, 'idx_memory_item_session_id')) {
      throw new Error('idx_memory_item_session_id index was not created');
    }
  }
}

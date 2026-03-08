/**
 * Migration: 017 - memory_item Fact metadata (Issue #88)
 * Description: Add num_times, last_mentioned_at, source_session_id, confidence for Fact/semantic normalization
 * Version: 17.0
 * Date: 2026-02-08
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

/**
 * Fact Metadata Fields Migration (Issue #88)
 *
 * Adds Fact-standard meta to memory_item for semantic/Fact normalization:
 * num_times, last_mentioned_at, source_session_id, confidence.
 * importance_score = existing importance (no new column).
 */
export class FactMetadataFieldsMigration implements Migration {
  version = '17.0';
  name = 'fact-metadata-fields';
  description = 'Add Fact metadata columns to memory_item (Issue #88: num_times, last_mentioned_at, source_session_id, confidence)';

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
    if (this.columnExists(db, 'memory_item', 'num_times')) {
      throw new Error('num_times column already exists. Migration 017 may have been applied.');
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      const row = db.prepare(
        `SELECT version FROM memento_schema_version WHERE version = ?`
      ).get('17.0') as { version: string } | undefined;
      if (row) {
        throw new Error('Migration 017 has already been applied. Current schema version: 17.0');
      }
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec('ALTER TABLE memory_item ADD COLUMN num_times INTEGER NOT NULL DEFAULT 1');
    db.exec('ALTER TABLE memory_item ADD COLUMN last_mentioned_at TIMESTAMP');
    db.exec('ALTER TABLE memory_item ADD COLUMN source_session_id TEXT');
    db.exec('ALTER TABLE memory_item ADD COLUMN confidence REAL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_item_last_mentioned_at ON memory_item(last_mentioned_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_item_num_times ON memory_item(num_times)');
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_memory_item_last_mentioned_at');
    db.exec('DROP INDEX IF EXISTS idx_memory_item_num_times');
    try {
      db.exec('ALTER TABLE memory_item DROP COLUMN num_times');
    } catch {
      // SQLite < 3.35 does not support DROP COLUMN
    }
    try {
      db.exec('ALTER TABLE memory_item DROP COLUMN last_mentioned_at');
    } catch {
      // ignore
    }
    try {
      db.exec('ALTER TABLE memory_item DROP COLUMN source_session_id');
    } catch {
      // ignore
    }
    try {
      db.exec('ALTER TABLE memory_item DROP COLUMN confidence');
    } catch {
      // ignore
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('17.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.columnExists(db, 'memory_item', 'num_times')) {
      throw new Error('num_times column was not created');
    }
    if (!this.columnExists(db, 'memory_item', 'last_mentioned_at')) {
      throw new Error('last_mentioned_at column was not created');
    }
    if (!this.columnExists(db, 'memory_item', 'source_session_id')) {
      throw new Error('source_session_id column was not created');
    }
    if (!this.columnExists(db, 'memory_item', 'confidence')) {
      throw new Error('confidence column was not created');
    }
    if (!this.indexExists(db, 'idx_memory_item_last_mentioned_at')) {
      throw new Error('idx_memory_item_last_mentioned_at index was not created');
    }
    if (!this.indexExists(db, 'idx_memory_item_num_times')) {
      throw new Error('idx_memory_item_num_times index was not created');
    }
  }
}

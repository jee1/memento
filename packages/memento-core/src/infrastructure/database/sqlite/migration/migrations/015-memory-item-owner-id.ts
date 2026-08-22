/**
 * Migration: 015 - memory_item owner_id
 * Description: Add owner_id to memory_item for multi-agent ownership (Issue #57 Phase 2 D)
 * Version: 15.0
 * Date: 2026-02-05
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

/**
 * Memory Item Owner ID Migration
 *
 * Adds owner_id column and index for multi-agent recall/remember filtering.
 * NULL = single-agent (existing behavior); value = owner/agent identifier.
 */
export class MemoryItemOwnerIdMigration implements Migration {
  version = '15.0';
  name = 'memory-item-owner-id';
  description = 'Add owner_id to memory_item for multi-agent (Issue #57 Phase 2 D)';

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
    if (this.columnExists(db, 'memory_item', 'owner_id')) {
      throw new Error('owner_id column already exists. Migration 015 may have been applied.');
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      const row = db.prepare(
        `SELECT version FROM memento_schema_version WHERE version = ?`
      ).get('15.0') as { version: string } | undefined;
      if (row) {
        throw new Error('Migration 015 has already been applied. Current schema version: 15.0');
      }
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec('ALTER TABLE memory_item ADD COLUMN owner_id TEXT NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_item_owner_id ON memory_item(owner_id)');
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_memory_item_owner_id');
    try {
      db.exec('ALTER TABLE memory_item DROP COLUMN owner_id');
    } catch {
      // SQLite < 3.35 does not support DROP COLUMN; index is still dropped
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('15.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.columnExists(db, 'memory_item', 'owner_id')) {
      throw new Error('owner_id column was not created');
    }
    if (!this.indexExists(db, 'idx_memory_item_owner_id')) {
      throw new Error('idx_memory_item_owner_id index was not created');
    }
  }
}

/**
 * Migration: 031 — memory_item soft delete columns
 * Version: 31.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class SoftDeleteFieldsMigration implements Migration {
  version = '31.0';
  name = 'soft-delete-fields';
  description = 'Add is_deleted, deleted_at to memory_item for TTL soft delete (FR-006/007)';

  private tableExists(db: Database.Database, tableName: string): boolean {
    const result = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(tableName);
    return !!result;
  }

  private columnExists(db: Database.Database, table: string, column: string): boolean {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some(r => r.name === column);
  }

  private indexExists(db: Database.Database, indexName: string): boolean {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
      .get(indexName) as { name: string } | undefined;
    return !!row;
  }

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_item')) {
      return;
    }
    if (!this.columnExists(db, 'memory_item', 'is_deleted')) {
      db.exec(`ALTER TABLE memory_item ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE NOT NULL`);
    }
    if (!this.columnExists(db, 'memory_item', 'deleted_at')) {
      db.exec(`ALTER TABLE memory_item ADD COLUMN deleted_at TEXT`);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_item_is_deleted_active
        ON memory_item(is_deleted)
        WHERE COALESCE(is_deleted, 0) = 0;
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_memory_item_is_deleted_active');
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('31.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_item')) {
      return;
    }
    if (!this.columnExists(db, 'memory_item', 'is_deleted')) {
      throw new Error('is_deleted column was not created');
    }
    if (!this.columnExists(db, 'memory_item', 'deleted_at')) {
      throw new Error('deleted_at column was not created');
    }
    if (!this.indexExists(db, 'idx_memory_item_is_deleted_active')) {
      throw new Error('idx_memory_item_is_deleted_active was not created');
    }
  }
}

export default SoftDeleteFieldsMigration;

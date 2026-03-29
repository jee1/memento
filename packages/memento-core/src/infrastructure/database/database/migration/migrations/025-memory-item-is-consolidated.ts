/**
 * Migration: 025 — memory_item.is_consolidated + partial index
 * Version: 25.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class MemoryItemIsConsolidatedMigration implements Migration {
  version = '25.0';
  name = 'memory-item-is-consolidated';
  description = 'Add is_consolidated flag for sleep consolidation (episodic)';

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
    if (!this.columnExists(db, 'memory_item', 'is_consolidated')) {
      db.exec(`ALTER TABLE memory_item ADD COLUMN is_consolidated BOOLEAN DEFAULT FALSE`);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_item_is_consolidated
        ON memory_item(type, is_consolidated)
        WHERE type = 'episodic'
    `);
  }

  async down(db: Database.Database): Promise<void> {
    // SQLite는 ALTER DROP COLUMN 미지원(구버전) — 컬럼 제거는 풀 리빌드/덤프로만 가능.
    // 스키마 버전 롤백만 수행하고 is_consolidated는 DB에 남을 수 있음.
    db.exec('DROP INDEX IF EXISTS idx_memory_item_is_consolidated');
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('25.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_item')) {
      return;
    }
    if (!this.columnExists(db, 'memory_item', 'is_consolidated')) {
      throw new Error('is_consolidated column was not created');
    }
    if (!this.indexExists(db, 'idx_memory_item_is_consolidated')) {
      throw new Error('idx_memory_item_is_consolidated was not created');
    }
  }
}

export default MemoryItemIsConsolidatedMigration;

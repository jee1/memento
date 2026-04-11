/**
 * Migration 031 테스트 — memory_item 소프트 삭제 컬럼
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SoftDeleteFieldsMigration } from './031-soft-delete-fields.js';

function createMemoryItemTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function createSchemaVersionTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      migration_name TEXT NOT NULL,
      checksum TEXT,
      applied_by TEXT DEFAULT 'system',
      description TEXT
    )
  `);
}

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
  return columns.some(c => c.name === columnName);
}

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`
  ).get(indexName) as { name: string } | undefined;
  return !!row;
}

describe('Migration 031 - soft delete fields', () => {
  let db: Database.Database;
  let migration: SoftDeleteFieldsMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createMemoryItemTable(db);
    createSchemaVersionTable(db);
    migration = new SoftDeleteFieldsMigration();
  });

  afterEach(() => {
    db.close();
  });

  it('up: is_deleted, deleted_at 컬럼 및 인덱스 추가', async () => {
    await migration.up(db);
    expect(columnExists(db, 'memory_item', 'is_deleted')).toBe(true);
    expect(columnExists(db, 'memory_item', 'deleted_at')).toBe(true);
    expect(indexExists(db, 'idx_memory_item_is_deleted_active')).toBe(true);
    await expect(migration.validateAfter(db)).resolves.toBeUndefined();
  });

  it('down: 인덱스 제거', async () => {
    await migration.up(db);
    await migration.down(db);
    expect(indexExists(db, 'idx_memory_item_is_deleted_active')).toBe(false);
  });
});

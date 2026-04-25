/**
 * Migration 030 테스트 — memory_item triple extraction 컬럼
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { TripleExtractionFieldsMigration } from './030-triple-extraction-fields.js';

function createMemoryItemTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
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

describe('Migration 030 - triple extraction fields', () => {
  let db: Database.Database;
  let migration: TripleExtractionFieldsMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createMemoryItemTable(db);
    createSchemaVersionTable(db);
    migration = new TripleExtractionFieldsMigration();
  });

  afterEach(() => {
    db.close();
  });

  it('up: triple_extracted*, triple_extraction_metadata 컬럼 및 인덱스 추가', async () => {
    await migration.up(db);
    expect(columnExists(db, 'memory_item', 'triple_extracted')).toBe(true);
    expect(columnExists(db, 'memory_item', 'triple_extracted_status')).toBe(true);
    expect(columnExists(db, 'memory_item', 'triple_extraction_metadata')).toBe(true);
    expect(indexExists(db, 'idx_memory_item_triple_extracted_episodic')).toBe(true);
    expect(indexExists(db, 'idx_memory_item_triple_extracted_status_episodic')).toBe(true);
    await expect(migration.validateAfter(db)).resolves.toBeUndefined();
  });

  it('down: partial indexes 제거 (SQLite는 ALTER DROP COLUMN 미지원)', async () => {
    await migration.up(db);
    await migration.down(db);
    expect(indexExists(db, 'idx_memory_item_triple_extracted_episodic')).toBe(false);
    expect(indexExists(db, 'idx_memory_item_triple_extracted_status_episodic')).toBe(false);
  });
});

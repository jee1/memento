/**
 * Migration 016 테스트
 * memory_item process_id, session_id 컬럼 및 인덱스 (Issue #87 Memori Attribution)
 *
 * Given/When/Then:
 * - Given: memory_item 테이블 존재 (owner_id 포함 가능)
 * - When: 016 up 실행
 * - Then: process_id, session_id 컬럼 및 idx_memory_item_process_id, idx_memory_item_session_id 존재
 * - When: down 실행
 * - Then: process_id, session_id 컬럼 및 인덱스 제거됨
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryItemAttributionMigration } from './016-memory-item-attribution.js';
import type { Migration } from '../types.js';

/** 016 적용 전 memory_item 스키마 (owner_id 포함) */
function createMemoryItemTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      owner_id TEXT NULL
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

describe('Migration 016 - memory_item process_id and session_id', () => {
  let db: Database.Database;
  let migration: Migration;

  beforeEach(() => {
    db = new Database(':memory:');
    createMemoryItemTable(db);
    createSchemaVersionTable(db);
    migration = new MemoryItemAttributionMigration();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('validateBefore', () => {
    it('Given: memory_item이 없으면, When: validateBefore 호출 시, Then: 에러 발생', async () => {
      const emptyDb = new Database(':memory:');
      createSchemaVersionTable(emptyDb);
      await expect(migration.validateBefore(emptyDb)).rejects.toThrow();
      emptyDb.close();
    });

    it('Given: 정상 스키마이면, When: validateBefore 호출 시, Then: 통과', async () => {
      await expect(migration.validateBefore(db)).resolves.toBeUndefined();
    });
  });

  describe('up', () => {
    it('Given: memory_item 존재, When: up 실행 후, Then: process_id·session_id 컬럼 및 인덱스 존재', async () => {
      await migration.up(db);
      expect(columnExists(db, 'memory_item', 'process_id')).toBe(true);
      expect(columnExists(db, 'memory_item', 'session_id')).toBe(true);
      expect(indexExists(db, 'idx_memory_item_process_id')).toBe(true);
      expect(indexExists(db, 'idx_memory_item_session_id')).toBe(true);
    });
  });

  describe('down', () => {
    it('Given: up 적용 후, When: down 실행 시, Then: process_id·session_id·인덱스 제거됨', async () => {
      await migration.up(db);
      expect(columnExists(db, 'memory_item', 'process_id')).toBe(true);
      expect(columnExists(db, 'memory_item', 'session_id')).toBe(true);
      migration.down(db);
      expect(indexExists(db, 'idx_memory_item_process_id')).toBe(false);
      expect(indexExists(db, 'idx_memory_item_session_id')).toBe(false);
      expect(columnExists(db, 'memory_item', 'process_id')).toBe(false);
      expect(columnExists(db, 'memory_item', 'session_id')).toBe(false);
    });
  });

  describe('validateAfter', () => {
    it('Given: up 실행 후, When: validateAfter 호출 시, Then: 통과', async () => {
      await migration.up(db);
      await expect(migration.validateAfter(db)).resolves.toBeUndefined();
    });
  });
});

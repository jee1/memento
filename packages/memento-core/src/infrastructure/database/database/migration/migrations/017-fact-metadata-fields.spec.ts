/**
 * Migration 017 테스트
 * memory_item Fact 메타 컬럼 (Issue #88 Fact 1급 객체화 및 메타데이터 표준화)
 *
 * Given/When/Then:
 * - Given: memory_item 테이블 존재 (process_id, session_id 포함)
 * - When: 017 up 실행
 * - Then: num_times, last_mentioned_at, source_session_id, confidence 컬럼 및 인덱스 존재
 * - When: down 실행
 * - Then: 해당 컬럼·인덱스 제거됨
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { FactMetadataFieldsMigration } from './017-fact-metadata-fields.js';
import type { Migration } from '../types.js';

/** 017 적용 전 memory_item 스키마 (016까지 반영: process_id, session_id 포함) */
function createMemoryItemTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      owner_id TEXT NULL,
      process_id TEXT NULL,
      session_id TEXT NULL
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

describe('Migration 017 - memory_item Fact metadata fields', () => {
  let db: Database.Database;
  let migration: Migration;

  beforeEach(() => {
    db = new Database(':memory:');
    createMemoryItemTable(db);
    createSchemaVersionTable(db);
    migration = new FactMetadataFieldsMigration();
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
    it('Given: memory_item 존재, When: up 실행 후, Then: num_times·last_mentioned_at·source_session_id·confidence 컬럼 및 인덱스 존재', async () => {
      await migration.up(db);
      expect(columnExists(db, 'memory_item', 'num_times')).toBe(true);
      expect(columnExists(db, 'memory_item', 'last_mentioned_at')).toBe(true);
      expect(columnExists(db, 'memory_item', 'source_session_id')).toBe(true);
      expect(columnExists(db, 'memory_item', 'confidence')).toBe(true);
      expect(indexExists(db, 'idx_memory_item_last_mentioned_at')).toBe(true);
      expect(indexExists(db, 'idx_memory_item_num_times')).toBe(true);
    });
  });

  describe('down', () => {
    it('Given: up 적용 후, When: down 실행 시, Then: Fact 메타 컬럼·인덱스 제거됨', async () => {
      await migration.up(db);
      expect(columnExists(db, 'memory_item', 'num_times')).toBe(true);
      expect(columnExists(db, 'memory_item', 'last_mentioned_at')).toBe(true);
      await migration.down(db);
      expect(indexExists(db, 'idx_memory_item_last_mentioned_at')).toBe(false);
      expect(indexExists(db, 'idx_memory_item_num_times')).toBe(false);
      expect(columnExists(db, 'memory_item', 'num_times')).toBe(false);
      expect(columnExists(db, 'memory_item', 'last_mentioned_at')).toBe(false);
      expect(columnExists(db, 'memory_item', 'source_session_id')).toBe(false);
      expect(columnExists(db, 'memory_item', 'confidence')).toBe(false);
    });
  });

  describe('validateAfter', () => {
    it('Given: up 실행 후, When: validateAfter 호출 시, Then: 통과', async () => {
      await migration.up(db);
      await expect(migration.validateAfter(db)).resolves.toBeUndefined();
    });
  });
});

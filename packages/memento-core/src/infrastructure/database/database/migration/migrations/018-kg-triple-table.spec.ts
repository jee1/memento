/**
 * Migration 018 테스트
 * kg_triple 테이블 (Issue #90 Semantic Triples·KG 전용 저장소 및 dedupe)
 *
 * Given/When/Then:
 * - Given: memory_item, memory_relation 테이블 존재(017까지 적용된 DB)
 * - When: 018 up 실행
 * - Then: kg_triple 테이블 존재, 컬럼 id, subject, predicate, object, owner_id, process_id, session_id, representative_memory_id, created_at, UNIQUE(subject, predicate, object), representative_memory_id → memory_item(id) FK
 * - When: down 실행
 * - Then: kg_triple 테이블 및 관련 인덱스 제거됨
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { KgTripleTableMigration } from './018-kg-triple-table.js';
import type { Migration } from '../types.js';

/** 018 적용 전 스키마: memory_item(017까지), memory_relation(005) */
function createBaseSchema(db: Database.Database): void {
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
      session_id TEXT NULL,
      num_times INTEGER NOT NULL DEFAULT 1,
      last_mentioned_at TIMESTAMP,
      source_session_id TEXT,
      confidence REAL,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_relation (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL DEFAULT 0.7,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      UNIQUE(source_id, target_id, relation_type)
    )
  `);
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

function tableExists(db: Database.Database, tableName: string): boolean {
  const result = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
  ).get(tableName);
  return !!result;
}

function columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
  return columns.some(c => c.name === columnName);
}

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='index' AND name=?`
  ).get(indexName) as { name: string } | undefined;
  return !!row;
}

function uniqueConstraintExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`
  ).get(tableName) as { sql: string } | undefined;
  return !!row?.sql?.includes('UNIQUE(subject, predicate, object)');
}

describe('Migration 018 - kg_triple table', () => {
  let db: Database.Database;
  let migration: Migration;

  beforeEach(() => {
    db = new Database(':memory:');
    createBaseSchema(db);
    migration = new KgTripleTableMigration();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('validateBefore', () => {
    it('Given: memory_item이 없으면, When: validateBefore 호출 시, Then: 에러 발생', async () => {
      const emptyDb = new Database(':memory:');
      emptyDb.exec(`
        CREATE TABLE IF NOT EXISTS memento_schema_version (
          version TEXT PRIMARY KEY, migration_name TEXT NOT NULL
        )
      `);
      await expect(migration.validateBefore(emptyDb)).rejects.toThrow();
      emptyDb.close();
    });

    it('Given: kg_triple이 이미 있으면, When: validateBefore 호출 시, Then: 에러 발생', async () => {
      db.exec(`
        CREATE TABLE kg_triple (id TEXT PRIMARY KEY, subject TEXT, predicate TEXT, object TEXT)
      `);
      await expect(migration.validateBefore(db)).rejects.toThrow();
    });

    it('Given: 정상 스키마(017까지)이면, When: validateBefore 호출 시, Then: 통과', async () => {
      await expect(migration.validateBefore(db)).resolves.toBeUndefined();
    });
  });

  describe('up', () => {
    it('Given: memory_item·memory_relation 존재, When: up 실행 후, Then: kg_triple 테이블 및 컬럼·인덱스·UNIQUE 존재', async () => {
      await migration.up(db);
      expect(tableExists(db, 'kg_triple')).toBe(true);
      expect(columnExists(db, 'kg_triple', 'id')).toBe(true);
      expect(columnExists(db, 'kg_triple', 'subject')).toBe(true);
      expect(columnExists(db, 'kg_triple', 'predicate')).toBe(true);
      expect(columnExists(db, 'kg_triple', 'object')).toBe(true);
      expect(columnExists(db, 'kg_triple', 'owner_id')).toBe(true);
      expect(columnExists(db, 'kg_triple', 'process_id')).toBe(true);
      expect(columnExists(db, 'kg_triple', 'session_id')).toBe(true);
      expect(columnExists(db, 'kg_triple', 'representative_memory_id')).toBe(true);
      expect(columnExists(db, 'kg_triple', 'created_at')).toBe(true);
      expect(uniqueConstraintExists(db, 'kg_triple')).toBe(true);
      expect(indexExists(db, 'idx_kg_triple_spo')).toBe(true);
      expect(indexExists(db, 'idx_kg_triple_representative')).toBe(true);
      expect(indexExists(db, 'idx_kg_triple_owner')).toBe(true);
      expect(indexExists(db, 'idx_kg_triple_process')).toBe(true);
    });
  });

  describe('down', () => {
    it('Given: up 적용 후, When: down 실행 시, Then: kg_triple 테이블 및 인덱스 제거됨', async () => {
      await migration.up(db);
      expect(tableExists(db, 'kg_triple')).toBe(true);
      await migration.down(db);
      expect(tableExists(db, 'kg_triple')).toBe(false);
      expect(indexExists(db, 'idx_kg_triple_spo')).toBe(false);
      expect(indexExists(db, 'idx_kg_triple_representative')).toBe(false);
      expect(indexExists(db, 'idx_kg_triple_owner')).toBe(false);
      expect(indexExists(db, 'idx_kg_triple_process')).toBe(false);
    });
  });

  describe('validateAfter', () => {
    it('Given: up 실행 후, When: validateAfter 호출 시, Then: 통과', async () => {
      await migration.up(db);
      await expect(migration.validateAfter(db)).resolves.toBeUndefined();
    });
  });
});

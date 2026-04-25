/**
 * Migration 014 테스트
 * Procedural version 인덱스 (Issue #57 Phase 2 B)
 *
 * Given/When/Then:
 * - Given: memory_item 테이블 존재(version, version_series_id 있음)
 * - When: 014 up 실행
 * - Then: idx_memory_item_procedural_version_series, idx_memory_item_procedural_version 인덱스 존재
 * - When: down 실행
 * - Then: 해당 인덱스 제거됨
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ProceduralVersionIndexesMigration } from './014-procedural-version-indexes.js';
import type { Migration } from '../types.js';

/** 014 적용 전 memory_item 스키마 (013 적용 후: version, version_series_id 포함) */
function createMemoryItemWithVersionColumns(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      version INTEGER NULL,
      version_series_id TEXT NULL,
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

function getIndexNames(db: Database.Database, tableName: string): string[] {
  const rows = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`
  ).all(tableName) as Array<{ name: string }>;
  return rows.map(r => r.name);
}

describe('Migration 014 - Procedural Version Indexes', () => {
  let db: Database.Database;
  let migration: Migration;

  beforeEach(() => {
    db = new Database(':memory:');
    createMemoryItemWithVersionColumns(db);
    createSchemaVersionTable(db);
    migration = new ProceduralVersionIndexesMigration();
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

    it('Given: version_series_id 컬럼이 없으면, When: validateBefore 호출 시, Then: 에러 발생', async () => {
      db.exec('CREATE TABLE IF NOT EXISTS memory_item_alt (id TEXT, type TEXT, content TEXT, version INTEGER)');
      const altDb = new Database(':memory:');
      altDb.exec(`
        CREATE TABLE memory_item (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          version INTEGER NULL,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
        )
      `);
      createSchemaVersionTable(altDb);
      await expect(migration.validateBefore(altDb)).rejects.toThrow();
      altDb.close();
    });

    it('Given: 정상 스키마(version, version_series_id 있음)이면, When: validateBefore 호출 시, Then: 통과', async () => {
      await expect(migration.validateBefore(db)).resolves.toBeUndefined();
    });
  });

  describe('up', () => {
    it('Given: memory_item에 version·version_series_id 있음, When: up 실행 후, Then: idx_memory_item_procedural_version_series·idx_memory_item_procedural_version 인덱스 존재', async () => {
      await migration.up(db);
      const indexNames = getIndexNames(db, 'memory_item');
      expect(indexNames).toContain('idx_memory_item_procedural_version_series');
      expect(indexNames).toContain('idx_memory_item_procedural_version');
    });
  });

  describe('down', () => {
    it('Given: up 적용 후, When: down 실행 시, Then: 해당 인덱스 제거됨', async () => {
      await migration.up(db);
      expect(getIndexNames(db, 'memory_item')).toContain('idx_memory_item_procedural_version_series');
      migration.down(db);
      const indexNames = getIndexNames(db, 'memory_item');
      expect(indexNames).not.toContain('idx_memory_item_procedural_version_series');
      expect(indexNames).not.toContain('idx_memory_item_procedural_version');
    });
  });

  describe('validateAfter', () => {
    it('Given: up 실행 후, When: validateAfter 호출 시, Then: 통과', async () => {
      await migration.up(db);
      await expect(migration.validateAfter(db)).resolves.toBeUndefined();
    });
  });
});

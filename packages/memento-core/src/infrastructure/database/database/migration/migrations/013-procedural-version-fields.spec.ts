/**
 * Migration 013 테스트
 * Procedural Version Fields (version, version_series_id) backfill
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ProceduralVersionFieldsMigration } from './013-procedural-version-fields.js';
import type { Migration } from '../types.js';

/** 013 마이그레이션 적용 전 memory_item 스키마 (007까지 적용된 상태) */
function createMemoryItemTableWithoutVersion(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      view_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0,
      origin_source TEXT DEFAULT '{}',
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT,
      workflow_name TEXT,
      skill_name TEXT,
      trigger_conditions TEXT
    )
  `);
}

function createMemoryLinkTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT CHECK (relation_type IN ('cause_of', 'derived_from', 'duplicates', 'contradicts', 'version_of')) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_id) REFERENCES memory_item(id),
      FOREIGN KEY (target_id) REFERENCES memory_item(id),
      UNIQUE(source_id, target_id, relation_type)
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

describe('Migration 013 - Procedural Version Fields', () => {
  let db: Database.Database;
  let migration: Migration;

  beforeEach(() => {
    db = new Database(':memory:');
    createMemoryItemTableWithoutVersion(db);
    createMemoryLinkTable(db);
    createSchemaVersionTable(db);
    migration = new ProceduralVersionFieldsMigration();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('validateBefore', () => {
    it('Given: memory_item이 없으면, When: validateBefore 호출 시, Then: 에러 발생', async () => {
      const emptyDb = new Database(':memory:');
      createMemoryLinkTable(emptyDb);
      createSchemaVersionTable(emptyDb);
      await expect(migration.validateBefore(emptyDb)).rejects.toThrow('memory_item table does not exist');
      emptyDb.close();
    });

    it('Given: version 컬럼이 이미 있으면, When: validateBefore 호출 시, Then: 에러 발생', async () => {
      db.exec('ALTER TABLE memory_item ADD COLUMN version INTEGER NULL');
      await expect(migration.validateBefore(db)).rejects.toThrow('version column already exists');
    });

    it('Given: 13.0이 이미 적용된 상태면, When: validateBefore 호출 시, Then: 에러 발생', async () => {
      db.prepare(
        `INSERT INTO memento_schema_version (version, migration_name) VALUES (?, ?)`
      ).run('13.0', 'procedural-version-fields');
      await expect(migration.validateBefore(db)).rejects.toThrow('Migration 013 has already been applied');
    });

    it('Given: 정상 스키마이면, When: validateBefore 호출 시, Then: 통과', async () => {
      await expect(migration.validateBefore(db)).resolves.toBeUndefined();
    });
  });

  describe('up and backfill', () => {
    it('Given: 빈 DB, When: up 실행 후, Then: memory_item에 version, version_series_id 컬럼 존재', async () => {
      await migration.up(db);
      const info = db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>;
      const names = info.map(c => c.name);
      expect(names).toContain('version');
      expect(names).toContain('version_series_id');
    });

    it('Given: standalone procedural 행 1개, When: up 실행 후, Then: version=1, version_series_id=id', async () => {
      db.prepare(`
        INSERT INTO memory_item (id, type, content) VALUES ('proc-standalone', 'procedural', 'Single step')
      `).run();
      await migration.up(db);
      const row = db.prepare(
        `SELECT version, version_series_id FROM memory_item WHERE id = 'proc-standalone'`
      ).get() as { version: number; version_series_id: string };
      expect(row.version).toBe(1);
      expect(row.version_series_id).toBe('proc-standalone');
    });

    it('Given: version_of 체인 proc-v1 <- proc-v2 <- proc-v3, When: up 실행 후, Then: version 1,2,3 및 동일 version_series_id', async () => {
      db.prepare(`
        INSERT INTO memory_item (id, type, content, workflow_name)
        VALUES
          ('proc-v1', 'procedural', 'V1', 'wf'),
          ('proc-v2', 'procedural', 'V2', 'wf'),
          ('proc-v3', 'procedural', 'V3', 'wf')
      `).run();
      db.prepare(`
        INSERT INTO memory_link (source_id, target_id, relation_type)
        VALUES
          ('proc-v2', 'proc-v1', 'version_of'),
          ('proc-v3', 'proc-v2', 'version_of')
      `).run();
      await migration.up(db);

      const v1 = db.prepare(`SELECT version, version_series_id FROM memory_item WHERE id = 'proc-v1'`).get() as { version: number; version_series_id: string };
      const v2 = db.prepare(`SELECT version, version_series_id FROM memory_item WHERE id = 'proc-v2'`).get() as { version: number; version_series_id: string };
      const v3 = db.prepare(`SELECT version, version_series_id FROM memory_item WHERE id = 'proc-v3'`).get() as { version: number; version_series_id: string };

      expect(v1.version).toBe(1);
      expect(v1.version_series_id).toBe('proc-v1');
      expect(v2.version).toBe(2);
      expect(v2.version_series_id).toBe('proc-v1');
      expect(v3.version).toBe(3);
      expect(v3.version_series_id).toBe('proc-v1');
    });
  });

  describe('validateAfter', () => {
    it('Given: up 실행 후, When: validateAfter 호출 시, Then: 통과', async () => {
      await migration.up(db);
      await expect(migration.validateAfter(db)).resolves.toBeUndefined();
    });
  });

  describe('down', () => {
    it('Given: up 적용 후, When: down 실행 시, Then: version/version_series_id 제거 또는 스키마 버전만 삭제', () => {
      return migration.up(db).then(() => {
        migration.down(db);
        const info = db.prepare('PRAGMA table_info(memory_item)').all() as Array<{ name: string }>;
        const names = info.map(c => c.name);
        // SQLite 3.35+면 DROP COLUMN 되어 없을 수 있음; 아니면 여전히 있을 수 있음
        const versionRecord = db.prepare(
          `SELECT version FROM memento_schema_version WHERE version = '13.0'`
        ).get();
        expect(versionRecord).toBeUndefined();
      });
    });
  });
});

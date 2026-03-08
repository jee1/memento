/**
 * Migration 010 테스트
 * Add Core Memory Version Column Migration 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { AddCoreMemoryVersionMigration } from './010-add-core-memory-version.js';
import type { Migration } from '../types.js';

/**
 * 기본 스키마 생성 (core_memory 테이블)
 */
function createBaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS core_memory (
      core_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      always_load BOOLEAN NOT NULL DEFAULT 0,
      origin_source TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_core_memory_agent_id ON core_memory(agent_id);
    CREATE INDEX IF NOT EXISTS idx_core_memory_key ON core_memory(key);
    CREATE INDEX IF NOT EXISTS idx_core_memory_created_at ON core_memory(created_at);
    CREATE INDEX IF NOT EXISTS idx_core_memory_always_load ON core_memory(always_load);

    CREATE TRIGGER IF NOT EXISTS core_memory_update_timestamp 
    AFTER UPDATE ON core_memory
    BEGIN
      UPDATE core_memory 
      SET updated_at = CURRENT_TIMESTAMP 
      WHERE core_id = NEW.core_id;
    END;
  `);
}

describe('Migration 010 - Add Core Memory Version Column', () => {
  let db: Database.Database;
  let migration: Migration;

  beforeEach(() => {
    db = new Database(':memory:');
    createBaseSchema(db);
    migration = new AddCoreMemoryVersionMigration();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('validateBefore', () => {
    it('core_memory 테이블이 없으면 에러를 발생시켜야 함', async () => {
      // Given: core_memory 테이블이 없는 데이터베이스
      const emptyDb = new Database(':memory:');

      // When/Then: 검증 실패
      await expect(migration.validateBefore(emptyDb)).rejects.toThrow('core_memory table does not exist');

      emptyDb.close();
    });

    it('version 컬럼이 이미 있으면 에러를 발생시켜야 함', async () => {
      // Given: version 컬럼이 이미 있는 테이블
      db.exec('ALTER TABLE core_memory ADD COLUMN version INTEGER NOT NULL DEFAULT 0');

      // When/Then: 검증 실패
      await expect(migration.validateBefore(db)).rejects.toThrow('version column already exists');
    });

    it('정상적인 경우 검증을 통과해야 함', async () => {
      // Given: 기본 스키마만 있는 데이터베이스
      // When/Then: 검증 통과
      await expect(migration.validateBefore(db)).resolves.not.toThrow();
    });
  });

  describe('up', () => {
    it('version 컬럼을 추가해야 함', async () => {
      // Given: 기본 스키마
      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: version 컬럼이 추가되어야 함
      const columns = db.prepare(`PRAGMA table_info(core_memory)`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      
      const versionColumn = columns.find(col => col.name === 'version');
      expect(versionColumn).toBeDefined();
      expect(versionColumn?.type.toUpperCase()).toContain('INTEGER');
      expect(versionColumn?.notnull).toBe(1);
    });

    it('기존 행에 version = 1을 설정해야 함', async () => {
      // Given: 기존 데이터 삽입
      db.exec(`
        INSERT INTO core_memory (core_id, agent_id, key, value, always_load)
        VALUES ('core1', 'agent1', 'key1', 'value1', 1),
               ('core2', 'agent1', 'key2', 'value2', 0)
      `);

      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 모든 행의 version이 1이어야 함
      const records = db.prepare('SELECT version FROM core_memory').all() as Array<{ version: number }>;
      expect(records).toHaveLength(2);
      expect(records.every(r => r.version === 1)).toBe(true);
    });

    it('version 인덱스를 생성해야 함', async () => {
      // Given: 기본 스키마
      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: idx_core_memory_version 인덱스가 생성되어야 함
      const indexes = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name='idx_core_memory_version'
      `).all() as Array<{ name: string }>;
      
      expect(indexes).toHaveLength(1);
      expect(indexes[0].name).toBe('idx_core_memory_version');
    });
  });

  describe('validateAfter', () => {
    it('version 컬럼이 생성되었는지 검증해야 함', async () => {
      // Given: 마이그레이션 실행
      await migration.up(db);

      // When/Then: 검증 통과
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });

    it('version=0인 행이 있으면 검증 실패해야 함', async () => {
      // Given: 마이그레이션 실행 후 version=0인 행 추가
      await migration.up(db);
      db.exec(`
        INSERT INTO core_memory (core_id, agent_id, key, value, version)
        VALUES ('core_bad', 'agent1', 'bad_key', 'bad_value', 0)
      `);

      // When/Then: 검증 실패 (에러 메시지에 "version = 0" 포함)
      await expect(migration.validateAfter(db)).rejects.toThrow(/version.*0/);
    });

    it('인덱스가 생성되었는지 검증해야 함', async () => {
      // Given: 마이그레이션 실행
      await migration.up(db);

      // When/Then: 검증 통과 (인덱스 검증 포함)
      await expect(migration.validateAfter(db)).resolves.not.toThrow();
    });
  });

  describe('down', () => {
    it('인덱스를 제거해야 함', async () => {
      // Given: 마이그레이션 실행
      await migration.up(db);

      // When: 롤백
      await migration.down(db);

      // Then: 인덱스가 제거되어야 함
      const indexes = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name='idx_core_memory_version'
      `).all() as Array<{ name: string }>;
      
      expect(indexes).toHaveLength(0);
    });
  });

  describe('통합 테스트', () => {
    it('마이그레이션 실행 후 모든 검증을 통과해야 함', async () => {
      // Given: 기본 스키마 및 테스트 데이터
      db.exec(`
        INSERT INTO core_memory (core_id, agent_id, key, value, always_load)
        VALUES ('core_test1', 'agent1', 'key1', 'value1', 1),
               ('core_test2', 'agent1', 'key2', 'value2', 0)
      `);

      // When: 마이그레이션 실행
      await migration.up(db);

      // Then: 모든 검증 통과
      await expect(migration.validateAfter(db)).resolves.not.toThrow();

      // Then: version 컬럼 확인
      const records = db.prepare('SELECT version FROM core_memory').all() as Array<{ version: number }>;
      expect(records.every(r => r.version === 1)).toBe(true);

      // Then: version=0인 행이 없어야 함
      const zeroVersionCount = db.prepare('SELECT COUNT(*) as count FROM core_memory WHERE version = 0').get() as { count: number };
      expect(zeroVersionCount.count).toBe(0);
    });
  });
});


/**
 * Core Memory Repository Factory 테스트
 * TDD: RED-GREEN-REFACTOR
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createCoreMemoryRepository } from '../core-memory-repository.factory.js';
import { CoreMemoryRepositorySqliteImpl } from '../../repositories/core-memory-repository-sqlite.impl.js';
import type { CoreMemoryRepository } from '../../../../domains/memory/repositories/core-memory-repository.interface.js';

describe('createCoreMemoryRepository', () => {
  let db: Database.Database;
  let originalEnv: string | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
    originalEnv = process.env.DB_TYPE;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DB_TYPE = originalEnv;
    } else {
      delete process.env.DB_TYPE;
    }
    db.close();
  });

  describe('DB_TYPE=sqlite', () => {
    it('should return CoreMemoryRepositorySqliteImpl instance', () => {
      // Given: 환경 변수 DB_TYPE='sqlite'가 설정되었을 때
      process.env.DB_TYPE = 'sqlite';
      
      // When: createCoreMemoryRepository(db)를 호출하면
      const repository = createCoreMemoryRepository(db);
      
      // Then: CoreMemoryRepositorySqliteImpl 인스턴스를 반환하는지 테스트
      expect(repository).toBeInstanceOf(CoreMemoryRepositorySqliteImpl);
    });
  });

  describe('DB_TYPE not set', () => {
    it('should return CoreMemoryRepositorySqliteImpl instance as default', () => {
      // Given: 환경 변수 DB_TYPE이 설정되지 않았을 때
      delete process.env.DB_TYPE;
      
      // When: createCoreMemoryRepository(db)를 호출하면
      const repository = createCoreMemoryRepository(db);
      
      // Then: 기본값으로 CoreMemoryRepositorySqliteImpl 인스턴스를 반환하는지 테스트
      expect(repository).toBeInstanceOf(CoreMemoryRepositorySqliteImpl);
    });
  });

  describe('DB_TYPE=postgres', () => {
    it('should throw error with message about PostgreSQL not available', () => {
      // Given: 환경 변수 DB_TYPE='postgres'가 설정되었을 때
      process.env.DB_TYPE = 'postgres';
      
      // When: createCoreMemoryRepository(db)를 호출하면
      // Then: 에러가 발생하고 "PostgreSQL implementation is not yet available" 메시지를 포함하는지 테스트
      expect(() => {
        createCoreMemoryRepository(db);
      }).toThrow('PostgreSQL implementation is not yet available');
    });
  });

  describe('DB_TYPE=invalid', () => {
    it('should throw error with message about unsupported database type', () => {
      // Given: 환경 변수 DB_TYPE='invalid'가 설정되었을 때
      process.env.DB_TYPE = 'invalid';
      
      // When: createCoreMemoryRepository(db)를 호출하면
      // Then: 에러가 발생하고 "Unsupported database type" 메시지를 포함하는지 테스트
      expect(() => {
        createCoreMemoryRepository(db);
      }).toThrow('Unsupported database type: invalid. Supported types: \'sqlite\', \'postgres\'');
    });
  });

  describe('Repository functionality', () => {
    it('should create working repository instance', async () => {
      // Given: Database.Database 객체가 주어졌을 때
      // Core Memory 테이블 생성
      db.exec(`
        CREATE TABLE IF NOT EXISTS core_memory (
          core_id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          always_load INTEGER NOT NULL DEFAULT 0,
          origin_source TEXT,
          version INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(agent_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_core_memory_version ON core_memory(version);
        UPDATE core_memory SET version = 1 WHERE version = 0;
      `);
      
      // When: Factory를 통해 Repository를 생성하면
      const repository = createCoreMemoryRepository(db);
      
      // Then: 생성된 Repository가 정상적으로 동작하는지 테스트
      const result = await repository.create({
        core_id: 'test-id',
        agent_id: 'test-agent',
        key: 'test-key',
        value: 'test-value'
      });
      
      expect(result).toBeDefined();
      expect(result.core_id).toBe('test-id');
      expect(result.value).toBe('test-value');
    });
  });
});


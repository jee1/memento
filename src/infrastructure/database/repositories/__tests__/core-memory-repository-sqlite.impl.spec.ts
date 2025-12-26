/**
 * CoreMemoryRepository SQLite 구현체 테스트
 * TDD: RED-GREEN-REFACTOR
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { CoreMemoryRepositorySqliteImpl } from '../core-memory-repository-sqlite.impl.js';
import { SqliteCoreMemoryAdapter } from '../../adapters/sqlite-core-memory-adapter.js';
import type { CoreMemoryRepository } from '../../../../domains/memory/repositories/core-memory-repository.interface.js';
import type { CoreMemoryDatabaseConnection } from '../../../../domains/memory/repositories/core-memory-database.interface.js';

describe('CoreMemoryRepositorySqliteImpl', () => {
  let db: Database.Database;
  let adapter: CoreMemoryDatabaseConnection;
  let repository: CoreMemoryRepository;

  beforeEach(async () => {
    // Given: CoreMemoryDatabaseConnection Mock이 주어졌을 때
    db = new Database(':memory:');
    
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

    adapter = new SqliteCoreMemoryAdapter(db);
    repository = new CoreMemoryRepositorySqliteImpl(adapter);
  });

  describe('인터페이스 구현', () => {
    it('should implement CoreMemoryRepository interface', () => {
      // When: CoreMemoryRepositorySqliteImpl을 생성하고
      // Then: CoreMemoryRepository 인터페이스를 구현하는지 테스트
      expect(repository).toBeDefined();
      expect(typeof repository.create).toBe('function');
      expect(typeof repository.findById).toBe('function');
      expect(typeof repository.findByKey).toBe('function');
      expect(typeof repository.findByAgentId).toBe('function');
      expect(typeof repository.findAlwaysLoad).toBe('function');
      expect(typeof repository.update).toBe('function');
      expect(typeof repository.updateByKey).toBe('function');
      expect(typeof repository.delete).toBe('function');
      expect(typeof repository.deleteByKey).toBe('function');
      expect(typeof repository.deleteByAgentId).toBe('function');
      expect(typeof repository.findAll).toBe('function');
      expect(typeof repository.count).toBe('function');
    });
  });

  describe('create', () => {
    it('should return Promise<CoreMemoryRecord>', async () => {
      // Given: Repository가 준비되었을 때
      // When: create(input)을 호출하면
      const result = await repository.create({
        core_id: 'test-id',
        agent_id: 'test-agent',
        key: 'test-key',
        value: 'test-value',
        always_load: true
      });
      
      // Then: Promise<CoreMemoryRecord>를 반환하는지 테스트
      expect(result).toBeDefined();
      expect(result.core_id).toBe('test-id');
      expect(result.agent_id).toBe('test-agent');
      expect(result.key).toBe('test-key');
      expect(result.value).toBe('test-value');
      expect(result.always_load).toBe(true);
    });
  });

  describe('findById', () => {
    it('should return Promise<CoreMemoryRecord | null>', async () => {
      // Given: Repository가 준비되었을 때
      await repository.create({
        core_id: 'test-id',
        agent_id: 'test-agent',
        key: 'test-key',
        value: 'test-value'
      });
      
      // When: findById(core_id)를 호출하면
      const result = await repository.findById('test-id');
      
      // Then: Promise<CoreMemoryRecord | null>을 반환하는지 테스트
      expect(result).toBeDefined();
      expect(result?.core_id).toBe('test-id');
    });

    it('should return null when not found', async () => {
      // Given: Repository가 준비되었을 때
      // When: 존재하지 않는 ID로 조회하면
      const result = await repository.findById('non-existent');
      
      // Then: null을 반환하는지 테스트
      expect(result).toBeNull();
    });
  });

  describe('findByKey', () => {
    it('should return Promise<CoreMemoryRecord | null>', async () => {
      // Given: Repository가 준비되었을 때
      await repository.create({
        core_id: 'test-id',
        agent_id: 'test-agent',
        key: 'test-key',
        value: 'test-value'
      });
      
      // When: findByKey(agent_id, key)를 호출하면
      const result = await repository.findByKey('test-agent', 'test-key');
      
      // Then: Promise<CoreMemoryRecord | null>을 반환하는지 테스트
      expect(result).toBeDefined();
      expect(result?.key).toBe('test-key');
    });
  });

  describe('findByAgentId', () => {
    it('should return Promise<CoreMemoryRecord[]>', async () => {
      // Given: Repository가 준비되었을 때
      await repository.create({
        core_id: 'test-id-1',
        agent_id: 'test-agent',
        key: 'test-key-1',
        value: 'test-value-1'
      });
      await repository.create({
        core_id: 'test-id-2',
        agent_id: 'test-agent',
        key: 'test-key-2',
        value: 'test-value-2'
      });
      
      // When: findByAgentId(agent_id)를 호출하면
      const result = await repository.findByAgentId('test-agent');
      
      // Then: Promise<CoreMemoryRecord[]>를 반환하는지 테스트
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });
  });

  describe('findAlwaysLoad', () => {
    it('should return Promise<CoreMemoryRecord[]>', async () => {
      // Given: Repository가 준비되었을 때
      await repository.create({
        core_id: 'test-id-1',
        agent_id: 'test-agent',
        key: 'test-key-1',
        value: 'test-value-1',
        always_load: true
      });
      await repository.create({
        core_id: 'test-id-2',
        agent_id: 'test-agent',
        key: 'test-key-2',
        value: 'test-value-2',
        always_load: false
      });
      
      // When: findAlwaysLoad(agent_id?)를 호출하면
      const result = await repository.findAlwaysLoad('test-agent');
      
      // Then: Promise<CoreMemoryRecord[]>를 반환하는지 테스트
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].always_load).toBe(true);
    });
  });

  describe('update', () => {
    it('should return Promise<CoreMemoryRecord | null>', async () => {
      // Given: Repository가 준비되었을 때
      await repository.create({
        core_id: 'test-id',
        agent_id: 'test-agent',
        key: 'test-key',
        value: 'test-value'
      });
      
      // When: update(core_id, input)을 호출하면
      const result = await repository.update('test-id', {
        value: 'updated-value'
      });
      
      // Then: Promise<CoreMemoryRecord | null>을 반환하는지 테스트
      expect(result).toBeDefined();
      expect(result?.value).toBe('updated-value');
    });
  });

  describe('updateByKey', () => {
    it('should return Promise<CoreMemoryRecord | null>', async () => {
      // Given: Repository가 준비되었을 때
      await repository.create({
        core_id: 'test-id',
        agent_id: 'test-agent',
        key: 'test-key',
        value: 'test-value'
      });
      
      // When: updateByKey(agent_id, key, input)을 호출하면
      const result = await repository.updateByKey('test-agent', 'test-key', {
        value: 'updated-value'
      });
      
      // Then: Promise<CoreMemoryRecord | null>을 반환하는지 테스트
      expect(result).toBeDefined();
      expect(result?.value).toBe('updated-value');
    });
  });

  describe('delete', () => {
    it('should return Promise<boolean>', async () => {
      // Given: Repository가 준비되었을 때
      await repository.create({
        core_id: 'test-id',
        agent_id: 'test-agent',
        key: 'test-key',
        value: 'test-value'
      });
      
      // When: delete(core_id)를 호출하면
      const result = await repository.delete('test-id');
      
      // Then: Promise<boolean>을 반환하는지 테스트
      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });
  });

  describe('deleteByKey', () => {
    it('should return Promise<boolean>', async () => {
      // Given: Repository가 준비되었을 때
      await repository.create({
        core_id: 'test-id',
        agent_id: 'test-agent',
        key: 'test-key',
        value: 'test-value'
      });
      
      // When: deleteByKey(agent_id, key)를 호출하면
      const result = await repository.deleteByKey('test-agent', 'test-key');
      
      // Then: Promise<boolean>을 반환하는지 테스트
      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });
  });

  describe('deleteByAgentId', () => {
    it('should return Promise<number>', async () => {
      // Given: Repository가 준비되었을 때
      await repository.create({
        core_id: 'test-id-1',
        agent_id: 'test-agent',
        key: 'test-key-1',
        value: 'test-value-1'
      });
      await repository.create({
        core_id: 'test-id-2',
        agent_id: 'test-agent',
        key: 'test-key-2',
        value: 'test-value-2'
      });
      
      // When: deleteByAgentId(agent_id)를 호출하면
      const result = await repository.deleteByAgentId('test-agent');
      
      // Then: Promise<number>를 반환하는지 테스트
      expect(typeof result).toBe('number');
      expect(result).toBe(2);
    });
  });

  describe('findAll', () => {
    it('should return Promise<CoreMemoryRecord[]>', async () => {
      // Given: Repository가 준비되었을 때
      await repository.create({
        core_id: 'test-id-1',
        agent_id: 'test-agent-1',
        key: 'test-key-1',
        value: 'test-value-1'
      });
      await repository.create({
        core_id: 'test-id-2',
        agent_id: 'test-agent-2',
        key: 'test-key-2',
        value: 'test-value-2'
      });
      
      // When: findAll()을 호출하면
      const result = await repository.findAll();
      
      // Then: Promise<CoreMemoryRecord[]>를 반환하는지 테스트
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });
  });

  describe('count', () => {
    it('should return Promise<number>', async () => {
      // Given: Repository가 준비되었을 때
      await repository.create({
        core_id: 'test-id-1',
        agent_id: 'test-agent',
        key: 'test-key-1',
        value: 'test-value-1'
      });
      await repository.create({
        core_id: 'test-id-2',
        agent_id: 'test-agent',
        key: 'test-key-2',
        value: 'test-value-2'
      });
      
      // When: count(agent_id?)를 호출하면
      const result = await repository.count('test-agent');
      
      // Then: Promise<number>를 반환하는지 테스트
      expect(typeof result).toBe('number');
      expect(result).toBe(2);
    });
  });

  describe('always_load 불리언 변환', () => {
    it('should convert always_load from number 1 to boolean true', async () => {
      // Given: always_load가 숫자 1로 저장되었을 때
      await repository.create({
        core_id: 'test-id',
        agent_id: 'test-agent',
        key: 'test-key',
        value: 'test-value',
        always_load: true
      });
      
      // When: 조회하면
      const result = await repository.findById('test-id');
      
      // Then: 불리언 true로 변환되어 반환되는지 테스트
      expect(result).toBeDefined();
      expect(result?.always_load).toBe(true);
      expect(typeof result?.always_load).toBe('boolean');
    });
  });
});


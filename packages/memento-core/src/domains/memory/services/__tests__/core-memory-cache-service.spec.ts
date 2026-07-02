/**
 * CoreMemoryCacheService 테스트
 * Core Memory 캐시 서비스 테스트 (always_load=true 항목 캐싱)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CoreMemoryCacheService,
  getCoreMemoryCache,
  setCoreMemoryCache,
  resetCoreMemoryCache,
  type CacheEntry,
  type CacheInvalidationListener
} from '../core-memory-cache-service.js';
import type { CoreMemoryRecord } from '../repositories/core-memory-repository.interface.js';
import { vi } from 'vitest';

describe('CoreMemoryCacheService', () => {
  let cache: CoreMemoryCacheService;

  beforeEach(() => {
    cache = new CoreMemoryCacheService();
    resetCoreMemoryCache();
  });

  afterEach(() => {
    cache.clear();
    resetCoreMemoryCache();
  });

  describe('set / get', () => {
    it('항목을 저장하고 조회해야 함', () => {
      // Given: Core Memory 레코드 생성
      const record: CoreMemoryRecord = {
        core_id: 'core1',
        agent_id: 'agent1',
        key: 'test_key',
        value: 'test_value',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // When: 항목 저장 및 조회
      cache.set('core1', record);
      const retrieved = cache.get('core1');

      // Then: 저장된 항목이 반환되어야 함
      expect(retrieved).toEqual(record);
    });

    it('존재하지 않는 키는 undefined를 반환해야 함', () => {
      // When: 존재하지 않는 키 조회
      const retrieved = cache.get('nonexistent');

      // Then: undefined 반환
      expect(retrieved).toBeUndefined();
    });

    it('동일한 키로 덮어쓸 수 있어야 함', () => {
      // Given: 항목 저장
      const record1: CoreMemoryRecord = {
        core_id: 'core1',
        agent_id: 'agent1',
        key: 'test_key',
        value: 'value1',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      cache.set('core1', record1);

      // When: 동일한 키로 다른 값 저장
      const record2: CoreMemoryRecord = {
        ...record1,
        value: 'value2'
      };
      cache.set('core1', record2);

      // Then: 새로운 값이 저장되어야 함
      const retrieved = cache.get('core1');
      expect(retrieved?.value).toBe('value2');
    });
  });

  describe('delete', () => {
    it('항목을 삭제해야 함', () => {
      // Given: 항목 저장
      const record: CoreMemoryRecord = {
        core_id: 'core1',
        agent_id: 'agent1',
        key: 'test_key',
        value: 'test_value',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      cache.set('core1', record);

      // When: 항목 삭제
      const deleted = cache.delete('core1');

      // Then: 삭제 성공 및 조회 불가
      expect(deleted).toBe(true);
      expect(cache.get('core1')).toBeUndefined();
    });

    it('존재하지 않는 키 삭제는 false를 반환해야 함', () => {
      // When: 존재하지 않는 키 삭제
      const deleted = cache.delete('nonexistent');

      // Then: false 반환
      expect(deleted).toBe(false);
    });
  });

  describe('clear', () => {
    it('모든 항목을 삭제해야 함', () => {
      // Given: 여러 항목 저장
      const record1: CoreMemoryRecord = {
        core_id: 'core1',
        agent_id: 'agent1',
        key: 'key1',
        value: 'value1',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const record2: CoreMemoryRecord = {
        core_id: 'core2',
        agent_id: 'agent1',
        key: 'key2',
        value: 'value2',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      cache.set('core1', record1);
      cache.set('core2', record2);

      // When: 캐시 비우기
      cache.clear();

      // Then: 모든 항목이 삭제되어야 함
      expect(cache.get('core1')).toBeUndefined();
      expect(cache.get('core2')).toBeUndefined();
      expect(cache.size()).toBe(0);
    });
  });

  describe('has', () => {
    it('존재하는 키는 true를 반환해야 함', () => {
      // Given: 항목 저장
      const record: CoreMemoryRecord = {
        core_id: 'core1',
        agent_id: 'agent1',
        key: 'test_key',
        value: 'test_value',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      cache.set('core1', record);

      // When: 키 존재 확인
      const exists = cache.has('core1');

      // Then: true 반환
      expect(exists).toBe(true);
    });

    it('존재하지 않는 키는 false를 반환해야 함', () => {
      // When: 존재하지 않는 키 확인
      const exists = cache.has('nonexistent');

      // Then: false 반환
      expect(exists).toBe(false);
    });
  });

  describe('getAll', () => {
    it('모든 항목을 반환해야 함', () => {
      // Given: 여러 항목 저장
      const record1: CoreMemoryRecord = {
        core_id: 'core1',
        agent_id: 'agent1',
        key: 'key1',
        value: 'value1',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const record2: CoreMemoryRecord = {
        core_id: 'core2',
        agent_id: 'agent1',
        key: 'key2',
        value: 'value2',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      cache.set('core1', record1);
      cache.set('core2', record2);

      // When: 모든 항목 조회
      const all = cache.getAll();

      // Then: 모든 항목이 반환되어야 함
      expect(all.length).toBe(2);
      expect(all).toContainEqual(record1);
      expect(all).toContainEqual(record2);
    });

    it('항목이 없으면 빈 배열을 반환해야 함', () => {
      // When: 모든 항목 조회
      const all = cache.getAll();

      // Then: 빈 배열 반환
      expect(all).toEqual([]);
    });
  });

  describe('size', () => {
    it('캐시 크기를 반환해야 함', () => {
      // Given: 여러 항목 저장
      const record1: CoreMemoryRecord = {
        core_id: 'core1',
        agent_id: 'agent1',
        key: 'key1',
        value: 'value1',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const record2: CoreMemoryRecord = {
        core_id: 'core2',
        agent_id: 'agent1',
        key: 'key2',
        value: 'value2',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      cache.set('core1', record1);
      cache.set('core2', record2);

      // When: 크기 조회
      const size = cache.size();

      // Then: 올바른 크기 반환
      expect(size).toBe(2);
    });
  });

  describe('keys', () => {
    it('모든 키를 반환해야 함', () => {
      // Given: 여러 항목 저장
      cache.set('core1', {
        core_id: 'core1',
        agent_id: 'agent1',
        key: 'key1',
        value: 'value1',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      cache.set('core2', {
        core_id: 'core2',
        agent_id: 'agent1',
        key: 'key2',
        value: 'value2',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      // When: 키 목록 조회
      const keys = cache.keys();

      // Then: 모든 키가 반환되어야 함
      expect(keys).toContain('core1');
      expect(keys).toContain('core2');
      expect(keys.length).toBe(2);
    });
  });

  describe('getByAgentId', () => {
    it('agent_id로 필터링된 항목을 반환해야 함', () => {
      // Given: 여러 agent_id의 항목 저장
      const record1: CoreMemoryRecord = {
        core_id: 'core1',
        agent_id: 'agent1',
        key: 'key1',
        value: 'value1',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const record2: CoreMemoryRecord = {
        core_id: 'core2',
        agent_id: 'agent2',
        key: 'key2',
        value: 'value2',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const record3: CoreMemoryRecord = {
        core_id: 'core3',
        agent_id: 'agent1',
        key: 'key3',
        value: 'value3',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      cache.set('core1', record1);
      cache.set('core2', record2);
      cache.set('core3', record3);

      // When: agent1로 필터링
      const agent1Records = cache.getByAgentId('agent1');

      // Then: agent1의 항목만 반환되어야 함
      expect(agent1Records.length).toBe(2);
      expect(agent1Records).toContainEqual(record1);
      expect(agent1Records).toContainEqual(record3);
      expect(agent1Records).not.toContainEqual(record2);
    });

    it('존재하지 않는 agent_id는 빈 배열을 반환해야 함', () => {
      // When: 존재하지 않는 agent_id로 필터링
      const records = cache.getByAgentId('nonexistent');

      // Then: 빈 배열 반환
      expect(records).toEqual([]);
    });
  });

  describe('deleteByAgentId', () => {
    it('agent_id로 필터링된 항목을 삭제해야 함', () => {
      // Given: 여러 agent_id의 항목 저장
      const record1: CoreMemoryRecord = {
        core_id: 'core1',
        agent_id: 'agent1',
        key: 'key1',
        value: 'value1',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const record2: CoreMemoryRecord = {
        core_id: 'core2',
        agent_id: 'agent2',
        key: 'key2',
        value: 'value2',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const record3: CoreMemoryRecord = {
        core_id: 'core3',
        agent_id: 'agent1',
        key: 'key3',
        value: 'value3',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      cache.set('core1', record1);
      cache.set('core2', record2);
      cache.set('core3', record3);

      // When: agent1의 항목 삭제
      const deletedCount = cache.deleteByAgentId('agent1');

      // Then: agent1의 항목만 삭제되어야 함
      expect(deletedCount).toBe(2);
      expect(cache.get('core1')).toBeUndefined();
      expect(cache.get('core3')).toBeUndefined();
      expect(cache.get('core2')).toEqual(record2); // agent2는 유지
    });

    it('존재하지 않는 agent_id는 0을 반환해야 함', () => {
      // When: 존재하지 않는 agent_id로 삭제 시도
      const deletedCount = cache.deleteByAgentId('nonexistent');

      // Then: 0 반환
      expect(deletedCount).toBe(0);
    });
  });

  describe('getStats', () => {
    it('캐시 통계를 반환해야 함', () => {
      // Given: 여러 agent_id의 항목 저장
      const record1: CoreMemoryRecord = {
        core_id: 'core1',
        agent_id: 'agent1',
        key: 'key1',
        value: 'value1',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const record2: CoreMemoryRecord = {
        core_id: 'core2',
        agent_id: 'agent2',
        key: 'key2',
        value: 'value2',
        always_load: true,
        origin_source: 'test',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      cache.set('core1', record1);
      cache.set('core2', record2);

      // When: 통계 조회
      const stats = cache.getStats();

      // Then: 통계가 반환되어야 함
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('agentIds');
      expect(stats).toHaveProperty('keys');
      expect(stats.size).toBe(2);
      expect(stats.agentIds).toContain('agent1');
      expect(stats.agentIds).toContain('agent2');
      expect(stats.keys).toContain('core1');
      expect(stats.keys).toContain('core2');
    });
  });

  describe('싱글톤 함수', () => {
    it('getCoreMemoryCache()는 싱글톤 인스턴스를 반환해야 함', () => {
      // When: 여러 번 호출
      const instance1 = getCoreMemoryCache();
      const instance2 = getCoreMemoryCache();

      // Then: 동일한 인스턴스 반환
      expect(instance1).toBe(instance2);
    });

    it('setCoreMemoryCache()로 인스턴스를 설정할 수 있어야 함', () => {
      // Given: 새로운 인스턴스 생성
      const newCache = new CoreMemoryCacheService();

      // When: 인스턴스 설정
      setCoreMemoryCache(newCache);

      // Then: 설정된 인스턴스가 반환되어야 함
      const retrieved = getCoreMemoryCache();
      expect(retrieved).toBe(newCache);
    });

    it('resetCoreMemoryCache()로 인스턴스를 초기화할 수 있어야 함', () => {
      // Given: 인스턴스 생성 및 설정
      const cache1 = new CoreMemoryCacheService();
      setCoreMemoryCache(cache1);

      // When: 초기화
      resetCoreMemoryCache();

      // Then: 새로운 인스턴스가 생성되어야 함
      const cache2 = getCoreMemoryCache();
      expect(cache2).not.toBe(cache1);
    });
  });
});


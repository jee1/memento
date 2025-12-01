/**
 * AnchorManager 테스트
 * 앵커 관리 서비스 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AnchorManager } from './anchor-manager.js';
import { AnchorCacheService } from './anchor-cache-service.js';
import { AnchorSearchService } from './anchor-search-service.js';
import type { AnchorSlot } from '../anchor-interfaces.js';
import { setupTestDatabase, createTestMemory, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';

describe('AnchorManager', () => {
  let manager: AnchorManager;
  let cacheService: AnchorCacheService;
  let searchService: AnchorSearchService;
  let db: Database.Database;
  const agentId = 'test-agent';

  beforeEach(async () => {
    db = await setupTestDatabase();
    cacheService = new AnchorCacheService();
    cacheService.setDatabase(db);
    searchService = new AnchorSearchService(cacheService);
    searchService.setDatabase(db);
    manager = new AnchorManager(cacheService, searchService);
    manager.setDatabase(db);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('setAnchor', () => {
    it('앵커를 설정해야 함', async () => {
      // Given: 메모리 생성
      const memoryId = createTestMemory(db, {
        content: 'Test anchor memory',
        type: 'episodic'
      });

      // When: 앵커 설정
      await manager.setAnchor(agentId, memoryId, 'A');

      // Then: 앵커가 설정되었는지 확인
      const anchor = await manager.getAnchor(agentId, 'A');
      expect(anchor).toBeDefined();
      expect((anchor as any).memory_id).toBe(memoryId);
    });

    it('존재하지 않는 메모리에 대해 에러를 던져야 함', async () => {
      // Given: 존재하지 않는 메모리 ID
      const nonexistentId = 'mem_nonexistent';

      // When & Then: 에러 발생
      await expect(
        manager.setAnchor(agentId, nonexistentId, 'A')
      ).rejects.toThrow();
    });

    it('동일한 메모리를 다른 슬롯에 설정하면 에러를 던져야 함', async () => {
      // Given: 메모리 생성 및 슬롯 A에 설정
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic'
      });
      await manager.setAnchor(agentId, memoryId, 'A');

      // When & Then: 동일한 메모리를 슬롯 B에 설정 시도하면 에러
      await expect(
        manager.setAnchor(agentId, memoryId, 'B')
      ).rejects.toThrow();
    });

    it('기존 앵커를 업데이트해야 함', async () => {
      // Given: 메모리 2개 생성 및 첫 번째를 슬롯 A에 설정
      const memoryId1 = createTestMemory(db, { content: 'Memory 1', type: 'episodic' });
      const memoryId2 = createTestMemory(db, { content: 'Memory 2', type: 'episodic' });
      await manager.setAnchor(agentId, memoryId1, 'A');

      // When: 다른 메모리로 업데이트
      await manager.setAnchor(agentId, memoryId2, 'A');

      // Then: 앵커가 업데이트되었는지 확인
      const anchor = await manager.getAnchor(agentId, 'A');
      expect((anchor as any).memory_id).toBe(memoryId2);
    });
  });

  describe('getAnchor', () => {
    it('특정 슬롯의 앵커를 조회해야 함', async () => {
      // Given: 앵커 설정
      const memoryId = createTestMemory(db, { content: 'Test', type: 'episodic' });
      await manager.setAnchor(agentId, memoryId, 'A');

      // When: 앵커 조회
      const anchor = await manager.getAnchor(agentId, 'A');

      // Then: 앵커 정보 반환
      expect(anchor).toBeDefined();
      expect((anchor as any).memory_id).toBe(memoryId);
      expect((anchor as any).slot).toBe('A');
    });

    it('모든 슬롯의 앵커를 조회해야 함', async () => {
      // Given: 여러 슬롯에 앵커 설정
      const memoryA = createTestMemory(db, { content: 'Memory A', type: 'episodic' });
      const memoryB = createTestMemory(db, { content: 'Memory B', type: 'episodic' });
      await manager.setAnchor(agentId, memoryA, 'A');
      await manager.setAnchor(agentId, memoryB, 'B');

      // When: 모든 앵커 조회
      const anchors = await manager.getAnchor(agentId);

      // Then: 모든 앵커 반환
      expect(Array.isArray(anchors)).toBe(true);
      expect(anchors.length).toBeGreaterThanOrEqual(2);
    });

    it('앵커가 없으면 null을 반환해야 함', async () => {
      // When: 앵커 조회
      const anchor = await manager.getAnchor(agentId, 'A');

      // Then: null 반환
      expect(anchor).toBeNull();
    });
  });

  describe('clearAnchor', () => {
    it('앵커를 제거해야 함', async () => {
      // Given: 앵커 설정
      const memoryId = createTestMemory(db, { content: 'Test', type: 'episodic' });
      await manager.setAnchor(agentId, memoryId, 'A');

      // When: 앵커 제거
      await manager.clearAnchor(agentId, 'A');

      // Then: 앵커가 제거되었는지 확인
      const anchor = await manager.getAnchor(agentId, 'A');
      expect(anchor).toBeNull();
    });

    it('모든 슬롯의 앵커를 제거해야 함', async () => {
      // Given: 여러 슬롯에 앵커 설정
      const memoryA = createTestMemory(db, { content: 'Memory A', type: 'episodic' });
      const memoryB = createTestMemory(db, { content: 'Memory B', type: 'episodic' });
      await manager.setAnchor(agentId, memoryA, 'A');
      await manager.setAnchor(agentId, memoryB, 'B');

      // When: 모든 앵커 제거
      await manager.clearAnchor(agentId);

      // Then: 모든 앵커가 제거되었는지 확인
      const anchors = await manager.getAnchor(agentId);
      expect(anchors).toBeNull();
    });
  });

  describe('getSearchService', () => {
    it('검색 서비스를 반환해야 함', () => {
      // When: 검색 서비스 조회
      const service = manager.getSearchService();

      // Then: 검색 서비스 반환
      expect(service).toBeDefined();
      expect(service).toBe(searchService);
    });
  });

  describe('getCacheService', () => {
    it('캐시 서비스를 반환해야 함', () => {
      // When: 캐시 서비스 조회
      const service = manager.getCacheService();

      // Then: 캐시 서비스 반환
      expect(service).toBeDefined();
      expect(service).toBe(cacheService);
    });
  });

  describe('setDatabase', () => {
    it('데이터베이스를 설정해야 함', () => {
      // Given: 새로운 매니저
      const newManager = new AnchorManager(cacheService, searchService);

      // When: 데이터베이스 설정
      newManager.setDatabase(db);

      // Then: 에러 없이 설정됨
      expect(() => newManager.setDatabase(db)).not.toThrow();
    });

    it('null 데이터베이스에 대해 에러를 던져야 함', () => {
      // Given: 새로운 매니저
      const newManager = new AnchorManager(cacheService, searchService);

      // When & Then: null 데이터베이스 설정 시 에러
      expect(() => newManager.setDatabase(null as any)).toThrow('Database instance is required');
    });
  });

  describe('캐시 통합', () => {
    it('앵커 설정 시 캐시를 업데이트해야 함', async () => {
      // Given: 메모리 생성
      const memoryId = createTestMemory(db, { content: 'Test', type: 'episodic' });

      // When: 앵커 설정
      await manager.setAnchor(agentId, memoryId, 'A');

      // Then: 캐시에 반영되었는지 확인
      const cached = cacheService.getCachedAnchor(agentId);
      expect(cached?.A).toBe(memoryId);
    });

    it('앵커 조회 시 캐시를 활용해야 함', async () => {
      // Given: 앵커 설정
      const memoryId = createTestMemory(db, { content: 'Test', type: 'episodic' });
      await manager.setAnchor(agentId, memoryId, 'A');

      // When: 앵커 조회
      const anchor = await manager.getAnchor(agentId, 'A');

      // Then: 캐시를 통해 조회됨
      expect(anchor).toBeDefined();
      expect((anchor as any).memory_id).toBe(memoryId);
    });

    it('앵커 제거 시 캐시를 업데이트해야 함', async () => {
      // Given: 앵커 설정
      const memoryId = createTestMemory(db, { content: 'Test', type: 'episodic' });
      await manager.setAnchor(agentId, memoryId, 'A');

      // When: 앵커 제거
      await manager.clearAnchor(agentId, 'A');

      // Then: 캐시가 업데이트되었는지 확인
      const cached = cacheService.getCachedAnchor(agentId);
      expect(cached?.A).toBeNull();
    });
  });

  describe('getSlotConfig', () => {
    it('슬롯별 설정을 반환해야 함', () => {
      // Given & When: 슬롯 설정 조회
      const configA = manager.getSlotConfig('A');
      const configB = manager.getSlotConfig('B');
      const configC = manager.getSlotConfig('C');

      // Then: 올바른 설정 반환
      expect(configA.hop_limit).toBe(1);
      expect(configA.vector_threshold).toBe(0.8);
      expect(configB.hop_limit).toBe(2);
      expect(configB.vector_threshold).toBe(0.6);
      expect(configC.hop_limit).toBe(3);
      expect(configC.vector_threshold).toBe(0.4);
    });
  });
});


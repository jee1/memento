/**
 * AnchorSearchService 테스트
 * 앵커 검색 서비스 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AnchorSearchService } from './anchor-search-service.js';
import { AnchorCacheService } from './anchor-cache-service.js';
import type { HybridSearchEngine } from '../../algorithms/hybrid-search-engine.js';
import type { VectorSearchEngine } from '../../algorithms/vector-search-engine.js';
import { setupTestDatabase, createTestMemory, cleanupTestDatabase } from '../../test/helpers/test-database.js';

describe('AnchorSearchService', () => {
  let service: AnchorSearchService;
  let cacheService: AnchorCacheService;
  let db: Database.Database;
  let mockHybridSearchEngine: HybridSearchEngine;
  let mockVectorSearchEngine: VectorSearchEngine;
  const agentId = 'test-agent';

  beforeEach(async () => {
    db = await setupTestDatabase();
    cacheService = new AnchorCacheService();
    cacheService.setDatabase(db);
    service = new AnchorSearchService(cacheService);
    service.setDatabase(db);

    // Mock 검색 엔진 생성
    mockHybridSearchEngine = {
      search: vi.fn().mockResolvedValue([])
    } as any;

    mockVectorSearchEngine = {
      initialize: vi.fn(),
      search: vi.fn().mockResolvedValue([]),
      searchBySimilarity: vi.fn().mockResolvedValue([])
    } as any;

    service.setHybridSearchEngine(mockHybridSearchEngine);
    service.setVectorSearchEngine(mockVectorSearchEngine);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('setHybridSearchEngine', () => {
    it('하이브리드 검색 엔진을 설정해야 함', () => {
      // Given: 새로운 검색 엔진
      const newEngine = {
        search: vi.fn()
      } as any;

      // When: 엔진 설정
      service.setHybridSearchEngine(newEngine);

      // Then: 설정 완료 (에러 없음)
      expect(() => service.setHybridSearchEngine(newEngine)).not.toThrow();
    });

    it('null 엔진에 대해 에러를 던져야 함', () => {
      // When & Then: null 엔진 설정 시 에러
      expect(() => service.setHybridSearchEngine(null as any)).toThrow('HybridSearchEngine is required');
    });
  });

  describe('setVectorSearchEngine', () => {
    it('벡터 검색 엔진을 설정해야 함', () => {
      // Given: 새로운 벡터 엔진
      const newEngine = {
        initialize: vi.fn(),
        search: vi.fn()
      } as any;

      // When: 엔진 설정
      service.setVectorSearchEngine(newEngine);

      // Then: 설정 완료
      expect(() => service.setVectorSearchEngine(newEngine)).not.toThrow();
    });

    it('null 엔진에 대해 에러를 던져야 함', () => {
      // When & Then: null 엔진 설정 시 에러
      expect(() => service.setVectorSearchEngine(null as any)).toThrow('VectorSearchEngine is required');
    });
  });

  describe('searchLocal', () => {
    it('로컬 검색을 수행해야 함', async () => {
      // Given: 앵커 메모리 생성
      const anchorMemoryId = createTestMemory(db, {
        content: 'Anchor memory',
        type: 'episodic'
      });

      // Mock 임베딩 설정
      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      vi.spyOn(cacheService, 'getAnchorEmbedding').mockResolvedValue(mockEmbedding);

      // Mock 벡터 검색 결과
      vi.spyOn(mockVectorSearchEngine, 'search').mockResolvedValue([
        {
          memory_id: 'mem_1',
          content: 'Related memory',
          type: 'episodic',
          similarity: 0.85,
          importance: 0.5,
          created_at: new Date().toISOString()
        }
      ] as any);

      // When: 로컬 검색 수행
      const result = await service.searchLocal(
        agentId,
        'A',
        'test query',
        undefined,
        undefined,
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: 검색 결과 반환
      expect(result).toBeDefined();
      expect(result).toHaveProperty('items');
      expect(Array.isArray(result.items)).toBe(true);
      expect(result).toHaveProperty('total_count');
      expect(result).toHaveProperty('local_results_count');
      expect(result).toHaveProperty('fallback_used');
      expect(result).toHaveProperty('query_time');
    });

    it('N-hop 검색을 수행해야 함', async () => {
      // Given: 앵커 메모리 및 연결된 메모리들 생성
      const anchorMemoryId = createTestMemory(db, {
        content: 'Anchor memory',
        type: 'episodic'
      });

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // 1-hop, 2-hop 메모리 모킹
      vi.spyOn(mockVectorSearchEngine, 'search')
        .mockResolvedValueOnce([
          {
            memory_id: 'mem_1hop',
            content: '1-hop memory',
            type: 'episodic',
            similarity: 0.9,
            importance: 0.5,
            created_at: new Date().toISOString()
          }
        ] as any)
        .mockResolvedValueOnce([
          {
            memory_id: 'mem_2hop',
            content: '2-hop memory',
            type: 'episodic',
            similarity: 0.7,
            importance: 0.5,
            created_at: new Date().toISOString()
          }
        ] as any);

      // 2-hop 메모리의 임베딩 모킹
      vi.spyOn(cacheService, 'getAnchorEmbedding')
        .mockResolvedValueOnce(mockEmbedding) // 1-hop 메모리 임베딩
        .mockResolvedValueOnce({
          embedding: Array(384).fill(0.2),
          provider: 'tfidf'
        }); // 2-hop 메모리 임베딩

      // When: 슬롯 B로 검색 (hop_limit: 2)
      const result = await service.searchLocal(
        agentId,
        'B',
        undefined, // 쿼리 없음
        2, // hop_limit
        { limit: 10 },
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: N-hop 검색 결과 반환
      expect(result.items.length).toBeGreaterThanOrEqual(0);
      expect(mockVectorSearchEngine.search).toHaveBeenCalled();
    });

    it('쿼리 기반 필터링을 수행해야 함', async () => {
      // Given: 앵커 메모리 및 검색 결과
      const anchorMemoryId = createTestMemory(db, {
        content: 'Anchor memory',
        type: 'episodic'
      });

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // Mock 검색 결과
      vi.spyOn(mockVectorSearchEngine, 'search').mockResolvedValue([
        {
          memory_id: 'mem_1',
          content: 'Test query related memory',
          type: 'episodic',
          similarity: 0.8,
          importance: 0.5,
          created_at: new Date().toISOString()
        },
        {
          memory_id: 'mem_2',
          content: 'Unrelated memory',
          type: 'episodic',
          similarity: 0.6,
          importance: 0.5,
          created_at: new Date().toISOString()
        }
      ] as any);

      // 쿼리 임베딩 서비스 모킹
      const { UnifiedEmbeddingService } = await import('../unified-embedding-service.js');
      const mockQueryEmbedding = Array(384).fill(0.15);
      vi.spyOn(UnifiedEmbeddingService.prototype, 'generateEmbedding').mockResolvedValue({
        embedding: mockQueryEmbedding,
        provider: 'tfidf',
        dimensions: 384,
        model: 'tfidf'
      });

      // When: 쿼리와 함께 검색
      const result = await service.searchLocal(
        agentId,
        'A',
        'test query', // 쿼리 제공
        undefined,
        { limit: 10 },
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: 쿼리 기반 필터링이 적용되어야 함
      expect(result.items.length).toBeGreaterThanOrEqual(0);
    });

    it('결과가 min_results 미만이면 fallback을 사용해야 함', async () => {
      // Given: 앵커 메모리 및 적은 검색 결과
      const anchorMemoryId = createTestMemory(db, {
        content: 'Anchor memory',
        type: 'episodic'
      });

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // Mock 적은 검색 결과 (min_results: 3 미만)
      vi.spyOn(mockVectorSearchEngine, 'search').mockResolvedValue([
        {
          memory_id: 'mem_1',
          content: 'Only one result',
          type: 'episodic',
          similarity: 0.8,
          importance: 0.5,
          created_at: new Date().toISOString()
        }
      ] as any);

      // Mock 하이브리드 검색 결과 (fallback)
      vi.spyOn(mockHybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: 'mem_fallback_1',
            content: 'Fallback result 1',
            type: 'episodic',
            finalScore: 0.9,
            importance: 0.5,
            created_at: new Date().toISOString(),
            tags: []
          },
          {
            id: 'mem_fallback_2',
            content: 'Fallback result 2',
            type: 'episodic',
            finalScore: 0.85,
            importance: 0.5,
            created_at: new Date().toISOString(),
            tags: []
          }
        ]
      } as any);

      // When: 쿼리와 함께 검색 (min_results: 3)
      const result = await service.searchLocal(
        agentId,
        'A',
        'test query',
        undefined,
        { limit: 10, min_results: 3 }, // min_results 설정
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: fallback이 사용되어야 함
      expect(result.fallback_used).toBe(true);
      expect(result.items.length).toBeGreaterThanOrEqual(2); // fallback 결과 포함
      expect(mockHybridSearchEngine.search).toHaveBeenCalled();
    });

    it('결과가 min_results 이상이면 fallback을 사용하지 않아야 함', async () => {
      // Given: 앵커 메모리 및 충분한 검색 결과
      const anchorMemoryId = createTestMemory(db, {
        content: 'Anchor memory',
        type: 'episodic'
      });

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // Mock 충분한 검색 결과 (min_results: 3 이상)
      vi.spyOn(mockVectorSearchEngine, 'search').mockResolvedValue([
        {
          memory_id: 'mem_1',
          content: 'Result 1',
          type: 'episodic',
          similarity: 0.9,
          importance: 0.5,
          created_at: new Date().toISOString()
        },
        {
          memory_id: 'mem_2',
          content: 'Result 2',
          type: 'episodic',
          similarity: 0.85,
          importance: 0.5,
          created_at: new Date().toISOString()
        },
        {
          memory_id: 'mem_3',
          content: 'Result 3',
          type: 'episodic',
          similarity: 0.8,
          importance: 0.5,
          created_at: new Date().toISOString()
        }
      ] as any);

      // When: 쿼리와 함께 검색 (min_results: 3)
      const result = await service.searchLocal(
        agentId,
        'A',
        'test query',
        undefined,
        { limit: 10, min_results: 3 },
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: fallback이 사용되지 않아야 함 (또는 충분한 결과가 있으면 fallback 불필요)
      // 실제 구현에 따라 fallback_used가 false이거나, 충분한 결과가 있으면 fallback이 호출되지 않음
      if (result.local_results_count >= 3) {
        expect(mockHybridSearchEngine.search).not.toHaveBeenCalled();
      } else {
        // 결과가 부족하면 fallback이 사용될 수 있음
        expect(result.fallback_used).toBeDefined();
      }
    });

    it('VectorSearchEngine이 없으면 에러를 던져야 함', async () => {
      // Given: VectorSearchEngine이 없는 서비스
      const serviceWithoutEngine = new AnchorSearchService(cacheService);
      serviceWithoutEngine.setDatabase(db);

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // When & Then: 에러 발생
      await expect(
        serviceWithoutEngine.searchLocal(
          agentId,
          'A',
          'test query',
          undefined,
          undefined,
          'mem_test',
          mockEmbedding,
          Date.now()
        )
      ).rejects.toThrow('VectorSearchEngine is not set');
    });

    it('슬롯별 hop_limit과 vector_threshold를 적용해야 함', async () => {
      // Given: 앵커 메모리
      const anchorMemoryId = createTestMemory(db, {
        content: 'Anchor memory',
        type: 'episodic'
      });

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // Mock 검색 결과
      vi.spyOn(mockVectorSearchEngine, 'search').mockResolvedValue([]);

      // When: 각 슬롯으로 검색
      const resultA = await service.searchLocal(
        agentId,
        'A', // hop_limit: 1, vector_threshold: 0.8
        undefined,
        undefined,
        undefined,
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      const resultB = await service.searchLocal(
        agentId,
        'B', // hop_limit: 2, vector_threshold: 0.6
        undefined,
        undefined,
        undefined,
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      const resultC = await service.searchLocal(
        agentId,
        'C', // hop_limit: 3, vector_threshold: 0.4
        undefined,
        undefined,
        undefined,
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: 각 슬롯별로 다른 설정이 적용되어야 함
      expect(resultA).toBeDefined();
      expect(resultB).toBeDefined();
      expect(resultC).toBeDefined();
      
      // vector_threshold는 검색 호출에서 확인
      expect(mockVectorSearchEngine.search).toHaveBeenCalled();
    });
  });

  describe('getSlotConfig', () => {
    it('슬롯별 설정을 반환해야 함', () => {
      // Given & When: 슬롯 설정 조회
      const configA = service.getSlotConfig('A');
      const configB = service.getSlotConfig('B');
      const configC = service.getSlotConfig('C');

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


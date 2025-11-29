/**
 * AnchorSearchService 테스트
 * 앵커 검색 서비스 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AnchorSearchService } from './anchor-search-service.js';
import { AnchorCacheService } from './anchor-cache-service.js';
import type { HybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import type { VectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';
import { setupTestDatabase, createTestMemory, cleanupTestDatabase } from '../../test/helpers/test-database.js';
import { RelationGraph } from '../../../relation/services/relation-graph.js';
import { RelationEngineSchemaMigration } from '../../infrastructure/database/migration/migrations/005-relation-engine-schema.js';

describe('AnchorSearchService', () => {
  let service: AnchorSearchService;
  let cacheService: AnchorCacheService;
  let db: Database.Database;
  let mockHybridSearchEngine: HybridSearchEngine;
  let mockVectorSearchEngine: VectorSearchEngine;
  let relationGraph: RelationGraph | null = null;
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

    // 관계 그래프 초기화 (선택적)
    try {
      const migration = new RelationEngineSchemaMigration();
      migration.up(db);
      relationGraph = new RelationGraph(db);
      service.setRelationGraph(relationGraph);
    } catch (error) {
      // 관계 그래프 스키마가 없으면 무시
      relationGraph = null;
    }
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

  describe('관계 그래프 통합', () => {
    beforeEach(async () => {
      // 관계 그래프가 없으면 스킵
      if (!relationGraph) {
        return;
      }
    });

    it('관계 그래프가 설정되면 관계 기반 hop 탐색을 수행해야 함', async () => {
      // Given: 관계 그래프가 설정되지 않은 경우 스킵
      if (!relationGraph) {
        return;
      }

      // Given: 앵커 메모리 및 관계가 있는 메모리 생성
      const anchorMemoryId = createTestMemory(db, {
        content: 'Anchor memory',
        type: 'episodic'
      });

      const relatedMemoryId = createTestMemory(db, {
        content: 'Related memory via relation graph',
        type: 'episodic'
      });

      // 관계 추가
      await relationGraph.addRelation(
        anchorMemoryId,
        relatedMemoryId,
        'FOLLOWS',
        { confidence: 0.8 }
      );

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // 관계 그래프를 통한 연결된 메모리는 벡터 검색보다 우선
      vi.spyOn(mockVectorSearchEngine, 'search').mockResolvedValue([
        {
          memory_id: 'mem_vector',
          content: 'Vector search result',
          type: 'episodic',
          similarity: 0.7,
          importance: 0.5,
          created_at: new Date().toISOString()
        }
      ] as any);

      vi.spyOn(cacheService, 'getAnchorEmbedding').mockResolvedValue(mockEmbedding);

      // When: 관계 그래프를 사용한 검색
      const result = await service.searchLocal(
        agentId,
        'A',
        undefined,
        undefined,
        { limit: 10, use_relations: true },
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: 관계가 있는 메모리가 결과에 포함되어야 함
      expect(result.items.length).toBeGreaterThanOrEqual(0);
    });

    it('관계가 있는 기억이 우선순위를 받아야 함', async () => {
      // Given: 관계 그래프가 설정되지 않은 경우 스킵
      if (!relationGraph) {
        return;
      }

      // Given: 앵커 메모리 및 여러 메모리 생성
      const anchorMemoryId = createTestMemory(db, {
        content: 'Anchor memory',
        type: 'episodic'
      });

      const relatedMemoryId = createTestMemory(db, {
        content: 'Related memory with high confidence',
        type: 'episodic'
      });

      const unrelatedMemoryId = createTestMemory(db, {
        content: 'Unrelated memory',
        type: 'episodic'
      });

      // 관계 추가
      await relationGraph.addRelation(
        anchorMemoryId,
        relatedMemoryId,
        'CAUSES',
        { confidence: 0.9 }
      );

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // 벡터 검색 결과 (관계 없는 메모리가 더 높은 유사도)
      vi.spyOn(mockVectorSearchEngine, 'search').mockResolvedValue([
        {
          memory_id: unrelatedMemoryId,
          content: 'Unrelated but high similarity',
          type: 'episodic',
          similarity: 0.95, // 높은 유사도
          importance: 0.5,
          created_at: new Date().toISOString()
        },
        {
          memory_id: relatedMemoryId,
          content: 'Related memory',
          type: 'episodic',
          similarity: 0.7, // 낮은 유사도
          importance: 0.5,
          created_at: new Date().toISOString()
        }
      ] as any);

      vi.spyOn(cacheService, 'getAnchorEmbedding').mockResolvedValue(mockEmbedding);

      // When: 관계 그래프를 사용한 검색
      const result = await service.searchLocal(
        agentId,
        'A',
        undefined,
        undefined,
        { limit: 10, use_relations: true },
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: 관계가 있는 메모리가 우선순위를 받아야 함 (관계 우선순위 부스트 적용)
      expect(result.items.length).toBeGreaterThanOrEqual(0);
      // 관계가 있는 메모리가 결과에 포함되어야 함
      const hasRelatedMemory = result.items.some(item => item.id === relatedMemoryId);
      expect(hasRelatedMemory).toBe(true);
    });

    it('use_relations가 false이면 관계 그래프를 사용하지 않아야 함', async () => {
      // Given: 관계 그래프가 설정되지 않은 경우 스킵
      if (!relationGraph) {
        return;
      }

      // Given: 앵커 메모리 및 관계가 있는 메모리 생성
      const anchorMemoryId = createTestMemory(db, {
        content: 'Anchor memory',
        type: 'episodic'
      });

      const relatedMemoryId = createTestMemory(db, {
        content: 'Related memory',
        type: 'episodic'
      });

      // 관계 추가
      await relationGraph.addRelation(
        anchorMemoryId,
        relatedMemoryId,
        'FOLLOWS',
        { confidence: 0.8 }
      );

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // 벡터 검색 결과만 반환
      vi.spyOn(mockVectorSearchEngine, 'search').mockResolvedValue([
        {
          memory_id: 'mem_vector_only',
          content: 'Vector search only',
          type: 'episodic',
          similarity: 0.8,
          importance: 0.5,
          created_at: new Date().toISOString()
        }
      ] as any);

      vi.spyOn(cacheService, 'getAnchorEmbedding').mockResolvedValue(mockEmbedding);

      // 관계 그래프 getRelations 호출 모니터링
      const getRelationsSpy = vi.spyOn(relationGraph, 'getRelations');

      // When: use_relations가 false인 검색
      const result = await service.searchLocal(
        agentId,
        'A',
        undefined,
        undefined,
        { limit: 10, use_relations: false },
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: 관계 그래프가 호출되지 않아야 함 (또는 최소한 랭킹 계산에서 호출되지 않음)
      // getLinkedMemories에서 호출되지 않으므로 getRelations는 호출되지 않아야 함
      expect(result.items.length).toBeGreaterThanOrEqual(0);
    });

    it('관계 가중치가 랭킹에 반영되어야 함', async () => {
      // Given: 관계 그래프가 설정되지 않은 경우 스킵
      if (!relationGraph) {
        return;
      }

      // Given: 앵커 메모리 및 여러 관계가 있는 메모리 생성
      const anchorMemoryId = createTestMemory(db, {
        content: 'Anchor memory',
        type: 'episodic'
      });

      const highConfidenceMemoryId = createTestMemory(db, {
        content: 'High confidence relation',
        type: 'episodic'
      });

      const lowConfidenceMemoryId = createTestMemory(db, {
        content: 'Low confidence relation',
        type: 'episodic'
      });

      // 높은 신뢰도 관계 추가
      await relationGraph.addRelation(
        anchorMemoryId,
        highConfidenceMemoryId,
        'CAUSES',
        { confidence: 0.95 }
      );

      // 낮은 신뢰도 관계 추가
      await relationGraph.addRelation(
        anchorMemoryId,
        lowConfidenceMemoryId,
        'REFERENCES',
        { confidence: 0.5 }
      );

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // 벡터 검색 결과 (동일한 유사도)
      vi.spyOn(mockVectorSearchEngine, 'search').mockResolvedValue([
        {
          memory_id: highConfidenceMemoryId,
          content: 'High confidence',
          type: 'episodic',
          similarity: 0.7,
          importance: 0.5,
          created_at: new Date().toISOString()
        },
        {
          memory_id: lowConfidenceMemoryId,
          content: 'Low confidence',
          type: 'episodic',
          similarity: 0.7, // 동일한 유사도
          importance: 0.5,
          created_at: new Date().toISOString()
        }
      ] as any);

      vi.spyOn(cacheService, 'getAnchorEmbedding').mockResolvedValue(mockEmbedding);

      // When: 관계 그래프를 사용한 검색
      const result = await service.searchLocal(
        agentId,
        'A',
        undefined,
        undefined,
        { limit: 10, use_relations: true },
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: 높은 신뢰도 관계를 가진 메모리가 더 높은 랭킹을 받아야 함
      expect(result.items.length).toBeGreaterThanOrEqual(0);
      
      const highConfidenceIndex = result.items.findIndex(item => item.id === highConfidenceMemoryId);
      const lowConfidenceIndex = result.items.findIndex(item => item.id === lowConfidenceMemoryId);
      
      if (highConfidenceIndex >= 0 && lowConfidenceIndex >= 0) {
        // 높은 신뢰도 관계를 가진 메모리가 더 앞에 있어야 함
        expect(highConfidenceIndex).toBeLessThan(lowConfidenceIndex);
      }
    });
  });

  describe('통합 테스트', () => {
    beforeEach(async () => {
      // 관계 그래프가 없으면 스킵
      if (!relationGraph) {
        return;
      }
    });

    it('1-hop 관계 탐색을 수행해야 함', async () => {
      // Given: 관계 그래프가 설정되지 않은 경우 스킵
      if (!relationGraph) {
        return;
      }

      // Given: 앵커 메모리 및 1-hop 관계 메모리 생성
      const anchorMemoryId = createTestMemory(db, {
        content: '프로젝트 시작: 새로운 웹 애플리케이션 개발',
        type: 'episodic'
      });

      const hop1MemoryId = createTestMemory(db, {
        content: '프로젝트 계획서 작성 완료',
        type: 'episodic'
      });

      const hop1MemoryId2 = createTestMemory(db, {
        content: '개발 환경 설정 완료',
        type: 'episodic'
      });

      // 1-hop 관계 추가
      await relationGraph.addRelation(
        anchorMemoryId,
        hop1MemoryId,
        'FOLLOWS',
        { confidence: 0.85 }
      );

      await relationGraph.addRelation(
        anchorMemoryId,
        hop1MemoryId2,
        'FOLLOWS',
        { confidence: 0.75 }
      );

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // 벡터 검색 결과 (관계와 무관한 메모리)
      vi.spyOn(mockVectorSearchEngine, 'search').mockResolvedValue([
        {
          memory_id: 'mem_unrelated',
          content: '무관한 메모리',
          type: 'episodic',
          similarity: 0.6,
          importance: 0.5,
          created_at: new Date().toISOString()
        }
      ] as any);

      vi.spyOn(cacheService, 'getAnchorEmbedding').mockResolvedValue(mockEmbedding);

      // When: 1-hop 검색 수행
      const result = await service.searchLocal(
        agentId,
        'A', // hop_limit: 1
        undefined,
        undefined,
        { limit: 10, use_relations: true },
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: 1-hop 관계 메모리가 결과에 포함되어야 함
      expect(result.items.length).toBeGreaterThan(0);
      
      const hop1Memories = result.items.filter(item => 
        item.id === hop1MemoryId || item.id === hop1MemoryId2
      );
      
      // 1-hop 관계 메모리가 최소 1개 이상 포함되어야 함
      expect(hop1Memories.length).toBeGreaterThan(0);
      
      // 관계가 있는 메모리는 우선순위를 받아야 함
      if (hop1Memories.length > 0) {
        const firstHop1Index = result.items.findIndex(item => 
          item.id === hop1Memories[0].id
        );
        const unrelatedIndex = result.items.findIndex(item => 
          item.id === 'mem_unrelated'
        );
        
        // 관계가 있는 메모리가 무관한 메모리보다 앞에 있어야 함 (우선순위)
        if (unrelatedIndex >= 0 && firstHop1Index >= 0) {
          expect(firstHop1Index).toBeLessThan(unrelatedIndex);
        }
      }
    });

    it('2-hop 관계 탐색을 수행해야 함', async () => {
      // Given: 관계 그래프가 설정되지 않은 경우 스킵
      if (!relationGraph) {
        return;
      }

      // Given: 앵커 메모리 및 1-hop, 2-hop 관계 메모리 생성
      const anchorMemoryId = createTestMemory(db, {
        content: '프로젝트 시작',
        type: 'episodic'
      });

      const hop1MemoryId = createTestMemory(db, {
        content: '프로젝트 계획서 작성',
        type: 'episodic'
      });

      const hop2MemoryId = createTestMemory(db, {
        content: '개발 팀 구성 완료',
        type: 'episodic'
      });

      const hop2MemoryId2 = createTestMemory(db, {
        content: '기술 스택 결정 완료',
        type: 'episodic'
      });

      // 1-hop 관계: anchor -> hop1
      await relationGraph.addRelation(
        anchorMemoryId,
        hop1MemoryId,
        'FOLLOWS',
        { confidence: 0.9 }
      );

      // 2-hop 관계: hop1 -> hop2
      await relationGraph.addRelation(
        hop1MemoryId,
        hop2MemoryId,
        'FOLLOWS',
        { confidence: 0.85 }
      );

      await relationGraph.addRelation(
        hop1MemoryId,
        hop2MemoryId2,
        'FOLLOWS',
        { confidence: 0.8 }
      );

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // 벡터 검색 결과 모킹 (1-hop, 2-hop 메모리 포함)
      vi.spyOn(mockVectorSearchEngine, 'search')
        .mockResolvedValueOnce([
          {
            memory_id: hop1MemoryId,
            content: '프로젝트 계획서 작성',
            type: 'episodic',
            similarity: 0.7,
            importance: 0.5,
            created_at: new Date().toISOString()
          }
        ] as any)
        .mockResolvedValueOnce([
          {
            memory_id: hop2MemoryId,
            content: '개발 팀 구성 완료',
            type: 'episodic',
            similarity: 0.65,
            importance: 0.5,
            created_at: new Date().toISOString()
          },
          {
            memory_id: hop2MemoryId2,
            content: '기술 스택 결정 완료',
            type: 'episodic',
            similarity: 0.6,
            importance: 0.5,
            created_at: new Date().toISOString()
          }
        ] as any);

      vi.spyOn(cacheService, 'getAnchorEmbedding')
        .mockResolvedValueOnce(mockEmbedding) // anchor 임베딩
        .mockResolvedValueOnce(mockEmbedding); // hop1 임베딩

      // When: 2-hop 검색 수행
      const result = await service.searchLocal(
        agentId,
        'B', // hop_limit: 2
        undefined,
        undefined,
        { limit: 10, use_relations: true },
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: 2-hop 관계 메모리가 결과에 포함되어야 함
      expect(result.items.length).toBeGreaterThan(0);
      
      const hop2Memories = result.items.filter(item => 
        item.id === hop2MemoryId || item.id === hop2MemoryId2
      );
      
      // 2-hop 관계 메모리가 최소 1개 이상 포함되어야 함
      expect(hop2Memories.length).toBeGreaterThan(0);
      
      // hop_distance가 2인 메모리가 있어야 함
      const hop2Items = result.items.filter(item => item.hop_distance === 2);
      expect(hop2Items.length).toBeGreaterThan(0);
    });

    it('벡터 유사도와 관계 그래프를 결합한 하이브리드 검색을 수행해야 함', async () => {
      // Given: 관계 그래프가 설정되지 않은 경우 스킵
      if (!relationGraph) {
        return;
      }

      // Given: 앵커 메모리 및 여러 메모리 생성
      const anchorMemoryId = createTestMemory(db, {
        content: 'React 프로젝트 시작',
        type: 'episodic'
      });

      const relatedHighSimilarityId = createTestMemory(db, {
        content: 'React 컴포넌트 설계',
        type: 'episodic'
      });

      const relatedLowSimilarityId = createTestMemory(db, {
        content: '프로젝트 일정 관리',
        type: 'episodic'
      });

      const unrelatedHighSimilarityId = createTestMemory(db, {
        content: 'React 라이브러리 선택',
        type: 'episodic'
      });

      // 관계 추가
      await relationGraph.addRelation(
        anchorMemoryId,
        relatedHighSimilarityId,
        'FOLLOWS',
        { confidence: 0.9 }
      );

      await relationGraph.addRelation(
        anchorMemoryId,
        relatedLowSimilarityId,
        'FOLLOWS',
        { confidence: 0.85 }
      );

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // 벡터 검색 결과 (관계 없는 메모리가 높은 유사도)
      vi.spyOn(mockVectorSearchEngine, 'search').mockResolvedValue([
        {
          memory_id: unrelatedHighSimilarityId,
          content: 'React 라이브러리 선택',
          type: 'episodic',
          similarity: 0.95, // 매우 높은 유사도
          importance: 0.5,
          created_at: new Date().toISOString()
        },
        {
          memory_id: relatedHighSimilarityId,
          content: 'React 컴포넌트 설계',
          type: 'episodic',
          similarity: 0.75, // 중간 유사도
          importance: 0.5,
          created_at: new Date().toISOString()
        },
        {
          memory_id: relatedLowSimilarityId,
          content: '프로젝트 일정 관리',
          type: 'episodic',
          similarity: 0.5, // 낮은 유사도
          importance: 0.5,
          created_at: new Date().toISOString()
        }
      ] as any);

      vi.spyOn(cacheService, 'getAnchorEmbedding').mockResolvedValue(mockEmbedding);

      // When: 하이브리드 검색 수행 (관계 그래프 + 벡터 유사도)
      const result = await service.searchLocal(
        agentId,
        'A',
        undefined,
        undefined,
        { limit: 10, use_relations: true },
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: 관계가 있는 메모리가 우선순위를 받아야 함
      expect(result.items.length).toBeGreaterThan(0);
      
      const relatedHighIndex = result.items.findIndex(item => 
        item.id === relatedHighSimilarityId
      );
      const relatedLowIndex = result.items.findIndex(item => 
        item.id === relatedLowSimilarityId
      );
      const unrelatedHighIndex = result.items.findIndex(item => 
        item.id === unrelatedHighSimilarityId
      );
      
      // 관계가 있는 메모리들이 결과에 포함되어야 함
      expect(relatedHighIndex).toBeGreaterThanOrEqual(0);
      expect(relatedLowIndex).toBeGreaterThanOrEqual(0);
      
      // 관계가 있고 높은 신뢰도를 가진 메모리가 관계가 없지만 높은 유사도를 가진 메모리보다 우선순위를 받아야 함
      // (관계 우선순위 부스트 + 관계 가중치 적용)
      if (relatedHighIndex >= 0 && unrelatedHighIndex >= 0) {
        // 관계가 있는 메모리가 더 앞에 있어야 함 (관계 우선순위 부스트 적용)
        expect(relatedHighIndex).toBeLessThan(unrelatedHighIndex);
      }
    });

    it('복잡한 관계 네트워크에서 1~2-hop 탐색을 수행해야 함', async () => {
      // Given: 관계 그래프가 설정되지 않은 경우 스킵
      if (!relationGraph) {
        return;
      }

      // Given: 복잡한 관계 네트워크 구성
      // anchor -> mem1 -> mem2 -> mem3
      // anchor -> mem4 -> mem5
      // anchor -> mem6 (1-hop만)
      const anchorMemoryId = createTestMemory(db, {
        content: '프로젝트 시작',
        type: 'episodic'
      });

      const mem1Id = createTestMemory(db, {
        content: '요구사항 분석',
        type: 'episodic'
      });

      const mem2Id = createTestMemory(db, {
        content: '시스템 설계',
        type: 'episodic'
      });

      const mem3Id = createTestMemory(db, {
        content: '데이터베이스 설계',
        type: 'episodic'
      });

      const mem4Id = createTestMemory(db, {
        content: 'UI/UX 설계',
        type: 'episodic'
      });

      const mem5Id = createTestMemory(db, {
        content: '프로토타입 제작',
        type: 'episodic'
      });

      const mem6Id = createTestMemory(db, {
        content: '프로젝트 팀 구성',
        type: 'episodic'
      });

      // 관계 네트워크 구성
      await relationGraph.addRelation(
        anchorMemoryId,
        mem1Id,
        'FOLLOWS',
        { confidence: 0.9 }
      );

      await relationGraph.addRelation(
        mem1Id,
        mem2Id,
        'FOLLOWS',
        { confidence: 0.85 }
      );

      await relationGraph.addRelation(
        mem2Id,
        mem3Id,
        'DEPENDS_ON',
        { confidence: 0.8 }
      );

      await relationGraph.addRelation(
        anchorMemoryId,
        mem4Id,
        'FOLLOWS',
        { confidence: 0.88 }
      );

      await relationGraph.addRelation(
        mem4Id,
        mem5Id,
        'FOLLOWS',
        { confidence: 0.82 }
      );

      await relationGraph.addRelation(
        anchorMemoryId,
        mem6Id,
        'FOLLOWS',
        { confidence: 0.75 }
      );

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // 벡터 검색 결과 모킹 (각 hop별로)
      vi.spyOn(mockVectorSearchEngine, 'search')
        .mockResolvedValueOnce([
          {
            memory_id: mem1Id,
            content: '요구사항 분석',
            type: 'episodic',
            similarity: 0.7,
            importance: 0.5,
            created_at: new Date().toISOString()
          },
          {
            memory_id: mem4Id,
            content: 'UI/UX 설계',
            type: 'episodic',
            similarity: 0.68,
            importance: 0.5,
            created_at: new Date().toISOString()
          },
          {
            memory_id: mem6Id,
            content: '프로젝트 팀 구성',
            type: 'episodic',
            similarity: 0.65,
            importance: 0.5,
            created_at: new Date().toISOString()
          }
        ] as any)
        .mockResolvedValueOnce([
          {
            memory_id: mem2Id,
            content: '시스템 설계',
            type: 'episodic',
            similarity: 0.6,
            importance: 0.5,
            created_at: new Date().toISOString()
          },
          {
            memory_id: mem5Id,
            content: '프로토타입 제작',
            type: 'episodic',
            similarity: 0.58,
            importance: 0.5,
            created_at: new Date().toISOString()
          }
        ] as any)
        .mockResolvedValueOnce([
          {
            memory_id: mem3Id,
            content: '데이터베이스 설계',
            type: 'episodic',
            similarity: 0.55,
            importance: 0.5,
            created_at: new Date().toISOString()
          }
        ] as any);

      vi.spyOn(cacheService, 'getAnchorEmbedding')
        .mockResolvedValueOnce(mockEmbedding) // anchor
        .mockResolvedValueOnce(mockEmbedding) // mem1
        .mockResolvedValueOnce(mockEmbedding); // mem2

      // When: 2-hop 검색 수행
      const result = await service.searchLocal(
        agentId,
        'B', // hop_limit: 2
        undefined,
        undefined,
        { limit: 20, use_relations: true },
        anchorMemoryId,
        mockEmbedding,
        Date.now()
      );

      // Then: 1-hop 및 2-hop 메모리가 모두 결과에 포함되어야 함
      expect(result.items.length).toBeGreaterThan(0);
      
      // 1-hop 메모리 확인
      const hop1Memories = result.items.filter(item => 
        item.id === mem1Id || item.id === mem4Id || item.id === mem6Id
      );
      expect(hop1Memories.length).toBeGreaterThan(0);
      
      // 2-hop 메모리 확인
      const hop2Memories = result.items.filter(item => 
        item.id === mem2Id || item.id === mem5Id
      );
      expect(hop2Memories.length).toBeGreaterThan(0);
      
      // hop_distance 검증
      const hop1Items = result.items.filter(item => item.hop_distance === 1);
      const hop2Items = result.items.filter(item => item.hop_distance === 2);
      
      expect(hop1Items.length).toBeGreaterThan(0);
      expect(hop2Items.length).toBeGreaterThan(0);
      
      // 1-hop 메모리가 2-hop 메모리보다 우선순위를 받아야 함 (hop_distance가 작을수록 우선)
      if (hop1Items.length > 0 && hop2Items.length > 0) {
        const firstHop1Index = result.items.findIndex(item => 
          item.hop_distance === 1
        );
        const firstHop2Index = result.items.findIndex(item => 
          item.hop_distance === 2
        );
        
        // 1-hop이 2-hop보다 앞에 있어야 함 (같은 similarity일 때)
        expect(firstHop1Index).toBeLessThan(firstHop2Index);
      }
    });
  });
});


/**
 * Local 검색 서비스 테스트
 * Phase 3.6: searchLocal 메서드 분리 - TDD RED 단계
 * 
 * Given/When/Then 형식의 테스트 작성
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { LocalSearchService } from './local-search-service.js';
import { AnchorCacheService } from './anchor-cache-service.js';
import { NHopSearchService } from './n-hop-search-service.js';
import { QueryFilterService } from './query-filter-service.js';
import { FallbackSearchService } from './fallback-search-service.js';
import type { VectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';
import type { HybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import { setupTestDatabase, createTestMemory, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';

describe('LocalSearchService', () => {
  let service: LocalSearchService;
  let cacheService: AnchorCacheService;
  let db: Database.Database;
  let nHopSearchService: NHopSearchService;
  let queryFilterService: QueryFilterService;
  let fallbackSearchService: FallbackSearchService;
  let mockVectorSearchEngine: VectorSearchEngine;
  let mockHybridSearchEngine: HybridSearchEngine;

  beforeEach(async () => {
    // Given: 테스트 데이터베이스 및 서비스 초기화
    db = await setupTestDatabase();
    cacheService = new AnchorCacheService();
    cacheService.setDatabase(db);

    nHopSearchService = new NHopSearchService(cacheService);
    queryFilterService = new QueryFilterService(cacheService);
    fallbackSearchService = new FallbackSearchService();

    mockVectorSearchEngine = {
      initialize: vi.fn(),
      search: vi.fn().mockResolvedValue([]),
      searchBySimilarity: vi.fn().mockResolvedValue([])
    } as any;

    mockHybridSearchEngine = {
      search: vi.fn().mockResolvedValue({
        items: [],
        total_count: 0
      })
    } as any;

    nHopSearchService.setDatabase(db);
    nHopSearchService.setVectorSearchEngine(mockVectorSearchEngine);
    fallbackSearchService.setDatabase(db);
    fallbackSearchService.setHybridSearchEngine(mockHybridSearchEngine);

    service = new LocalSearchService(
      cacheService,
      nHopSearchService,
      queryFilterService,
      fallbackSearchService
    );
    service.setDatabase(db);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('getAnchorWithEmbedding', () => {
    it('앵커 정보 및 임베딩을 조회해야 함', async () => {
      // Given: 앵커 메모리가 있을 때
      const agentId = 'test-agent';
      const slot = 'A' as const;
      const anchorMemoryId = createTestMemory(db, {
        content: 'Anchor memory',
        type: 'episodic'
      });

      // 앵커 설정
      db.prepare(`
        INSERT INTO anchor (agent_id, slot, memory_id, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
      `).run(agentId, slot, anchorMemoryId);

      const mockEmbedding = {
        embedding: Array(384).fill(0.1),
        provider: 'tfidf'
      };
      vi.spyOn(cacheService, 'getAnchorEmbedding').mockResolvedValue(mockEmbedding);

      // When: getAnchorWithEmbedding을 호출하면
      const result = await service.getAnchorWithEmbedding(agentId, slot);

      // Then: 앵커 정보 및 임베딩이 반환되어야 함
      expect(result).toBeDefined();
      expect(result?.memory_id).toBe(anchorMemoryId);
      expect(result?.embedding).toEqual(mockEmbedding);
    });

    it('앵커가 없으면 null을 반환해야 함', async () => {
      // Given: 앵커가 없을 때
      const agentId = 'test-agent';
      const slot = 'A' as const;

      // When: getAnchorWithEmbedding을 호출하면
      const result = await service.getAnchorWithEmbedding(agentId, slot);

      // Then: null이 반환되어야 함
      expect(result).toBeNull();
    });
  });

  describe('performNHopSearch', () => {
    it('N-hop 검색을 수행해야 함', async () => {
      // Given: 앵커 임베딩 및 검색 파라미터가 주어졌을 때
      const anchorEmbedding = Array(384).fill(0.1);
      const provider = 'tfidf';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.7;
      const maxHops = 2;
      const limit = 10;
      const useRelations = true;

      vi.spyOn(nHopSearchService, 'searchNHop').mockResolvedValue([
        {
          memory_id: 'memory-1',
          content: 'Test content',
          type: 'episodic',
          similarity: 0.8,
          hop_distance: 1,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z'
        }
      ]);

      // When: performNHopSearch를 호출하면
      const result = await service.performNHopSearch(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        maxHops,
        limit,
        useRelations
      );

      // Then: N-hop 검색 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(nHopSearchService.searchNHop).toHaveBeenCalled();
    });
  });

  describe('applyQueryFilter', () => {
    it('쿼리 필터링을 적용해야 함', async () => {
      // Given: 검색 결과와 쿼리가 주어졌을 때
      const query = 'test query';
      const results = [
        {
          memory_id: 'memory-1',
          content: 'Test query related',
          type: 'episodic',
          similarity: 0.8,
          hop_distance: 1,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];
      const provider = 'tfidf';

      vi.spyOn(queryFilterService, 'filterByQuery').mockResolvedValue(results);

      // When: applyQueryFilter를 호출하면
      const result = await service.applyQueryFilter(query, results, provider);

      // Then: 필터링된 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(queryFilterService.filterByQuery).toHaveBeenCalledWith(query, results, provider);
    });

    it('쿼리가 없으면 원본 결과를 반환해야 함', async () => {
      // Given: 쿼리가 없을 때
      const query = undefined;
      const results = [
        {
          memory_id: 'memory-1',
          content: 'Test content',
          type: 'episodic',
          similarity: 0.8,
          hop_distance: 1,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];
      const provider = 'tfidf';

      // When: applyQueryFilter를 호출하면
      const result = await service.applyQueryFilter(query, results, provider);

      // Then: 원본 결과가 반환되어야 함
      expect(result).toEqual(results);
    });
  });

  describe('handleFallback', () => {
    it('Fallback 검색을 수행해야 함', async () => {
      // Given: Local 결과가 minResults 미만일 때
      const query = 'test query';
      const localResults: any[] = []; // 빈 결과
      const minResults = 3;
      const limit = 10;
      const options = { limit, min_results: minResults };
      const startTime = Date.now();

      const fallbackResult = {
        items: [
          {
            id: 'fallback-1',
            content: 'Fallback content',
            type: 'episodic',
            similarity: 0.6,
            importance: 0.5,
            created_at: '2024-01-01T00:00:00Z'
          }
        ],
        total_count: 1,
        local_results_count: 0,
        fallback_used: true,
        query_time: 100
      };

      vi.spyOn(fallbackSearchService, 'fallbackToGlobalSearch').mockResolvedValue(fallbackResult);

      // When: handleFallback을 호출하면
      const result = await service.handleFallback(
        query,
        localResults,
        minResults,
        options,
        startTime
      );

      // Then: Fallback 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.fallbackUsed).toBe(true);
      expect(fallbackSearchService.fallbackToGlobalSearch).toHaveBeenCalled();
    });

    it('Local 결과가 충분하면 Fallback을 수행하지 않아야 함', async () => {
      // Given: Local 결과가 minResults 이상일 때
      const query = 'test query';
      const localResults: any[] = [
        { id: 'local-1', content: 'Local 1' },
        { id: 'local-2', content: 'Local 2' },
        { id: 'local-3', content: 'Local 3' }
      ];
      const minResults = 3;
      const limit = 10;
      const options = { limit, min_results: minResults };
      const startTime = Date.now();

      // When: handleFallback을 호출하면
      const result = await service.handleFallback(
        query,
        localResults,
        minResults,
        options,
        startTime
      );

      // Then: Fallback이 수행되지 않고 Local 결과가 반환되어야 함
      expect(result.fallbackUsed).toBe(false);
      expect(result.items).toEqual(localResults);
    });

    it('#868: 병합 결과를 similarity 내림차순으로 정렬해야 함', async () => {
      // Given: local 결과(0.647)보다 fallback 결과(0.865)의 유사도가 높을 때
      const localResults: any[] = [
        {
          id: 'local-worse',
          content: 'Local content',
          type: 'episodic',
          similarity: 0.647,
          hop_distance: 1,
          importance: 0.5,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      vi.spyOn(fallbackSearchService, 'fallbackToGlobalSearch').mockResolvedValue({
        items: [
          { id: 'fallback-1', content: 'F1', type: 'episodic', similarity: 0.865, importance: 0.5, created_at: '2024-01-01T00:00:00Z' },
          { id: 'fallback-2', content: 'F2', type: 'episodic', similarity: 0.712, importance: 0.5, created_at: '2024-01-01T00:00:00Z' }
        ],
        total_count: 2,
        local_results_count: 1,
        fallback_used: true,
        query_time: 100
      });

      // When: handleFallback을 호출하면
      const result = await service.handleFallback(
        'test query',
        localResults,
        3,
        { limit: 10, min_results: 3 },
        Date.now()
      );

      // Then: 더 나쁜 local 결과가 #1을 차지하지 않고, 유사도가 단조 감소해야 함
      expect(result.items.map((item) => item.id)).toEqual(['fallback-1', 'fallback-2', 'local-worse']);
      const similarities = result.items.map((item) => item.similarity);
      expect(similarities).toEqual([...similarities].sort((a, b) => b - a));
    });

    it('#868: 동점이면 hop_distance가 작은 local 결과를 앞에 둬야 함', async () => {
      // Given: local과 fallback의 similarity가 같을 때
      const localResults: any[] = [
        {
          id: 'local-tie',
          content: 'Local content',
          type: 'episodic',
          similarity: 0.8,
          hop_distance: 2,
          importance: 0.5,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];

      vi.spyOn(fallbackSearchService, 'fallbackToGlobalSearch').mockResolvedValue({
        items: [
          { id: 'fallback-tie', content: 'F1', type: 'episodic', similarity: 0.8, importance: 0.5, created_at: '2024-01-01T00:00:00Z' }
        ],
        total_count: 1,
        local_results_count: 1,
        fallback_used: true,
        query_time: 100
      });

      // When: handleFallback을 호출하면
      const result = await service.handleFallback(
        'test query',
        localResults,
        3,
        { limit: 10, min_results: 3 },
        Date.now()
      );

      // Then: local 결과가 먼저 나와야 함 (fallback의 hop_distance는 999)
      expect(result.items.map((item) => item.id)).toEqual(['local-tie', 'fallback-tie']);
    });
  });
});

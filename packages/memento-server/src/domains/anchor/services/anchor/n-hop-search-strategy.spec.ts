/**
 * N-hop 검색 전략 테스트
 * Phase 3.4: searchLocal 메서드 분리 - TDD RED 단계
 * 
 * Given/When/Then 형식의 테스트 작성
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { NHopSearchStrategy } from './n-hop-search-strategy.js';
import { NHopSearchService } from './n-hop-search-service.js';
import { AnchorCacheService } from './anchor-cache-service.js';
import type { VectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';

describe('NHopSearchStrategy', () => {
  let strategy: NHopSearchStrategy;
  let nHopSearchService: NHopSearchService;
  let cacheService: AnchorCacheService;
  let db: Database.Database;
  let mockVectorSearchEngine: VectorSearchEngine;

  beforeEach(async () => {
    // Given: 테스트 데이터베이스 및 서비스 초기화
    db = await setupTestDatabase();
    cacheService = new AnchorCacheService();
    cacheService.setDatabase(db);
    
    nHopSearchService = new NHopSearchService(cacheService);
    
    mockVectorSearchEngine = {
      initialize: vi.fn(),
      search: vi.fn().mockResolvedValue([]),
      searchBySimilarity: vi.fn().mockResolvedValue([])
    } as any;

    nHopSearchService.setDatabase(db);
    nHopSearchService.setVectorSearchEngine(mockVectorSearchEngine);

    strategy = new NHopSearchStrategy(nHopSearchService);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('search', () => {
    it('N-hop 검색을 수행해야 함', async () => {
      // Given: 앵커 임베딩 및 검색 파라미터가 주어졌을 때
      const anchorEmbedding = Array(384).fill(0.1);
      const provider = 'tfidf';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.7;
      const maxHops = 2;
      const limit = 10;
      const useRelations = true;

      // Mock 검색 결과
      vi.spyOn(nHopSearchService, 'searchNHop').mockResolvedValue([
        {
          memory_id: 'memory-1',
          content: 'Test content 1',
          type: 'episodic',
          similarity: 0.8,
          hop_distance: 1,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z'
        }
      ]);

      // When: search를 호출하면
      const result = await strategy.search(
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
      expect(nHopSearchService.searchNHop).toHaveBeenCalledWith(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        maxHops,
        limit,
        useRelations
      );
    });

    it('전략 이름을 반환해야 함', () => {
      // Given: NHopSearchStrategy 인스턴스가 있을 때
      // When: name 속성을 조회하면
      // Then: 'NHopSearchStrategy'가 반환되어야 함
      expect(strategy.name).toBe('NHopSearchStrategy');
    });

    it('execute 메서드가 search를 호출해야 함', async () => {
      // Given: 앵커 임베딩 및 검색 파라미터가 주어졌을 때
      const anchorEmbedding = Array(384).fill(0.1);
      const provider = 'tfidf';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.7;
      const maxHops = 2;
      const limit = 10;
      const useRelations = true;

      vi.spyOn(nHopSearchService, 'searchNHop').mockResolvedValue([]);

      // When: execute를 호출하면
      const result = await strategy.execute(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        maxHops,
        limit,
        useRelations
      );

      // Then: search 메서드가 호출되어야 함
      expect(nHopSearchService.searchNHop).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });
});


/**
 * 쿼리 필터 서비스 테스트
 * Phase 2.4: anchor-search-service.ts 분리 - TDD RED 단계
 * 
 * Given/When/Then 형식의 테스트 작성
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryFilterService } from './query-filter-service.js';
import { AnchorCacheService } from './anchor-cache-service.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';

describe('QueryFilterService', () => {
  let service: QueryFilterService;
  let cacheService: AnchorCacheService;
  let db: Database.Database;

  beforeEach(async () => {
    // Given: 테스트 데이터베이스 및 서비스 초기화
    db = await setupTestDatabase();
    cacheService = new AnchorCacheService();
    cacheService.setDatabase(db);
    service = new QueryFilterService(cacheService);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('filterByQuery', () => {
    it('쿼리 기반 필터링을 수행해야 함', async () => {
      // Given: 검색 결과와 쿼리가 주어졌을 때
      const query = 'test query';
      const results = [
        {
          memory_id: 'memory-1',
          content: 'This is a test query related content',
          type: 'episodic',
          similarity: 0.8,
          hop_distance: 1,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          memory_id: 'memory-2',
          content: 'Unrelated content',
          type: 'episodic',
          similarity: 0.6,
          hop_distance: 2,
          importance: 0.5,
          created_at: '2024-01-02T00:00:00Z'
        }
      ];
      const provider = 'test-provider';

      // Mock 임베딩 서비스
      const { UnifiedEmbeddingService } = await import('../../../embedding/services/unified-embedding-service.js');
      const mockQueryEmbedding = Array(384).fill(0.15);
      vi.spyOn(UnifiedEmbeddingService.prototype, 'generateEmbedding').mockResolvedValue({
        embedding: mockQueryEmbedding,
        provider: 'tfidf',
        dimensions: 384,
        model: 'tfidf'
      });

      // Mock 캐시 서비스
      const mockMemoryEmbedding = Array(384).fill(0.14);
      vi.spyOn(cacheService, 'getAnchorEmbedding').mockResolvedValue({
        embedding: mockMemoryEmbedding,
        provider: 'tfidf'
      });

      // When: filterByQuery를 호출하면
      const filtered = await service.filterByQuery(query, results, provider);

      // Then: 필터링된 결과가 반환되어야 함
      expect(filtered).toBeDefined();
      expect(Array.isArray(filtered)).toBe(true);
      expect(filtered.length).toBeLessThanOrEqual(results.length);
    });

    it('빈 결과 배열은 그대로 반환해야 함', async () => {
      // Given: 빈 결과 배열이 주어졌을 때
      const query = 'test query';
      const results: any[] = [];
      const provider = 'test-provider';

      // When: filterByQuery를 호출하면
      const filtered = await service.filterByQuery(query, results, provider);

      // Then: 빈 배열이 반환되어야 함
      expect(filtered).toEqual([]);
    });

    it('쿼리 임베딩 생성 실패 시 원본 결과를 반환해야 함', async () => {
      // Given: 쿼리 임베딩 생성이 실패하는 경우
      const query = 'test query';
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
      const provider = 'test-provider';

      // Mock 임베딩 서비스 (실패)
      const { UnifiedEmbeddingService } = await import('../../../embedding/services/unified-embedding-service.js');
      vi.spyOn(UnifiedEmbeddingService.prototype, 'generateEmbedding').mockResolvedValue({
        embedding: undefined as any,
        provider: 'tfidf',
        dimensions: 384,
        model: 'tfidf'
      });

      // When: filterByQuery를 호출하면
      const filtered = await service.filterByQuery(query, results, provider);

      // Then: 원본 결과가 반환되어야 함
      expect(filtered).toEqual(results);
    });

    it('쿼리 유사도가 임계값 이상인 결과만 반환해야 함', async () => {
      // Given: 쿼리 유사도가 다른 결과들이 있을 때
      const query = 'test query';
      const results = [
        {
          memory_id: 'memory-1',
          content: 'test query related',
          type: 'episodic',
          similarity: 0.8,
          hop_distance: 1,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          memory_id: 'memory-2',
          content: 'unrelated',
          type: 'episodic',
          similarity: 0.3,
          hop_distance: 2,
          importance: 0.5,
          created_at: '2024-01-02T00:00:00Z'
        }
      ];
      const provider = 'test-provider';

      // Mock 임베딩 서비스
      const { UnifiedEmbeddingService } = await import('../../../embedding/services/unified-embedding-service.js');
      const mockQueryEmbedding = Array(384).fill(0.15);
      vi.spyOn(UnifiedEmbeddingService.prototype, 'generateEmbedding').mockResolvedValue({
        embedding: mockQueryEmbedding,
        provider: 'tfidf',
        dimensions: 384,
        model: 'tfidf'
      });

      // Mock 캐시 서비스 (첫 번째는 높은 유사도, 두 번째는 낮은 유사도)
      vi.spyOn(cacheService, 'getAnchorEmbedding')
        .mockResolvedValueOnce({
          embedding: Array(384).fill(0.14), // 높은 유사도
          provider: 'tfidf'
        })
        .mockResolvedValueOnce({
          embedding: Array(384).fill(0.01), // 낮은 유사도
          provider: 'tfidf'
        });

      // When: filterByQuery를 호출하면
      const filtered = await service.filterByQuery(query, results, provider);

      // Then: 쿼리 유사도가 임계값 이상이거나 combined_similarity가 0.5 이상인 결과만 반환되어야 함
      expect(filtered.length).toBeGreaterThanOrEqual(0);
      expect(filtered.every(r => 
        (r as any).query_similarity >= 0.3 || (r as any).combined_similarity >= 0.5
      )).toBe(true);
    });

    it('결합 유사도 기준으로 정렬해야 함', async () => {
      // Given: 여러 결과가 있을 때
      const query = 'test query';
      const results = [
        {
          memory_id: 'memory-1',
          content: 'test query',
          type: 'episodic',
          similarity: 0.6,
          hop_distance: 2,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          memory_id: 'memory-2',
          content: 'test query',
          type: 'episodic',
          similarity: 0.8,
          hop_distance: 1,
          importance: 0.7,
          created_at: '2024-01-02T00:00:00Z'
        }
      ];
      const provider = 'test-provider';

      // Mock 임베딩 서비스
      const { UnifiedEmbeddingService } = await import('../../../embedding/services/unified-embedding-service.js');
      const mockQueryEmbedding = Array(384).fill(0.15);
      vi.spyOn(UnifiedEmbeddingService.prototype, 'generateEmbedding').mockResolvedValue({
        embedding: mockQueryEmbedding,
        provider: 'tfidf',
        dimensions: 384,
        model: 'tfidf'
      });

      // Mock 캐시 서비스
      vi.spyOn(cacheService, 'getAnchorEmbedding').mockResolvedValue({
        embedding: Array(384).fill(0.14),
        provider: 'tfidf'
      });

      // When: filterByQuery를 호출하면
      const filtered = await service.filterByQuery(query, results, provider);

      // Then: 결합 유사도 기준으로 내림차순 정렬되어야 함
      if (filtered.length > 1) {
        for (let i = 0; i < filtered.length - 1; i++) {
          expect(filtered[i].similarity).toBeGreaterThanOrEqual(filtered[i + 1].similarity);
        }
      }
    });
  });
});


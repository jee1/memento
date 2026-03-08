/**
 * 쿼리 필터 전략 테스트
 * Phase 3.5: searchLocal 메서드 분리 - TDD RED 단계
 * 
 * Given/When/Then 형식의 테스트 작성
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { QueryFilterStrategy } from './query-filter-strategy.js';
import { QueryFilterService } from './query-filter-service.js';
import { AnchorCacheService } from './anchor-cache-service.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';

describe('QueryFilterStrategy', () => {
  let strategy: QueryFilterStrategy;
  let queryFilterService: QueryFilterService;
  let cacheService: AnchorCacheService;
  let db: Database.Database;

  beforeEach(async () => {
    // Given: 테스트 데이터베이스 및 서비스 초기화
    db = await setupTestDatabase();
    cacheService = new AnchorCacheService();
    cacheService.setDatabase(db);
    
    queryFilterService = new QueryFilterService(cacheService);
    strategy = new QueryFilterStrategy(queryFilterService);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('filter', () => {
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

      // Mock 필터 서비스
      vi.spyOn(queryFilterService, 'filterByQuery').mockResolvedValue([
        results[0] // 첫 번째 결과만 필터링됨
      ]);

      // When: filter를 호출하면
      const result = await strategy.filter(query, results, provider);

      // Then: 필터링된 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(queryFilterService.filterByQuery).toHaveBeenCalledWith(
        query,
        results,
        provider
      );
    });

    it('전략 이름을 반환해야 함', () => {
      // Given: QueryFilterStrategy 인스턴스가 있을 때
      // When: name 속성을 조회하면
      // Then: 'QueryFilterStrategy'가 반환되어야 함
      expect(strategy.name).toBe('QueryFilterStrategy');
    });

    it('execute 메서드가 filter를 호출해야 함', async () => {
      // Given: 검색 결과와 쿼리가 주어졌을 때
      const query = 'test query';
      const results: any[] = [];
      const provider = 'test-provider';

      vi.spyOn(queryFilterService, 'filterByQuery').mockResolvedValue([]);

      // When: execute를 호출하면
      const result = await strategy.execute(query, results, provider);

      // Then: filter 메서드가 호출되어야 함
      expect(queryFilterService.filterByQuery).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });
});


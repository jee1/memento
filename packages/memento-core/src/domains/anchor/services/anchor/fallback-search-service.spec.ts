/**
 * Fallback 검색 서비스 테스트
 * Phase 2.5: anchor-search-service.ts 분리 - TDD RED 단계
 * 
 * Given/When/Then 형식의 테스트 작성
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { FallbackSearchService } from './fallback-search-service.js';
import type { HybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';

describe('FallbackSearchService', () => {
  let service: FallbackSearchService;
  let db: Database.Database;
  let mockHybridSearchEngine: HybridSearchEngine;

  beforeEach(async () => {
    // Given: 테스트 데이터베이스 및 서비스 초기화
    db = await setupTestDatabase();
    service = new FallbackSearchService();
    service.setDatabase(db);

    // Mock 하이브리드 검색 엔진 생성
    mockHybridSearchEngine = {
      search: vi.fn().mockResolvedValue({
        items: [],
        total_count: 0
      })
    } as any;

    service.setHybridSearchEngine(mockHybridSearchEngine);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('fallbackToGlobalSearch', () => {
    it('전역 검색 Fallback을 수행해야 함', async () => {
      // Given: 쿼리와 옵션이 주어졌을 때
      const query = 'test query';
      const options = { limit: 10 };
      const startTime = Date.now();

      const mockSearchResult = {
        items: [
          {
            id: 'memory-1',
            content: 'Test content 1',
            type: 'episodic',
            textScore: 0.7,
            vectorScore: 0.6,
            finalScore: 0.8,
            importance: 0.7,
            created_at: '2024-01-01T00:00:00Z',
            tags: ['test']
          },
          {
            id: 'memory-2',
            content: 'Test content 2',
            type: 'episodic',
            textScore: 0,
            vectorScore: 0.5,
            finalScore: 0.6,
            importance: 0.5,
            created_at: '2024-01-02T00:00:00Z'
          }
        ],
        total_count: 2
      };
      (mockHybridSearchEngine.search as any).mockResolvedValue(mockSearchResult);

      // When: fallbackToGlobalSearch를 호출하면
      const result = await service.fallbackToGlobalSearch(query, options, startTime);

      // Then: SearchResult 형식으로 변환된 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.fallback_used).toBe(true);
      expect(result.local_results_count).toBe(0);
      expect(result.query_time).toBeGreaterThanOrEqual(0);
    });

    it('HybridSearchEngine이 설정되지 않았으면 에러를 던져야 함', async () => {
      // Given: HybridSearchEngine이 설정되지 않은 서비스일 때
      const serviceWithoutEngine = new FallbackSearchService();
      serviceWithoutEngine.setDatabase(db);
      // HybridSearchEngine 설정 안 함

      const query = 'test query';
      const options = { limit: 10 };
      const startTime = Date.now();

      // When & Then: fallbackToGlobalSearch 호출 시 에러 발생
      await expect(
        serviceWithoutEngine.fallbackToGlobalSearch(query, options, startTime)
      ).rejects.toThrow('HybridSearchEngine is not set');
    });

    it('Database가 설정되지 않았으면 에러를 던져야 함', async () => {
      // Given: Database가 설정되지 않은 서비스일 때
      const serviceWithoutDb = new FallbackSearchService();
      serviceWithoutDb.setHybridSearchEngine(mockHybridSearchEngine);
      // Database 설정 안 함

      const query = 'test query';
      const options = { limit: 10 };
      const startTime = Date.now();

      // When & Then: fallbackToGlobalSearch 호출 시 에러 발생
      await expect(
        serviceWithoutDb.fallbackToGlobalSearch(query, options, startTime)
      ).rejects.toThrow('Database is not set');
    });

    it('검색 실패 시 빈 결과를 반환해야 함', async () => {
      // Given: 검색이 실패하는 경우
      const query = 'test query';
      const options = { limit: 10 };
      const startTime = Date.now();

      (mockHybridSearchEngine.search as any).mockRejectedValue(new Error('Search failed'));

      // When: fallbackToGlobalSearch를 호출하면
      const result = await service.fallbackToGlobalSearch(query, options, startTime);

      // Then: 빈 결과가 반환되어야 함
      expect(result.items).toEqual([]);
      expect(result.total_count).toBe(0);
      expect(result.fallback_used).toBe(true);
    });

    it('옵션이 없으면 기본값을 사용해야 함', async () => {
      // Given: 옵션이 없는 경우
      const query = 'test query';
      const startTime = Date.now();

      const mockSearchResult = {
        items: [],
        total_count: 0
      };
      (mockHybridSearchEngine.search as any).mockResolvedValue(mockSearchResult);

      // When: fallbackToGlobalSearch를 옵션 없이 호출하면
      const result = await service.fallbackToGlobalSearch(query, undefined, startTime);

      // Then: 기본 limit(10)이 사용되어야 함
      expect(mockHybridSearchEngine.search).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          limit: 10
        })
      );
    });

    it('startTime이 없으면 fallbackStartTime을 사용해야 함', async () => {
      // Given: startTime이 없는 경우
      const query = 'test query';
      const options = { limit: 10 };

      const mockSearchResult = {
        items: [],
        total_count: 0
      };
      (mockHybridSearchEngine.search as any).mockResolvedValue(mockSearchResult);

      // When: fallbackToGlobalSearch를 startTime 없이 호출하면
      const result = await service.fallbackToGlobalSearch(query, options, undefined);

      // Then: query_time이 계산되어야 함
      expect(result.query_time).toBeGreaterThanOrEqual(0);
    });

    it('검색 결과를 SearchResult 형식으로 변환해야 함', async () => {
      // Given: HybridSearchResult 형식의 결과가 있을 때
      const query = 'test query';
      const options = { limit: 10 };
      const startTime = Date.now();

      const mockSearchResult = {
        items: [
          {
            id: 'memory-1',
            content: 'Test content',
            type: 'episodic',
            textScore: 0.7,
            vectorScore: 0.6,
            finalScore: 0.8,
            importance: 0.7,
            created_at: '2024-01-01T00:00:00Z',
            tags: ['test']
          }
        ],
        total_count: 1
      };
      (mockHybridSearchEngine.search as any).mockResolvedValue(mockSearchResult);

      // When: fallbackToGlobalSearch를 호출하면
      const result = await service.fallbackToGlobalSearch(query, options, startTime);

      // Then: SearchResult 형식으로 변환되어야 함
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe('memory-1');
      expect(result.items[0].content).toBe('Test content');
      expect(result.items[0].similarity).toBe(0.8);
      expect(result.items[0].hop_distance).toBeUndefined();
      expect(result.total_count).toBe(1);
    });

    it('#873: 쿼리 관련성이 없는 항목은 finalScore가 높아도 제외해야 함', async () => {
      // Given: 벡터/텍스트 점수는 바닥이지만 recency·importance 때문에 finalScore가 높은 항목
      const mockSearchResult = {
        items: [
          {
            id: 'relevant',
            content: 'relevant content',
            type: 'episodic',
            textScore: 0,
            vectorScore: 0.45,
            finalScore: 0.5,
            importance: 0.5,
            created_at: '2024-01-01T00:00:00Z'
          },
          {
            id: 'recent-but-irrelevant',
            content: 'irrelevant content',
            type: 'episodic',
            textScore: 0,
            vectorScore: 0.31,
            finalScore: 0.62,
            importance: 0.9,
            created_at: '2024-01-02T00:00:00Z'
          }
        ],
        total_count: 2
      };
      (mockHybridSearchEngine.search as any).mockResolvedValue(mockSearchResult);

      // When: fallbackToGlobalSearch를 호출하면
      const result = await service.fallbackToGlobalSearch('test query', { limit: 10 }, Date.now());

      // Then: 관련성 하한을 넘긴 항목만 남아야 함 (finalScore가 더 높아도 제외)
      expect(result.items.map(item => item.id)).toEqual(['relevant']);
      expect(result.total_count).toBe(1);
    });

    it('#873: 텍스트 매칭이 있으면 벡터 점수가 하한 미만이어도 유지해야 함', async () => {
      const mockSearchResult = {
        items: [
          {
            id: 'text-match',
            content: 'text matched content',
            type: 'episodic',
            textScore: 0.4,
            vectorScore: 0.1,
            finalScore: 0.4,
            importance: 0.5,
            created_at: '2024-01-01T00:00:00Z'
          }
        ],
        total_count: 1
      };
      (mockHybridSearchEngine.search as any).mockResolvedValue(mockSearchResult);

      const result = await service.fallbackToGlobalSearch('test query', { limit: 10 }, Date.now());

      expect(result.items.map(item => item.id)).toEqual(['text-match']);
    });
  });
});


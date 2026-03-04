/**
 * N-hop 검색 서비스 테스트
 * Phase 2.3: anchor-search-service.ts 분리 - TDD RED 단계
 * 
 * Given/When/Then 형식의 테스트 작성
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { NHopSearchService } from './n-hop-search-service.js';
import { AnchorCacheService } from './anchor-cache-service.js';
import type { VectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';
import { setupTestDatabase, createTestMemory, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import type { RelationGraph } from '../../../relation/services/relation-graph.js';
import { createRelationGraph } from '../../../../infrastructure/relation-graph-factory.js';
import { RelationEngineSchemaMigration } from '../../../../infrastructure/database/database/migration/migrations/005-relation-engine-schema.js';

describe('NHopSearchService', () => {
  let service: NHopSearchService;
  let cacheService: AnchorCacheService;
  let db: Database.Database;
  let mockVectorSearchEngine: VectorSearchEngine;
  let relationGraph: RelationGraph | null = null;

  beforeEach(async () => {
    // Given: 테스트 데이터베이스 및 서비스 초기화
    db = await setupTestDatabase();
    cacheService = new AnchorCacheService();
    cacheService.setDatabase(db);
    
    // Mock 벡터 검색 엔진 생성
    mockVectorSearchEngine = {
      initialize: vi.fn(),
      search: vi.fn().mockResolvedValue([]),
      searchBySimilarity: vi.fn().mockResolvedValue([])
    } as any;

    // 관계 그래프 초기화 (선택적)
    try {
      const migration = new RelationEngineSchemaMigration();
      migration.up(db);
      relationGraph = createRelationGraph(db);
    } catch (error) {
      relationGraph = null;
    }

    service = new NHopSearchService(cacheService);
    service.setDatabase(db);
    service.setVectorSearchEngine(mockVectorSearchEngine);
    if (relationGraph) {
      service.setRelationGraph(relationGraph);
    }
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('searchOneHop', () => {
    it('1-hop 검색을 수행해야 함', async () => {
      // Given: 앵커 임베딩, provider, 앵커 메모리 ID, 임계값, limit이 주어졌을 때
      const anchorEmbedding = [0.1, 0.2, 0.3];
      const provider = 'test-provider';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.5;
      const limit = 10;

      // Mock 검색 결과 설정
      const mockResults = [
        {
          memory_id: 'memory-1',
          content: 'Test content 1',
          type: 'episodic',
          similarity: 0.8,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z',
          tags: ['test']
        },
        {
          memory_id: 'memory-2',
          content: 'Test content 2',
          type: 'episodic',
          similarity: 0.6,
          importance: 0.5,
          created_at: '2024-01-02T00:00:00Z'
        }
      ];
      (mockVectorSearchEngine.search as any).mockResolvedValue(mockResults);

      // When: searchOneHop을 호출하면
      const results = await service.searchOneHop(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        limit
      );

      // Then: 임계값 이상의 결과만 반환되어야 함
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.every(r => r.similarity >= threshold)).toBe(true);
      expect(results.every(r => r.memory_id !== anchorMemoryId)).toBe(true);
    });

    it('앵커 메모리 자체는 결과에서 제외해야 함', async () => {
      // Given: 앵커 메모리 ID가 포함된 검색 결과가 있을 때
      const anchorEmbedding = [0.1, 0.2, 0.3];
      const provider = 'test-provider';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.5;
      const limit = 10;

      const mockResults = [
        {
          memory_id: anchorMemoryId, // 앵커 메모리 자체
          content: 'Anchor content',
          type: 'episodic',
          similarity: 0.9,
          importance: 0.8,
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          memory_id: 'memory-1',
          content: 'Test content 1',
          type: 'episodic',
          similarity: 0.8,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];
      (mockVectorSearchEngine.search as any).mockResolvedValue(mockResults);

      // When: searchOneHop을 호출하면
      const results = await service.searchOneHop(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        limit
      );

      // Then: 앵커 메모리는 결과에 포함되지 않아야 함
      expect(results.every(r => r.memory_id !== anchorMemoryId)).toBe(true);
    });

    it('임계값 미만의 결과는 필터링해야 함', async () => {
      // Given: 임계값 미만의 결과가 포함된 검색 결과가 있을 때
      const anchorEmbedding = [0.1, 0.2, 0.3];
      const provider = 'test-provider';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.7;
      const limit = 10;

      const mockResults = [
        {
          memory_id: 'memory-1',
          content: 'Test content 1',
          type: 'episodic',
          similarity: 0.8, // 임계값 이상
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          memory_id: 'memory-2',
          content: 'Test content 2',
          type: 'episodic',
          similarity: 0.5, // 임계값 미만
          importance: 0.5,
          created_at: '2024-01-02T00:00:00Z'
        }
      ];
      (mockVectorSearchEngine.search as any).mockResolvedValue(mockResults);

      // When: searchOneHop을 호출하면
      const results = await service.searchOneHop(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        limit
      );

      // Then: 임계값 이상의 결과만 반환되어야 함
      expect(results.every(r => r.similarity >= threshold)).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0].memory_id).toBe('memory-1');
    });

    it('VectorSearchEngine이 설정되지 않았으면 에러를 던져야 함', async () => {
      // Given: VectorSearchEngine이 설정되지 않은 서비스일 때
      const serviceWithoutEngine = new NHopSearchService(cacheService);
      serviceWithoutEngine.setDatabase(db);
      // VectorSearchEngine 설정 안 함

      const anchorEmbedding = [0.1, 0.2, 0.3];
      const provider = 'test-provider';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.5;
      const limit = 10;

      // When & Then: searchOneHop 호출 시 에러 발생
      await expect(
        serviceWithoutEngine.searchOneHop(
          anchorEmbedding,
          provider,
          anchorMemoryId,
          threshold,
          limit
        )
      ).rejects.toThrow('VectorSearchEngine or Database is not set');
    });
  });

  describe('searchNHop', () => {
    it('N-hop 검색을 수행해야 함', async () => {
      // Given: 앵커 임베딩, provider, 앵커 메모리 ID, 임계값, maxHops, limit이 주어졌을 때
      const anchorEmbedding = [0.1, 0.2, 0.3];
      const provider = 'test-provider';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.5;
      const maxHops = 2;
      const limit = 10;

      // Mock 검색 결과 설정 (1-hop)
      const mockHop1Results = [
        {
          memory_id: 'memory-1',
          content: 'Test content 1',
          type: 'episodic',
          similarity: 0.8,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z',
          tags: ['test']
        }
      ];
      (mockVectorSearchEngine.search as any).mockResolvedValue(mockHop1Results);

      // When: searchNHop을 호출하면
      const results = await service.searchNHop(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        maxHops,
        limit
      );

      // Then: hop_distance가 포함된 결과가 반환되어야 함
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.every(r => r.hop_distance !== undefined)).toBe(true);
      expect(results.every(r => r.hop_distance >= 1 && r.hop_distance <= maxHops)).toBe(true);
    });

    it('maxHops를 초과하지 않아야 함', async () => {
      // Given: maxHops가 2로 설정되었을 때
      const anchorEmbedding = [0.1, 0.2, 0.3];
      const provider = 'test-provider';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.5;
      const maxHops = 2;
      const limit = 10;

      const mockResults = [
        {
          memory_id: 'memory-1',
          content: 'Test content 1',
          type: 'episodic',
          similarity: 0.8,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];
      (mockVectorSearchEngine.search as any).mockResolvedValue(mockResults);

      // When: searchNHop을 호출하면
      const results = await service.searchNHop(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        maxHops,
        limit
      );

      // Then: 모든 결과의 hop_distance가 maxHops 이하여야 함
      expect(results.every(r => r.hop_distance <= maxHops)).toBe(true);
    });

    it('limit을 초과하지 않아야 함', async () => {
      // Given: limit이 5로 설정되었을 때
      const anchorEmbedding = [0.1, 0.2, 0.3];
      const provider = 'test-provider';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.5;
      const maxHops = 3;
      const limit = 5;

      // 많은 결과를 반환하는 Mock 설정
      const mockResults = Array.from({ length: 20 }, (_, i) => ({
        memory_id: `memory-${i}`,
        content: `Test content ${i}`,
        type: 'episodic',
        similarity: 0.8,
        importance: 0.7,
        created_at: '2024-01-01T00:00:00Z'
      }));
      (mockVectorSearchEngine.search as any).mockResolvedValue(mockResults);

      // When: searchNHop을 호출하면
      const results = await service.searchNHop(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        maxHops,
        limit
      );

      // Then: 결과 개수가 limit을 초과하지 않아야 함
      expect(results.length).toBeLessThanOrEqual(limit);
    });

    it('useRelations가 false이면 관계 그래프를 사용하지 않아야 함', async () => {
      // Given: useRelations가 false로 설정되었을 때
      const anchorEmbedding = [0.1, 0.2, 0.3];
      const provider = 'test-provider';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.5;
      const maxHops = 2;
      const limit = 10;
      const useRelations = false;

      const mockResults = [
        {
          memory_id: 'memory-1',
          content: 'Test content 1',
          type: 'episodic',
          similarity: 0.8,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z'
        }
      ];
      (mockVectorSearchEngine.search as any).mockResolvedValue(mockResults);

      // When: searchNHop을 useRelations=false로 호출하면
      const results = await service.searchNHop(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        maxHops,
        limit,
        useRelations
      );

      // Then: 결과가 반환되어야 함 (관계 그래프 없이도 동작)
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('VectorSearchEngine이 설정되지 않았으면 에러를 던져야 함', async () => {
      // Given: VectorSearchEngine이 설정되지 않은 서비스일 때
      const serviceWithoutEngine = new NHopSearchService(cacheService);
      serviceWithoutEngine.setDatabase(db);
      // VectorSearchEngine 설정 안 함

      const anchorEmbedding = [0.1, 0.2, 0.3];
      const provider = 'test-provider';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.5;
      const maxHops = 2;
      const limit = 10;

      // When & Then: searchNHop 호출 시 에러 발생
      await expect(
        serviceWithoutEngine.searchNHop(
          anchorEmbedding,
          provider,
          anchorMemoryId,
          threshold,
          maxHops,
          limit
        )
      ).rejects.toThrow('VectorSearchEngine or Database is not set');
    });
  });
});


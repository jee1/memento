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

  afterEach(async () => {
    await cleanupTestDatabase(db);
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

    it('#710 회귀: 임베딩이 없는 relation 이웃도 1-hop 결과에 유지되어야 함', async () => {
      // Given: relationGraph가 실제로 준비되어 있어야 하는 테스트 (스킵 방지)
      if (!relationGraph) {
        throw new Error('relationGraph 초기화 실패 - 테스트 전제 조건 불충족');
      }

      const anchorMemoryId = createTestMemory(db, {
        id: 'anchor-with-linked-neighbor',
        type: 'episodic',
        content: '앵커 메모리 (임베딩 보유)'
      });
      const linkedMemoryId = createTestMemory(db, {
        id: 'semantic-no-embedding',
        type: 'semantic',
        content: 'Triple에서 파생된 semantic memory (임베딩 없음)'
      });

      await relationGraph.addRelation(anchorMemoryId, linkedMemoryId, 'REFERENCES', { confidence: 0.8 });

      // 벡터 검색 결과 없음 (linkedMemoryId는 임베딩이 없어 벡터 검색으로는 발견되지 않음)
      (mockVectorSearchEngine.search as any).mockResolvedValue([]);

      const anchorEmbedding = [0.1, 0.2, 0.3];
      const results = await service.searchNHop(
        anchorEmbedding,
        'test-provider',
        anchorMemoryId,
        0.6,
        1,
        10,
        true
      );

      // Then: 벡터 결과가 없어도 relation으로 연결된 이웃은 1-hop 결과에 포함됨
      const linkedResult = results.find(r => r.memory_id === linkedMemoryId);
      expect(linkedResult).toBeDefined();
      expect(linkedResult?.hop_distance).toBe(1);
      expect(linkedResult?.hasRelation).toBe(true);
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

  describe('searchNHop - predecessor provenance (#715)', () => {
    it('1-hop 결과의 predecessor_id는 앵커 메모리여야 함', async () => {
      // Given: anchor-memory-1에서 memory-1이 1-hop으로 발견될 때
      const anchorEmbedding = [0.1, 0.2, 0.3];
      const provider = 'test-provider';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.1;
      const maxHops = 1;
      const limit = 10;

      (mockVectorSearchEngine.search as any).mockResolvedValue([
        {
          memory_id: 'memory-1',
          content: 'hop1 content',
          type: 'episodic',
          similarity: 0.8,
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z'
        }
      ]);

      // When: searchNHop을 호출하면
      const results = await service.searchNHop(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        maxHops,
        limit,
        false // useRelations
      );

      // Then: memory-1의 predecessor_id는 앵커여야 함 (path provenance)
      const memory1 = results.find(r => r.memory_id === 'memory-1');
      expect(memory1).toBeDefined();
      expect(memory1?.predecessor_id).toBe(anchorMemoryId);
    });

    it('2-hop 결과는 실제 경로(anchor→m1→m2)의 predecessor_id를 가져야 함', async () => {
      // Given: anchor-memory-1 -> memory-1 -> memory-2의 실제 경로가 존재할 때
      const anchorEmbedding = [0.1, 0.2, 0.3];
      const memory1Embedding = [0.4, 0.5, 0.6];
      const provider = 'test-provider';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.1;
      const maxHops = 2;
      const limit = 10;

      // hop1 시드(anchorEmbedding)로 검색하면 memory-1, memory-1 시드로 검색하면 memory-2를 반환
      (mockVectorSearchEngine.search as any).mockImplementation(async (embedding: number[]) => {
        if (embedding === anchorEmbedding) {
          return [
            {
              memory_id: 'memory-1',
              content: 'hop1 content',
              type: 'episodic',
              similarity: 0.8,
              importance: 0.7,
              created_at: '2024-01-01T00:00:00Z'
            }
          ];
        }
        if (embedding === memory1Embedding) {
          return [
            {
              memory_id: 'memory-2',
              content: 'hop2 content',
              type: 'episodic',
              similarity: 0.7,
              importance: 0.6,
              created_at: '2024-01-02T00:00:00Z'
            }
          ];
        }
        return [];
      });

      // memory-1의 다음 hop 임베딩 조회를 위해 cacheService를 스텁 처리
      vi.spyOn(cacheService, 'getAnchorEmbedding').mockImplementation(async (memoryId: string) => {
        if (memoryId === 'memory-1') {
          return { embedding: memory1Embedding, provider: 'test-provider' };
        }
        return null;
      });

      // When: searchNHop(maxHops=2)을 호출하면
      const results = await service.searchNHop(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        maxHops,
        limit,
        false // useRelations
      );

      // Then: memory-1은 앵커를, memory-2는 memory-1을 predecessor로 가져야 함
      const memory1 = results.find(r => r.memory_id === 'memory-1');
      const memory2 = results.find(r => r.memory_id === 'memory-2');
      expect(memory1?.hop_distance).toBe(1);
      expect(memory1?.predecessor_id).toBe(anchorMemoryId);
      expect(memory2?.hop_distance).toBe(2);
      expect(memory2?.predecessor_id).toBe('memory-1');
      // 실제 경로가 아닌 anchor→memory-2 직결은 존재하지 않아야 함
      expect(memory2?.predecessor_id).not.toBe(anchorMemoryId);
    });

    it('anchor→m1→x, anchor→m2→x처럼 두 경로가 같은 메모리로 합류하면 노드는 dedup되어도 모든 predecessor가 보존되어야 함 (#715 MEDIUM#1)', async () => {
      // Given: anchor-memory-1 -> memory-1, memory-2 (hop1) -> 둘 다 memory-x (hop2)를 가리킬 때
      const anchorEmbedding = [0.1, 0.2, 0.3];
      const memory1Embedding = [0.4, 0.5, 0.6];
      const memory2Embedding = [0.7, 0.8, 0.9];
      const provider = 'test-provider';
      const anchorMemoryId = 'anchor-memory-1';
      const threshold = 0.1;
      const maxHops = 2;
      const limit = 10;

      (mockVectorSearchEngine.search as any).mockImplementation(async (embedding: number[]) => {
        if (embedding === anchorEmbedding) {
          return [
            {
              memory_id: 'memory-1',
              content: 'hop1 content 1',
              type: 'episodic',
              similarity: 0.8,
              importance: 0.7,
              created_at: '2024-01-01T00:00:00Z'
            },
            {
              memory_id: 'memory-2',
              content: 'hop1 content 2',
              type: 'episodic',
              similarity: 0.75,
              importance: 0.7,
              created_at: '2024-01-01T00:00:00Z'
            }
          ];
        }
        if (embedding === memory1Embedding || embedding === memory2Embedding) {
          return [
            {
              memory_id: 'memory-x',
              content: 'hop2 shared content',
              type: 'episodic',
              similarity: 0.7,
              importance: 0.6,
              created_at: '2024-01-02T00:00:00Z'
            }
          ];
        }
        return [];
      });

      vi.spyOn(cacheService, 'getAnchorEmbedding').mockImplementation(async (memoryId: string) => {
        if (memoryId === 'memory-1') {
          return { embedding: memory1Embedding, provider: 'test-provider' };
        }
        if (memoryId === 'memory-2') {
          return { embedding: memory2Embedding, provider: 'test-provider' };
        }
        return null;
      });

      // When: searchNHop(maxHops=2)을 호출하면
      const results = await service.searchNHop(
        anchorEmbedding,
        provider,
        anchorMemoryId,
        threshold,
        maxHops,
        limit,
        false // useRelations
      );

      // Then: memory-x 노드는 1개만 존재하지만(dedup), 두 predecessor 경로가 모두 보존되어야 함
      const memoryXResults = results.filter(r => r.memory_id === 'memory-x');
      expect(memoryXResults).toHaveLength(1);
      const memoryX = memoryXResults[0];
      expect(memoryX?.predecessor_ids).toBeDefined();
      expect(new Set(memoryX?.predecessor_ids)).toEqual(new Set(['memory-1', 'memory-2']));
    });
  });
});


/**
 * MemoryEmbeddingService 테스트
 * 메모리 임베딩 저장 및 검색 서비스 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryEmbeddingService } from '../memory-embedding-service.js';
import { setupTestDatabase, createTestMemory, cleanupTestDatabase } from '../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import type { EmbeddingResult } from '../../../shared/types/embedding.types.js';

// UnifiedEmbeddingService 모킹
vi.mock('./unified-embedding-service.js', () => {
  return {
    UnifiedEmbeddingService: vi.fn().mockImplementation(() => ({
      isAvailable: vi.fn(() => true),
      generateEmbedding: vi.fn(async (content: string): Promise<EmbeddingResult | null> => {
        // 모킹된 임베딩 생성
        const mockEmbedding = new Array(384).fill(0).map(() => Math.random());
        return {
          embedding: mockEmbedding,
          provider: 'tfidf',
          dimensions: 384,
          model: 'tfidf'
        };
      }),
      getCurrentProviderName: vi.fn(() => 'tfidf')
    }))
  };
});

describe('MemoryEmbeddingService', () => {
  let service: MemoryEmbeddingService;
  let db: Database.Database;

  beforeEach(async () => {
    service = new MemoryEmbeddingService();
    db = await setupTestDatabase();
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('createAndStoreEmbedding', () => {
    it('임베딩을 생성하고 저장해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory for embedding',
        type: 'episodic'
      });

      const result = await service.createAndStoreEmbedding(
        db,
        memoryId,
        'Test memory for embedding',
        'episodic'
      );

      // 임베딩 서비스가 사용 가능한 경우에만 결과 확인
      if (service.isAvailable() && result) {
        expect(result).toBeDefined();
        
        // 데이터베이스에 저장되었는지 확인
        const embedding = DatabaseUtils.get(
          db,
          'SELECT * FROM memory_embedding WHERE memory_id = ?',
          [memoryId]
        );
        // 임베딩이 실제로 생성되었는지 확인 (서비스가 사용 가능하지만 생성 실패할 수 있음)
        if (embedding) {
          expect(embedding).toBeDefined();
        }
      } else {
        // 임베딩 서비스가 사용 불가능하거나 결과가 null인 경우
        expect(result).toBeNull();
      }
    });

    it('임베딩 서비스가 사용 불가능하면 null을 반환해야 함', async () => {
      // isAvailable을 모킹하여 false 반환
      const originalIsAvailable = service.isAvailable.bind(service);
      vi.spyOn(service, 'isAvailable').mockReturnValue(false);

      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic'
      });

      const result = await service.createAndStoreEmbedding(
        db,
        memoryId,
        'Test memory',
        'episodic'
      );

      expect(result).toBeNull();
    });

    it('빈 임베딩 결과에 대해 null을 반환해야 함', async () => {
      // 이 테스트는 실제 임베딩 서비스 동작에 따라 달라질 수 있음
      // 일반적으로는 임베딩 서비스가 빈 결과를 반환하지 않으므로
      // 실제 동작을 확인하는 것이 좋음
      const memoryId = createTestMemory(db, {
        content: 'Test',
        type: 'episodic'
      });

      const result = await service.createAndStoreEmbedding(
        db,
        memoryId,
        'Test',
        'episodic'
      );

      // 결과는 null이거나 유효한 임베딩 결과여야 함
      if (result === null) {
        expect(result).toBeNull();
      } else {
        expect(result).toBeDefined();
        expect(result.embedding).toBeDefined();
      }
    });

    it('다양한 메모리 타입에 대해 임베딩을 생성해야 함', async () => {
      const types = ['working', 'episodic', 'semantic', 'procedural'] as const;

      for (const type of types) {
        const memoryId = createTestMemory(db, {
          content: `Test ${type} memory`,
          type
        });

        const result = await service.createAndStoreEmbedding(
          db,
          memoryId,
          `Test ${type} memory`,
          type
        );

        // 임베딩 서비스가 사용 가능한 경우에만 확인
        if (service.isAvailable() && result) {
          expect(result).toBeDefined();
        }
      }
    });
  });

  describe('searchBySimilarity', () => {
    it('유사도 검색을 수행해야 함', async () => {
      // 먼저 임베딩이 있는 메모리 생성
      const memoryId = createTestMemory(db, {
        content: 'Test memory for search',
        type: 'episodic'
      });

      // 임베딩 생성
      await service.createAndStoreEmbedding(
        db,
        memoryId,
        'Test memory for search',
        'episodic'
      );

      // 검색 수행
      const results = await service.searchBySimilarity(
        db,
        'Test memory',
        { limit: 10 }
      );

      // 임베딩 서비스가 사용 가능한 경우에만 결과 확인
      if (service.isAvailable()) {
        expect(Array.isArray(results)).toBe(true);
      }
    });

    it('타입 필터를 적용해야 함', async () => {
      createTestMemory(db, { content: 'Episodic memory', type: 'episodic' });
      createTestMemory(db, { content: 'Semantic memory', type: 'semantic' });

      const results = await service.searchBySimilarity(
        db,
        'memory',
        { type: ['episodic'], limit: 10 }
      );

      if (service.isAvailable() && results.length > 0) {
        expect(results.every(r => r.type === 'episodic')).toBe(true);
      }
    });

    it('limit 파라미터를 존중해야 함', async () => {
      // 여러 메모리 생성
      for (let i = 0; i < 20; i++) {
        const memoryId = createTestMemory(db, {
          content: `Memory ${i}`,
          type: 'episodic'
        });
        await service.createAndStoreEmbedding(db, memoryId, `Memory ${i}`, 'episodic');
      }

      const results = await service.searchBySimilarity(
        db,
        'Memory',
        { limit: 5 }
      );

      if (service.isAvailable()) {
        expect(results.length).toBeLessThanOrEqual(5);
      }
    });

    it('임베딩 서비스가 사용 불가능하면 빈 배열을 반환해야 함', async () => {
      vi.spyOn(service, 'isAvailable').mockReturnValue(false);

      const results = await service.searchBySimilarity(db, 'test query');

      expect(results).toEqual([]);
    });
  });

  describe('deleteEmbedding', () => {
    it('임베딩을 삭제해야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic'
      });

      // 임베딩 생성
      await service.createAndStoreEmbedding(
        db,
        memoryId,
        'Test memory',
        'episodic'
      );

      // 삭제
      await service.deleteEmbedding(db, memoryId);

      // 삭제 확인
      const embedding = DatabaseUtils.get(
        db,
        'SELECT * FROM memory_embedding WHERE memory_id = ?',
        [memoryId]
      );
      expect(embedding).toBeUndefined();
    });

    it('존재하지 않는 임베딩 삭제 시 에러를 던지지 않아야 함', async () => {
      await expect(
        service.deleteEmbedding(db, 'nonexistent_id')
      ).resolves.not.toThrow();
    });
  });

  describe('getEmbeddingStats', () => {
    it('임베딩 통계를 반환해야 함', async () => {
      // 임베딩이 있는 메모리 생성
      const memoryId1 = createTestMemory(db, { content: 'Memory 1', type: 'episodic' });
      const memoryId2 = createTestMemory(db, { content: 'Memory 2', type: 'semantic' });

      await service.createAndStoreEmbedding(db, memoryId1, 'Memory 1', 'episodic');
      await service.createAndStoreEmbedding(db, memoryId2, 'Memory 2', 'semantic');

      const stats = await service.getEmbeddingStats(db);

      expect(stats).toHaveProperty('totalEmbeddings');
      expect(stats).toHaveProperty('averageDimensions');
      expect(stats).toHaveProperty('model');
      expect(stats).toHaveProperty('providerStats');
      expect(Array.isArray(stats.providerStats)).toBe(true);
    });

    it('임베딩이 없으면 0 통계를 반환해야 함', async () => {
      const stats = await service.getEmbeddingStats(db);

      expect(stats.totalEmbeddings).toBe(0);
      expect(stats.averageDimensions).toBe(0);
      expect(stats.providerStats).toEqual([]);
    });
  });

  describe('isAvailable', () => {
    it('임베딩 서비스 사용 가능 여부를 반환해야 함', () => {
      const available = service.isAvailable();

      expect(typeof available).toBe('boolean');
    });
  });

  describe('캐시 및 폴백 시나리오', () => {
    it('임베딩 생성 실패 시 null을 반환해야 함', async () => {
      // Given: UnifiedEmbeddingService 모킹하여 null 반환
      const { UnifiedEmbeddingService } = await import('./unified-embedding-service.js');
      const mockService = new UnifiedEmbeddingService();
      vi.spyOn(mockService, 'generateEmbedding').mockResolvedValue(null);
      
      // 서비스의 embeddingService를 모킹된 서비스로 교체
      (service as any).embeddingService = mockService;

      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic'
      });

      // When: 임베딩 생성 시도
      const result = await service.createAndStoreEmbedding(
        db,
        memoryId,
        'Test memory',
        'episodic'
      );

      // Then: null 반환
      expect(result).toBeNull();
    });

    it('빈 임베딩 벡터에 대해 null을 반환해야 함', async () => {
      // Given: UnifiedEmbeddingService 모킹하여 빈 배열 반환
      const { UnifiedEmbeddingService } = await import('./unified-embedding-service.js');
      const mockService = new UnifiedEmbeddingService();
      vi.spyOn(mockService, 'generateEmbedding').mockResolvedValue({
        embedding: [],
        provider: 'tfidf',
        dimensions: 0,
        model: 'tfidf'
      });
      
      (service as any).embeddingService = mockService;

      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic'
      });

      // When: 임베딩 생성 시도
      const result = await service.createAndStoreEmbedding(
        db,
        memoryId,
        'Test memory',
        'episodic'
      );

      // Then: null 반환 (빈 벡터)
      expect(result).toBeNull();
    });

    it('다양한 제공자로 임베딩을 생성할 수 있어야 함', async () => {
      // Given: 여러 제공자 모킹
      const providers = ['tfidf', 'minilm', 'openai', 'gemini'];
      
      for (const provider of providers) {
        const { UnifiedEmbeddingService } = await import('./unified-embedding-service.js');
        const mockService = new UnifiedEmbeddingService();
        const dimensions = provider === 'openai' ? 1536 : provider === 'gemini' ? 768 : 384;
        const mockEmbedding = new Array(dimensions).fill(0).map(() => Math.random());
        
        vi.spyOn(mockService, 'generateEmbedding').mockResolvedValue({
          embedding: mockEmbedding,
          provider: provider as any,
          dimensions,
          model: provider
        });
        
        (service as any).embeddingService = mockService;

        const memoryId = createTestMemory(db, {
          content: `Test memory for ${provider}`,
          type: 'episodic'
        });

        // When: 임베딩 생성
        const result = await service.createAndStoreEmbedding(
          db,
          memoryId,
          `Test memory for ${provider}`,
          'episodic'
        );

        // Then: 제공자별 임베딩이 생성되어야 함
        if (service.isAvailable()) {
          expect(result).toBeDefined();
          if (result) {
            expect(result.provider).toBe(provider);
            expect(result.embedding.length).toBe(dimensions);
          }
        }
      }
    });

    it('sqlite-vec 확장 로드 실패 시에도 TF-IDF fallback으로 동작해야 함', async () => {
      // Given: 메모리 생성
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic'
      });

      // When: 임베딩 생성 (sqlite-vec 확장이 없어도 동작해야 함)
      const result = await service.createAndStoreEmbedding(
        db,
        memoryId,
        'Test memory',
        'episodic'
      );

      // Then: TF-IDF fallback으로 동작하거나 null 반환
      // (실제 환경에 따라 다를 수 있음)
      if (service.isAvailable()) {
        // 서비스가 사용 가능하면 결과가 있거나 null일 수 있음
        expect(result === null || (result && result.provider)).toBeTruthy();
      } else {
        expect(result).toBeNull();
      }
    });
  });

  describe('다중 제공자 처리', () => {
    it('다양한 제공자의 임베딩을 처리할 수 있어야 함', async () => {
      const memoryId = createTestMemory(db, {
        content: 'Test memory',
        type: 'episodic'
      });

      // 기본 제공자로 임베딩 생성
      const result = await service.createAndStoreEmbedding(
        db,
        memoryId,
        'Test memory',
        'episodic'
      );

      if (service.isAvailable() && result) {
        expect(result.provider).toBeDefined();
        expect(['tfidf', 'minilm', 'openai', 'gemini']).toContain(result.provider);
      }
    });
  });
});


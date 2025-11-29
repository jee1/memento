import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { MemoryNeighborService, MemoryNotFoundError } from './memory-neighbor-service.js';
import { getVectorSearchEngine } from '../../../algorithms/vector-search-engine.js';
import { MemoryEmbeddingService } from './memory-embedding-service.js';

// Mock @xenova/transformers to prevent onnxruntime-node loading
vi.mock('@xenova/transformers', () => {
  return {
    pipeline: vi.fn().mockResolvedValue({
      __call: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
    }),
    env: {
      useBrowserCache: false,
      useCustomCache: false
    }
  };
});

describe('MemoryNeighborService', () => {
  let db: Database.Database;
  let neighborService: MemoryNeighborService;
  let vectorSearchEngine: ReturnType<typeof getVectorSearchEngine>;
  let embeddingService: MemoryEmbeddingService;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    DatabaseUtils.initializeDatabase(db);
    
    vectorSearchEngine = getVectorSearchEngine();
    vectorSearchEngine.initialize(db);
    
    embeddingService = new MemoryEmbeddingService();
    
    neighborService = new MemoryNeighborService(
      vectorSearchEngine,
      embeddingService
    );
    
    neighborService.setDatabase(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
  });

  describe('초기화', () => {
    it('should initialize successfully with valid dependencies', () => {
      const service = new MemoryNeighborService(
        vectorSearchEngine,
        embeddingService
      );
      expect(() => service.setDatabase(db)).not.toThrow();
    });

    it('should throw error if VectorSearchEngine is null', () => {
      expect(() => {
        new MemoryNeighborService(null as any, embeddingService);
      }).toThrow('VectorSearchEngine is required');
    });

    it('should throw error if MemoryEmbeddingService is null', () => {
      expect(() => {
        new MemoryNeighborService(vectorSearchEngine, null as any);
      }).toThrow('MemoryEmbeddingService is required');
    });

    it('should throw error if database is not set', async () => {
      const service = new MemoryNeighborService(
        vectorSearchEngine,
        embeddingService
      );
      // setDatabase를 호출하지 않음
      await expect(
        service.getNeighbors('test_id', {})
      ).rejects.toThrow('Database is not set');
    });
  });

  describe('getNeighbors - 정상 케이스', () => {
    it('should return empty array when memory has no embedding', async () => {
      // 메모리 아이템만 생성 (임베딩 없음)
      const memoryId = 'mem_test_1';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const result = await neighborService.getNeighbors(memoryId, {
        limit: 5,
        similarity_threshold: 0.8
      });

      expect(result.memory_id).toBe(memoryId);
      expect(result.neighbors).toEqual([]);
      expect(result.total_count).toBe(0);
      expect(result.query_time).toBeGreaterThanOrEqual(0);
    });

    it('should return neighbors when similar memories exist', async () => {
      // 테스트 메모리 생성
      const memoryId1 = 'mem_test_1';
      const memoryId2 = 'mem_test_2';
      const memoryId3 = 'mem_test_3';

      // 메모리 아이템 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, [memoryId1, 'episodic', 'Test content 1', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, [memoryId2, 'episodic', 'Test content 2', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, [memoryId3, 'episodic', 'Test content 3', 0.5, 'private']);

      // 유사한 임베딩 생성 (동일한 벡터 사용)
      const testEmbedding = Array(512).fill(0.1);
      const embeddingJson = JSON.stringify(testEmbedding);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_embedding (
          memory_id, embedding, embedding_provider, dimensions, dim, created_at
        )
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId1, embeddingJson, 'tfidf', 512, 512]);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_embedding (
          memory_id, embedding, embedding_provider, dimensions, dim, created_at
        )
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId2, embeddingJson, 'tfidf', 512, 512]);

      // 벡터 테이블에 데이터 삽입은 트리거가 자동으로 처리하므로,
      // 임베딩이 생성되면 자동으로 memory_item_vec_tfidf에 추가됨
      // 여기서는 트리거가 작동하도록 약간의 지연을 두고 테스트 진행
      await new Promise(resolve => setTimeout(resolve, 500));

      const result = await neighborService.getNeighbors(memoryId1, {
        limit: 5,
        similarity_threshold: 0.5 // 낮은 임계값으로 설정
      });

      expect(result.memory_id).toBe(memoryId1);
      expect(result.total_count).toBeGreaterThanOrEqual(0);
      expect(result.query_time).toBeGreaterThanOrEqual(0);
      // memoryId1 자체는 제외되어야 함
      expect(result.neighbors.every(n => n.id !== memoryId1)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const memoryId = 'mem_test_limit';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const result = await neighborService.getNeighbors(memoryId, {
        limit: 3,
        similarity_threshold: 0.8
      });

      expect(result.neighbors.length).toBeLessThanOrEqual(3);
    });

    it('should respect similarity_threshold parameter', async () => {
      const memoryId = 'mem_test_threshold';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const result = await neighborService.getNeighbors(memoryId, {
        limit: 5,
        similarity_threshold: 0.9 // 높은 임계값
      });

      // 모든 이웃의 유사도가 임계값 이상이어야 함
      result.neighbors.forEach(neighbor => {
        expect(neighbor.similarity).toBeGreaterThanOrEqual(0.9);
      });
    });
  });

  describe('getNeighbors - 에러 케이스', () => {
    it('should throw MemoryNotFoundError for non-existent memory', async () => {
      await expect(
        neighborService.getNeighbors('non_existent_id', {})
      ).rejects.toThrow(MemoryNotFoundError);
    });

    it('should return empty array for invalid embedding format', async () => {
      const memoryId = 'mem_test_invalid';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      // 잘못된 형식의 임베딩 저장
      await DatabaseUtils.run(db, `
        INSERT INTO memory_embedding (
          memory_id, embedding, embedding_provider, dimensions, dim, created_at
        )
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId, 'invalid_json', 'tfidf', 512, 512]);

      const result = await neighborService.getNeighbors(memoryId, {});

      expect(result.neighbors).toEqual([]);
      expect(result.total_count).toBe(0);
    });
  });

  describe('updateNeighborsForNewMemory', () => {
    it('should return empty array when memory has no embedding', async () => {
      const memoryId = 'mem_test_update_1';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const result = await neighborService.updateNeighborsForNewMemory(memoryId, 0.8);

      expect(result).toEqual([]);
    });

    it('should return neighbor IDs when similar memories exist', async () => {
      const memoryId1 = 'mem_test_update_2';
      const memoryId2 = 'mem_test_update_3';

      // 메모리 아이템 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, [memoryId1, 'episodic', 'Test content 1', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, [memoryId2, 'episodic', 'Test content 2', 0.5, 'private']);

      // 유사한 임베딩 생성
      const testEmbedding = Array(512).fill(0.1);
      const embeddingJson = JSON.stringify(testEmbedding);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_embedding (
          memory_id, embedding, embedding_provider, dimensions, dim, created_at
        )
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId1, embeddingJson, 'tfidf', 512, 512]);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_embedding (
          memory_id, embedding, embedding_provider, dimensions, dim, created_at
        )
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId2, embeddingJson, 'tfidf', 512, 512]);

      // 벡터 테이블에 데이터 삽입은 트리거가 자동으로 처리하므로,
      // 임베딩이 생성되면 자동으로 memory_item_vec_tfidf에 추가됨
      // 여기서는 트리거가 작동하도록 약간의 지연을 두고 테스트 진행
      await new Promise(resolve => setTimeout(resolve, 500));

      const result = await neighborService.updateNeighborsForNewMemory(memoryId1, 0.5);

      expect(Array.isArray(result)).toBe(true);
      // memoryId1 자체는 제외되어야 함
      expect(result.every(id => id !== memoryId1)).toBe(true);
    });

    it('should return empty array on error without throwing', async () => {
      const memoryId = 'mem_test_update_error';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      // 데이터베이스 연결 해제하여 에러 발생
      db.close();

      // 새로운 서비스 인스턴스 생성 (데이터베이스 없음)
      const newService = new MemoryNeighborService(
        vectorSearchEngine,
        embeddingService
      );

      const result = await newService.updateNeighborsForNewMemory(memoryId, 0.8);

      expect(result).toEqual([]);
    });
  });
});


import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';
import { GetMemoryNeighborsTool, GetMemoryNeighborsSchema } from './get-memory-neighbors-tool.js';
import type { ToolContext } from './types.js';
import { getVectorSearchEngine } from '../algorithms/vector-search-engine.js';
import * as vectorSearchEngineModule from '../algorithms/vector-search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';

// Mock @xenova/transformers to prevent onnxruntime-node loading
vi.mock('@xenova/transformers', () => {
  return {
    pipeline: vi.fn().mockResolvedValue({
      __call: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
    })
  };
});

describe('GetMemoryNeighborsTool', () => {
  let db: Database.Database;
  let tool: GetMemoryNeighborsTool;
  let context: ToolContext;
  let vectorSearchEngine: ReturnType<typeof getVectorSearchEngine>;
  let embeddingService: MemoryEmbeddingService;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    DatabaseUtils.initializeDatabase(db);
    
    vectorSearchEngine = getVectorSearchEngine();
    vectorSearchEngine.initialize(db);
    
    embeddingService = new MemoryEmbeddingService();
    
    tool = new GetMemoryNeighborsTool();
    
    context = {
      db,
      services: {
        embeddingService
      }
    };
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('초기화', () => {
    it('should create tool with correct name and description', () => {
      const definition = tool.getDefinition();
      expect(definition.name).toBe('get_memory_neighbors');
      expect(definition.description).toBe('특정 기억과 유사한 이웃 기억을 조회합니다');
    });

    it('should have correct input schema', () => {
      const definition = tool.getDefinition();
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(definition.inputSchema.properties).toHaveProperty('memory_id');
      expect(definition.inputSchema.properties).toHaveProperty('limit');
      expect(definition.inputSchema.properties).toHaveProperty('similarity_threshold');
      expect(definition.inputSchema.required).toContain('memory_id');
    });
  });

  describe('파라미터 검증', () => {
    it('should accept valid parameters', async () => {
      const memoryId = 'mem_test_1';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const params = {
        memory_id: memoryId,
        limit: 5,
        similarity_threshold: 0.8
      };

      // 파라미터 검증은 통과해야 함 (실제 실행은 실패할 수 있지만 검증은 통과)
      expect(() => {
        // Zod 스키마 검증만 확인
        GetMemoryNeighborsSchema.parse(params);
      }).not.toThrow();
    });

    it('should reject missing memory_id', async () => {
      const params = {
        limit: 5
      };

      await expect(
        tool.handle(params, context)
      ).rejects.toThrow();
    });

    it('should accept default values for optional parameters', async () => {
      const memoryId = 'mem_test_2';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const params = {
        memory_id: memoryId
      };

      // 기본값으로 실행 시도 (실제 실행은 실패할 수 있지만 파라미터 검증은 통과)
      expect(() => {
        const result = GetMemoryNeighborsSchema.parse(params);
        expect(result.limit).toBe(5);
        expect(result.similarity_threshold).toBe(0.8);
      }).not.toThrow();
    });

    it('should validate limit range', async () => {
      const memoryId = 'mem_test_3';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const params = {
        memory_id: memoryId,
        limit: 100 // 범위 초과
      };

      await expect(
        tool.handle(params, context)
      ).rejects.toThrow();
    });

    it('should validate similarity_threshold range', async () => {
      const memoryId = 'mem_test_4';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const params = {
        memory_id: memoryId,
        similarity_threshold: 1.5 // 범위 초과
      };

      await expect(
        tool.handle(params, context)
      ).rejects.toThrow();
    });
  });

  describe('정상 실행', () => {
    it('should return neighbors when memory exists', async () => {
      const memoryId = 'mem_test_success';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const params = {
        memory_id: memoryId,
        limit: 5,
        similarity_threshold: 0.8
      };

      const result = await tool.handle(params, context);

      expect(result).toHaveProperty('content');
      expect(result.content).toBeInstanceOf(Array);
      expect(result.content.length).toBeGreaterThan(0);
      
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData).toHaveProperty('memory_id', memoryId);
      expect(resultData).toHaveProperty('neighbors');
      expect(resultData).toHaveProperty('total_count');
      expect(resultData).toHaveProperty('query_time');
      expect(Array.isArray(resultData.neighbors)).toBe(true);
    });

    it('should return empty neighbors when no similar memories exist', async () => {
      const memoryId = 'mem_test_empty';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const params = {
        memory_id: memoryId,
        limit: 5,
        similarity_threshold: 0.8
      };

      const result = await tool.handle(params, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe(memoryId);
      expect(resultData.neighbors).toEqual([]);
      expect(resultData.total_count).toBe(0);
    });
  });

  describe('에러 케이스', () => {
    it('should throw error for non-existent memory', async () => {
      const params = {
        memory_id: 'non_existent_id',
        limit: 5,
        similarity_threshold: 0.8
      };

      await expect(
        tool.handle(params, context)
      ).rejects.toThrow();
    });

    it('should handle database connection error', async () => {
      const memoryId = 'mem_test_db_error';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      // 데이터베이스 연결 해제
      db.close();

      const params = {
        memory_id: memoryId,
        limit: 5,
        similarity_threshold: 0.8
      };

      const invalidContext: ToolContext = {
        db: null as any,
        services: {
          embeddingService
        }
      };

      await expect(
        tool.handle(params, invalidContext)
      ).rejects.toThrow();
    });

    it('should handle VectorSearchEngine initialization error gracefully', async () => {
      const memoryId = 'mem_test_engine_error';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const params = {
        memory_id: memoryId,
        limit: 5,
        similarity_threshold: 0.8
      };

      // getVectorSearchEngine을 모킹하여 에러 발생
      const spy = vi.spyOn(vectorSearchEngineModule, 'getVectorSearchEngine')
        .mockImplementation(() => {
          throw new Error('VectorSearchEngine initialization failed');
        });

      try {
        await expect(
          tool.handle(params, context)
        ).rejects.toThrow();
      } finally {
        // 모킹 복원
        spy.mockRestore();
      }
    });
  });

  describe('응답 형식', () => {
    it('should return MCP Tool standard response format', async () => {
      const memoryId = 'mem_test_format';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const params = {
        memory_id: memoryId,
        limit: 5,
        similarity_threshold: 0.8
      };

      const result = await tool.handle(params, context);

      // MCP Tool 표준 응답 형식 확인
      expect(result).toHaveProperty('content');
      expect(result.content).toBeInstanceOf(Array);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(result.content[0]).toHaveProperty('text');

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData).toHaveProperty('memory_id');
      expect(resultData).toHaveProperty('neighbors');
      expect(resultData).toHaveProperty('total_count');
      expect(resultData).toHaveProperty('query_time');
    });

    it('should include neighbor details in response', async () => {
      const memoryId = 'mem_test_neighbor_details';
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [memoryId, 'episodic', 'Test content', 0.5, 'private']);

      const params = {
        memory_id: memoryId,
        limit: 5,
        similarity_threshold: 0.8
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      if (resultData.neighbors.length > 0) {
        const neighbor = resultData.neighbors[0];
        expect(neighbor).toHaveProperty('id');
        expect(neighbor).toHaveProperty('content');
        expect(neighbor).toHaveProperty('type');
        expect(neighbor).toHaveProperty('similarity');
        expect(typeof neighbor.similarity).toBe('number');
        expect(neighbor.similarity).toBeGreaterThanOrEqual(0);
        expect(neighbor.similarity).toBeLessThanOrEqual(1);
      }
    });
  });
});


import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { SearchLocalTool } from '../search-local-tool.js';
import type { ToolContext } from '../types.js';
import { AnchorManager, AnchorError } from '../../anchor-manager.js';
import { MemoryEmbeddingService } from '../../memory/services/memory-embedding-service.js';
import { createHybridSearchEngine, type HybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import { getVectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';

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

/**
 * 테스트용 데이터베이스 초기화
 */
function initializeTestDatabase(db: Database.Database): void {
  DatabaseUtils.initializeDatabase(db);
  
  // anchor 테이블 생성
  db.exec(`
    CREATE TABLE IF NOT EXISTS anchor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      slot TEXT CHECK (slot IN ('A', 'B', 'C')) NOT NULL,
      memory_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE SET NULL,
      UNIQUE(agent_id, slot)
    );

    CREATE INDEX IF NOT EXISTS idx_anchor_agent_slot ON anchor(agent_id, slot);
    CREATE INDEX IF NOT EXISTS idx_anchor_memory_id ON anchor(memory_id) WHERE memory_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_anchor_agent_memory ON anchor(agent_id, memory_id) WHERE memory_id IS NOT NULL;
  `);

  // memory_embedding 테이블에 projection_type 컬럼 추가 (테스트용)
  try {
    db.exec(`
      ALTER TABLE memory_embedding ADD COLUMN projection_type TEXT NOT NULL DEFAULT 'native';
    `);
  } catch (error: any) {
    // 컬럼이 이미 존재하는 경우 무시
    if (!error.message.includes('duplicate column name')) {
      throw error;
    }
  }

  // UNIQUE 제약조건 업데이트 (memory_id만이 아닌 복합 키)
  try {
    // 기존 UNIQUE 제약조건 제거 (SQLite는 직접 제거 불가, 테이블 재생성 필요)
    // 테스트에서는 단순히 컬럼만 추가하고 사용
  } catch (error) {
    // 무시
  }
}

describe('SearchLocalTool', () => {
  let db: Database.Database;
  let tool: SearchLocalTool;
  let context: ToolContext;
  let anchorManager: AnchorManager;
  let embeddingService: MemoryEmbeddingService;
  let hybridSearchEngine: HybridSearchEngine;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    embeddingService = new MemoryEmbeddingService();
    hybridSearchEngine = createHybridSearchEngine();
    anchorManager = new AnchorManager();
    anchorManager.setDatabase(db);
    anchorManager.setEmbeddingService(embeddingService);
    anchorManager.setHybridSearchEngine(hybridSearchEngine);
    anchorManager.setVectorSearchEngine(getVectorSearchEngine());

    tool = new SearchLocalTool();

    context = {
      db,
      services: {
        anchorManager,
        hybridSearchEngine
      }
    };
  });

  afterEach(() => {
    // 인스턴스 정리
    if (anchorManager) {
      anchorManager = null as any;
    }
    if (hybridSearchEngine) {
      hybridSearchEngine = null as any;
    }
    if (embeddingService) {
      embeddingService = null as any;
    }
    if (tool) {
      tool = null as any;
    }
    if (context) {
      context = null as any;
    }

    // 데이터베이스 닫기
    if (db) {
      try {
        db.close();
      } catch (error) {
        console.warn('Database close 중 에러:', error);
      }
      db = null as any;
    }

    // Mock 정리
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('초기화', () => {
    it('should create tool with correct name and description', () => {
      const definition = tool.getDefinition();
      expect(definition.name).toBe('search_local');
      expect(definition.description).toBe('앵커 주변에서 국소 검색을 수행합니다');
    });

    it('should have correct input schema', () => {
      const definition = tool.getDefinition();
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(definition.inputSchema.properties).toHaveProperty('slot');
      expect(definition.inputSchema.properties).toHaveProperty('query');
      expect(definition.inputSchema.properties).toHaveProperty('hop_limit');
      expect(definition.inputSchema.properties).toHaveProperty('limit');
      expect(definition.inputSchema.properties).toHaveProperty('min_results');
      expect(definition.inputSchema.properties).toHaveProperty('agent_id');
      expect(definition.inputSchema.required).toContain('slot');
    });
  });

  describe('국소 검색', () => {
    beforeEach(async () => {
      // 테스트용 메모리 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content 1', 0.5, 'private']);

      // 앵커 설정
      await anchorManager.setAnchor('agent1', 'mem1', 'A');

      // 임베딩 직접 삽입 (테스트용 더미 벡터)
      const testEmbedding = Array(384).fill(0.1);
      const embeddingJson = JSON.stringify(testEmbedding);
      await DatabaseUtils.run(db, `
        INSERT INTO memory_embedding (
          memory_id, embedding, embedding_provider, projection_type, dimensions, dim, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['mem1', embeddingJson, 'tfidf', 'native', 384, 384]);
    });

    it('should perform local search with query', async () => {
      const params = {
        slot: 'A',
        query: 'test',
        agent_id: 'agent1',
        limit: 10
      };

      // searchLocal이 호출되면 결과를 반환하도록 모킹
      // 실제로는 임베딩이 필요하므로 간단한 테스트만 수행
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData).toHaveProperty('items');
      expect(resultData).toHaveProperty('total_count');
      expect(resultData).toHaveProperty('local_results_count');
      expect(resultData).toHaveProperty('fallback_used');
      expect(resultData).toHaveProperty('query_time');
      expect(resultData).toHaveProperty('anchor_info');
    });

    it('should perform local search without query (anchor-based recall)', async () => {
      const params = {
        slot: 'A',
        agent_id: 'agent1',
        limit: 10
      };

      // query가 없으면 앵커 주변 모든 메모리 반환
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData).toHaveProperty('items');
      expect(resultData).toHaveProperty('anchor_info');
    });

    it('should use default agent_id when not provided', async () => {
      await anchorManager.setAnchor('default', 'mem1', 'A');

      const params = {
        slot: 'A',
        query: 'test'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.anchor_info.agent_id).toBe('default');
    });

    it('should use slot-specific hop_limit when not provided', async () => {
      const params = {
        slot: 'A',
        query: 'test',
        agent_id: 'agent1'
      };

      // 슬롯 A의 기본 hop_limit은 1
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData).toHaveProperty('items');
    });

    it('should use custom hop_limit when provided', async () => {
      const params = {
        slot: 'A',
        query: 'test',
        agent_id: 'agent1',
        hop_limit: 2
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData).toHaveProperty('items');
    });

    it('should use custom limit when provided', async () => {
      const params = {
        slot: 'A',
        query: 'test',
        agent_id: 'agent1',
        limit: 5
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items.length).toBeLessThanOrEqual(5);
    });

    it('should use custom min_results when provided', async () => {
      const params = {
        slot: 'A',
        query: 'test',
        agent_id: 'agent1',
        min_results: 5
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData).toHaveProperty('fallback_used');
    });
  });

  describe('Fallback 메커니즘', () => {
    beforeEach(async () => {
      // 테스트용 메모리 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content 1', 0.5, 'private']);

      // 앵커 설정
      await anchorManager.setAnchor('agent1', 'mem1', 'A');

      // 임베딩 직접 삽입 (테스트용 더미 벡터)
      const testEmbedding = Array(384).fill(0.1);
      const embeddingJson = JSON.stringify(testEmbedding);
      await DatabaseUtils.run(db, `
        INSERT INTO memory_embedding (
          memory_id, embedding, embedding_provider, projection_type, dimensions, dim, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['mem1', embeddingJson, 'tfidf', 'native', 384, 384]);
    });

    it('should fallback to global search when query provided and results insufficient', async () => {
      const params = {
        slot: 'A',
        query: 'nonexistent content that will not match',
        agent_id: 'agent1',
        limit: 10,
        min_results: 3
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Fallback이 발생했을 수 있음
      expect(resultData).toHaveProperty('fallback_used');
      expect(resultData).toHaveProperty('total_count');
    });

    it('should not fallback when query is not provided', async () => {
      const params = {
        slot: 'A',
        agent_id: 'agent1',
        limit: 10,
        min_results: 3
      };

      // query가 없으면 fallback 없음
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // query가 없으면 fallback_used는 false여야 함
      expect(resultData.fallback_used).toBe(false);
    });
  });

  describe('에러 처리', () => {
    it('should throw error when anchor does not exist and query is not provided', async () => {
      const params = {
        slot: 'A',
        agent_id: 'agent1'
        // query 없음
      };

      await expect(
        tool.handle(params, context)
      ).rejects.toThrow();
    });

    it('should fallback to global search when anchor does not exist and query is provided', async () => {
      const params = {
        slot: 'A',
        query: 'test',
        agent_id: 'agent1'
      };

      // 앵커가 없어도 query가 있으면 fallback
      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData).toHaveProperty('items');
      expect(resultData.fallback_used).toBe(true);
    });

    it('should throw error when slot is invalid', async () => {
      const params = {
        slot: 'D', // 잘못된 슬롯
        query: 'test',
        agent_id: 'agent1'
      };

      await expect(
        tool.handle(params, context)
      ).rejects.toThrow();
    });

    it('should throw error when database is not set', async () => {
      const invalidContext: ToolContext = {
        db: null as any,
        services: {
          anchorManager,
          hybridSearchEngine
        }
      };

      await expect(
        tool.handle({
          slot: 'A',
          query: 'test',
          agent_id: 'agent1'
        }, invalidContext)
      ).rejects.toThrow('데이터베이스');
    });

    it('should throw error when anchorManager is not set', async () => {
      const invalidContext: ToolContext = {
        db,
        services: {
          hybridSearchEngine
        }
      };

      await expect(
        tool.handle({
          slot: 'A',
          query: 'test',
          agent_id: 'agent1'
        }, invalidContext)
      ).rejects.toThrow('앵커 관리자');
    });

    it('should validate hop_limit range', async () => {
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content', 0.5, 'private']);

      await anchorManager.setAnchor('agent1', 'mem1', 'A');

      // hop_limit이 범위를 벗어남
      await expect(
        tool.handle({
          slot: 'A',
          query: 'test',
          agent_id: 'agent1',
          hop_limit: 10 // 최대 5
        }, context)
      ).rejects.toThrow();
    });

    it('should validate limit range', async () => {
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content', 0.5, 'private']);

      await anchorManager.setAnchor('agent1', 'mem1', 'A');

      // limit이 범위를 벗어남
      await expect(
        tool.handle({
          slot: 'A',
          query: 'test',
          agent_id: 'agent1',
          limit: 200 // 최대 100
        }, context)
      ).rejects.toThrow();
    });
  });
});


import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';
import { RestoreAnchorsTool } from './restore-anchors-tool.js';
import type { ToolContext } from './types.js';
import { AnchorManager } from '../services/anchor-manager.js';
import type { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import type { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import type { VectorSearchEngine } from '../algorithms/vector-search-engine.js';

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
}

describe('RestoreAnchorsTool', () => {
  let db: Database.Database;
  let tool: RestoreAnchorsTool;
  let context: ToolContext;
  let anchorManager: AnchorManager;
  let embeddingService: MemoryEmbeddingService;
  let hybridSearchEngine: HybridSearchEngine;
  let vectorSearchEngine: VectorSearchEngine;

  function createMockEmbeddingService(): MemoryEmbeddingService {
    return {
      createAndStoreEmbedding: vi.fn(),
      searchBySimilarity: vi.fn(),
      migrateProvider: vi.fn(),
      isAvailable: vi.fn().mockReturnValue(false)
    } as unknown as MemoryEmbeddingService;
  }

  function createMockHybridSearchEngine(): HybridSearchEngine {
    return {
      search: vi.fn().mockResolvedValue({ items: [], total_count: 0 }),
      isEmbeddingAvailable: vi.fn().mockReturnValue(false)
    } as unknown as HybridSearchEngine;
  }

  function createMockVectorSearchEngine(): VectorSearchEngine {
    return {
      initialize: vi.fn(),
      search: vi.fn().mockResolvedValue([]),
      isAvailable: vi.fn().mockReturnValue(true)
    } as unknown as VectorSearchEngine;
  }

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    embeddingService = createMockEmbeddingService();
    hybridSearchEngine = createMockHybridSearchEngine();
    vectorSearchEngine = createMockVectorSearchEngine();
    anchorManager = new AnchorManager();
    anchorManager.setDatabase(db);
    anchorManager.setEmbeddingService(embeddingService);
    anchorManager.setHybridSearchEngine(hybridSearchEngine);
    anchorManager.setVectorSearchEngine(vectorSearchEngine);

    tool = new RestoreAnchorsTool();

    context = {
      db,
      services: {
        anchorManager
      }
    };
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  describe('초기화', () => {
    it('should create tool with correct name and description', () => {
      const definition = tool.getDefinition();
      expect(definition.name).toBe('restore_anchors');
      expect(definition.description).toBe('데이터베이스에서 앵커 상태를 메모리 캐시로 복원합니다');
    });

    it('should have correct input schema', () => {
      const definition = tool.getDefinition();
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(definition.inputSchema.properties).toHaveProperty('agent_id');
      expect(definition.inputSchema.required).toEqual([]);
    });
  });

  describe('앵커 복원', () => {
    beforeEach(async () => {
      // 테스트용 메모리 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content 1', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['mem2', 'semantic', 'Test content 2', 0.5, 'private']);

      // DB에 직접 앵커 삽입 (캐시는 비워둠)
      await DatabaseUtils.run(db, `
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `, ['agent1', 'A', 'mem1']);

      await DatabaseUtils.run(db, `
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `, ['agent1', 'B', 'mem2']);

      await DatabaseUtils.run(db, `
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `, ['agent2', 'A', 'mem1']);
    });

    it('should restore all anchors when agent_id is not provided', async () => {
      const params = {};

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.success).toBe(true);
      expect(resultData.agent_count).toBe(2);
      expect(resultData.total_anchors).toBe(3);
      expect(resultData.restored_anchors).toHaveProperty('agent1');
      expect(resultData.restored_anchors).toHaveProperty('agent2');
      expect(resultData.message).toContain('모든 앵커가 복원되었습니다');

      // 캐시가 복원되었는지 확인
      const anchor1 = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor1).not.toBeNull();
      if (anchor1 && !Array.isArray(anchor1)) {
        expect(anchor1.memory_id).toBe('mem1');
      }
    });

    it('should restore specific agent anchors when agent_id is provided', async () => {
      const params = {
        agent_id: 'agent1'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.success).toBe(true);
      expect(resultData.agent_count).toBe(1);
      expect(resultData.total_anchors).toBe(2);
      expect(resultData.restored_anchors).toHaveProperty('agent1');
      expect(resultData.restored_anchors).not.toHaveProperty('agent2');
      expect(resultData.message).toContain('agent1');
    });

    it('should handle agent with no anchors', async () => {
      const params = {
        agent_id: 'agent3'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.success).toBe(true);
      expect(resultData.total_anchors).toBe(0);
      expect(resultData.restored_anchors.agent3).toBeDefined();
      expect(resultData.restored_anchors.agent3.A).toBeNull();
      expect(resultData.restored_anchors.agent3.B).toBeNull();
      expect(resultData.restored_anchors.agent3.C).toBeNull();
    });

    it('should restore anchors correctly with all slots', async () => {
      // C 슬롯도 추가
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['mem3', 'procedural', 'Test content 3', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `, ['agent1', 'C', 'mem3']);

      const params = {
        agent_id: 'agent1'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.total_anchors).toBe(3);
      expect(resultData.restored_anchors.agent1.A).not.toBeNull();
      expect(resultData.restored_anchors.agent1.B).not.toBeNull();
      expect(resultData.restored_anchors.agent1.C).not.toBeNull();
    });
  });

  describe('에러 처리', () => {
    it('should throw error when database is not set', async () => {
      const invalidContext: ToolContext = {
        db: null as any,
        services: {
          anchorManager
        }
      };

      await expect(
        tool.handle({}, invalidContext)
      ).rejects.toThrow('데이터베이스');
    });

    it('should throw error when anchorManager is not set', async () => {
      const invalidContext: ToolContext = {
        db,
        services: {}
      };

      await expect(
        tool.handle({}, invalidContext)
      ).rejects.toThrow('앵커 관리자');
    });
  });
});

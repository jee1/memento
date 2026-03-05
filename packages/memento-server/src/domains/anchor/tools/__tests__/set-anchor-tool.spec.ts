// Mock @xenova/transformers to prevent onnxruntime-node and sharp loading
// MUST be at the top before any imports
import { vi } from 'vitest';
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

// onnxruntime-node 모킹 (네이티브 바인딩 로딩 실패 방지)
vi.mock('onnxruntime-node', () => ({
  InferenceSession: vi.fn(),
  Tensor: vi.fn()
}));

// sharp 모킹 (이미지 처리 라이브러리 로딩 실패 방지)
vi.mock('sharp', () => ({
  default: vi.fn()
}));

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { SetAnchorTool } from '../set-anchor-tool.js';
import type { ToolContext } from '../types.js';
import { AnchorManager } from '../../services/anchor/anchor-manager.js';
import { AnchorCacheService } from '../../services/anchor/anchor-cache-service.js';
import { AnchorSearchService } from '../../services/anchor/anchor-search-service.js';
import { MemoryEmbeddingService } from '../../../memory/services/memory-embedding-service.js';
import { HybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import { getVectorSearchEngine, type VectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';

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

describe('SetAnchorTool', () => {
  let db: Database.Database;
  let tool: SetAnchorTool;
  let context: ToolContext;
  let anchorManager: AnchorManager;
  let cacheService: AnchorCacheService;
  let searchService: AnchorSearchService;
  let embeddingService: MemoryEmbeddingService;
  let hybridSearchEngine: HybridSearchEngine;
  let vectorSearchEngine: VectorSearchEngine;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    embeddingService = new MemoryEmbeddingService();
    hybridSearchEngine = new HybridSearchEngine();
    vectorSearchEngine = getVectorSearchEngine();
    
    // 의존성 주입 패턴에 맞게 서비스 생성
    cacheService = new AnchorCacheService();
    cacheService.setDatabase(db);
    cacheService.setEmbeddingService(embeddingService);
    
    searchService = new AnchorSearchService(cacheService);
    searchService.setDatabase(db);
    searchService.setHybridSearchEngine(hybridSearchEngine);
    searchService.setVectorSearchEngine(vectorSearchEngine);
    
    anchorManager = new AnchorManager(cacheService, searchService);
    anchorManager.setDatabase(db);

    tool = new SetAnchorTool();

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
      expect(definition.name).toBe('set_anchor');
      expect(definition.description).toBe('특정 메모리를 앵커로 설정합니다');
    });

    it('should have correct input schema', () => {
      const definition = tool.getDefinition();
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(definition.inputSchema.properties).toHaveProperty('memory_id');
      expect(definition.inputSchema.properties).toHaveProperty('slot');
      expect(definition.inputSchema.properties).toHaveProperty('agent_id');
      expect(definition.inputSchema.required).toContain('memory_id');
      expect(definition.inputSchema.required).toContain('slot');
    });
  });

  describe('앵커 설정', () => {
    beforeEach(async () => {
      // 테스트용 메모리 생성
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content 1', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem2', 'semantic', 'Test content 2', 0.5, 'private']);
    });

    it('should set anchor successfully', async () => {
      const params = {
        memory_id: 'mem1',
        slot: 'A',
        agent_id: 'agent1'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.success).toBe(true);
      expect(resultData.agent_id).toBe('agent1');
      expect(resultData.slot).toBe('A');
      expect(resultData.memory_id).toBe('mem1');

      // 데이터베이스에서 확인
      const anchor = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor).not.toBeNull();
      if (anchor && !Array.isArray(anchor)) {
        expect(anchor.memory_id).toBe('mem1');
      }
    });

    it('should use default agent_id when not provided', async () => {
      const params = {
        memory_id: 'mem1',
        slot: 'A'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.agent_id).toBe('default');
    });

    it('should update existing anchor in same slot', async () => {
      // 첫 번째 앵커 설정
      await tool.handle({
        memory_id: 'mem1',
        slot: 'A',
        agent_id: 'agent1'
      }, context);

      // 같은 슬롯에 다른 메모리 설정
      const result = await tool.handle({
        memory_id: 'mem2',
        slot: 'A',
        agent_id: 'agent1'
      }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.memory_id).toBe('mem2');

      // 데이터베이스에서 확인
      const anchor = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor).not.toBeNull();
      if (anchor && !Array.isArray(anchor)) {
        expect(anchor.memory_id).toBe('mem2');
      }
    });

    it('should prevent same memory_id in different slots for same agent', async () => {
      // 첫 번째 슬롯에 설정
      await tool.handle({
        memory_id: 'mem1',
        slot: 'A',
        agent_id: 'agent1'
      }, context);

      // 다른 슬롯에 같은 메모리 설정 시도 (에러 발생해야 함)
      await expect(
        tool.handle({
          memory_id: 'mem1',
          slot: 'B',
          agent_id: 'agent1'
        }, context)
      ).rejects.toThrow();
    });

    it('should allow same memory_id for different agents', async () => {
      // agent1에 설정
      await tool.handle({
        memory_id: 'mem1',
        slot: 'A',
        agent_id: 'agent1'
      }, context);

      // agent2에 같은 메모리 설정 (성공해야 함)
      const result = await tool.handle({
        memory_id: 'mem1',
        slot: 'A',
        agent_id: 'agent2'
      }, context);

      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.success).toBe(true);
      expect(resultData.agent_id).toBe('agent2');
    });
  });

  describe('에러 처리', () => {
    it('should throw error when memory does not exist', async () => {
      const params = {
        memory_id: 'nonexistent',
        slot: 'A',
        agent_id: 'agent1'
      };

      await expect(
        tool.handle(params, context)
      ).rejects.toThrow('메모리를 찾을 수 없습니다');
    });

    it('should throw error when slot is invalid', async () => {
      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content', 0.5, 'private']);

      const params = {
        memory_id: 'mem1',
        slot: 'D', // 잘못된 슬롯
        agent_id: 'agent1'
      };

      await expect(
        tool.handle(params, context)
      ).rejects.toThrow();
    });

    it('should throw error when memory_id is empty', async () => {
      const params = {
        memory_id: '',
        slot: 'A',
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
          anchorManager
        }
      };

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content', 0.5, 'private']);

      await expect(
        tool.handle({
          memory_id: 'mem1',
          slot: 'A',
          agent_id: 'agent1'
        }, invalidContext)
      ).rejects.toThrow('데이터베이스');
    });

    it('should throw error when anchorManager is not set', async () => {
      const invalidContext: ToolContext = {
        db,
        services: {}
      };

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content', 0.5, 'private']);

      await expect(
        tool.handle({
          memory_id: 'mem1',
          slot: 'A',
          agent_id: 'agent1'
        }, invalidContext)
      ).rejects.toThrow('앵커 관리자');
    });
  });
});


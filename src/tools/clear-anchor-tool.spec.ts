import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';
import { ClearAnchorTool } from './clear-anchor-tool.js';
import type { ToolContext } from './types.js';
import { AnchorManager } from '../services/anchor-manager.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { getVectorSearchEngine } from '../algorithms/vector-search-engine.js';

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

describe('ClearAnchorTool', () => {
  let db: Database.Database;
  let tool: ClearAnchorTool;
  let context: ToolContext;
  let anchorManager: AnchorManager;
  let embeddingService: MemoryEmbeddingService;
  let hybridSearchEngine: HybridSearchEngine;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    embeddingService = new MemoryEmbeddingService();
    hybridSearchEngine = new HybridSearchEngine();
    anchorManager = new AnchorManager();
    anchorManager.setDatabase(db);
    anchorManager.setEmbeddingService(embeddingService);
    anchorManager.setHybridSearchEngine(hybridSearchEngine);
    anchorManager.setVectorSearchEngine(getVectorSearchEngine());

    tool = new ClearAnchorTool();

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
      expect(definition.name).toBe('clear_anchor');
      expect(definition.description).toBe('설정된 앵커를 제거합니다');
    });

    it('should have correct input schema', () => {
      const definition = tool.getDefinition();
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(definition.inputSchema.properties).toHaveProperty('slot');
      expect(definition.inputSchema.properties).toHaveProperty('agent_id');
      expect(definition.inputSchema.required).toEqual([]);
    });
  });

  describe('앵커 제거', () => {
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

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, ['mem3', 'procedural', 'Test content 3', 0.5, 'private']);

      // 앵커 설정
      await anchorManager.setAnchor('agent1', 'mem1', 'A');
      await anchorManager.setAnchor('agent1', 'mem2', 'B');
      await anchorManager.setAnchor('agent1', 'mem3', 'C');
      await anchorManager.setAnchor('agent2', 'mem1', 'A');
    });

    it('should clear specific slot anchor', async () => {
      const params = {
        slot: 'A',
        agent_id: 'agent1'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.success).toBe(true);
      expect(resultData.agent_id).toBe('agent1');
      expect(resultData.slot).toBe('A');

      // 데이터베이스에서 확인
      const anchor = await anchorManager.getAnchor('agent1', 'A');
      expect(anchor).toBeNull();

      // 다른 슬롯은 유지되어야 함
      const anchorB = await anchorManager.getAnchor('agent1', 'B');
      expect(anchorB).not.toBeNull();
    });

    it('should clear all slots when slot is not provided', async () => {
      const params = {
        agent_id: 'agent1'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.success).toBe(true);
      expect(resultData.agent_id).toBe('agent1');
      expect(resultData.message).toContain('모든 앵커가 제거되었습니다');

      // 모든 슬롯이 제거되었는지 확인
      const anchors = await anchorManager.getAnchor('agent1');
      expect(anchors).toBeNull();
    });

    it('should use default agent_id when not provided', async () => {
      await anchorManager.setAnchor('default', 'mem1', 'A');

      const params = {
        slot: 'A'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.agent_id).toBe('default');

      // 데이터베이스에서 확인
      const anchor = await anchorManager.getAnchor('default', 'A');
      expect(anchor).toBeNull();
    });

    it('should not affect other agents anchors', async () => {
      const params = {
        agent_id: 'agent1'
      };

      await tool.handle(params, context);

      // agent2의 앵커는 유지되어야 함
      const anchor2 = await anchorManager.getAnchor('agent2', 'A');
      expect(anchor2).not.toBeNull();
    });

    it('should handle clearing non-existent anchor gracefully', async () => {
      const params = {
        slot: 'C',
        agent_id: 'agent2'
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.success).toBe(true);
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
        tool.handle({
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

      await expect(
        tool.handle({
          slot: 'A',
          agent_id: 'agent1'
        }, invalidContext)
      ).rejects.toThrow('앵커 관리자');
    });
  });
});


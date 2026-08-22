// Mock @huggingface/transformers to prevent onnxruntime-node loading
// MUST be at the top before any imports
import { vi } from 'vitest';
vi.mock('@huggingface/transformers', () => {
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { ClearAnchorTool } from '../clear-anchor-tool.js';
import type { ToolContext } from '../types.js';
import { AnchorManager } from '../../services/anchor/anchor-manager.js';
import { createAnchorToolTestContext } from './anchor-tool-test-context.js';

describe('ClearAnchorTool', () => {
  let db: Database.Database;
  let tool: ClearAnchorTool;
  let context: ToolContext;
  let anchorManager: AnchorManager;
  beforeEach(async () => {
    ({ db, context, anchorManager } = await createAnchorToolTestContext());
    tool = new ClearAnchorTool();
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
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at) VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem1', 'episodic', 'Test content 1', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at) VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
      `, ['mem2', 'semantic', 'Test content 2', 0.5, 'private']);

      await DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, reflection_notes, created_at) VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
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

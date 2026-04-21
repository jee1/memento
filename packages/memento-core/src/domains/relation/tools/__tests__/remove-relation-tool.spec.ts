import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { RemoveRelationTool } from '../remove-relation-tool.js';
import type { ToolContext } from '../../../../tools/types.js';

describe('RemoveRelationTool', () => {
  it('relationGraph가 없으면 구성 오류를 반환해야 함', async () => {
    const db = new Database(':memory:');
    const tool = new RemoveRelationTool();
    const context: ToolContext = {
      db,
      services: {}
    };

    try {
      const result = await tool.handle({ relation_id: 1 }, context);
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(false);
      expect(data.error).toBe('RELATION_GRAPH_UNAVAILABLE');
      expect(data.message).toContain('관계 그래프 서비스');
    } finally {
      db.close();
    }
  });
});

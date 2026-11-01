import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase } from '../../../../test/helpers/test-database.js';
import { createRelationGraph } from '../../../../infrastructure/relation-graph-factory.js';
import { RemoveRelationTool } from '../remove-relation-tool.js';
import type { ToolContext } from '../../../../tools/types.js';

describe('RemoveRelationTool', () => {
  it('relationGraph가 없으면 구성 오류를 반환해야 함', async () => {
    const db = new Database(':memory:');
    const tool = new RemoveRelationTool();
    const context: ToolContext = {
      db,
      services: {},
    };

    try {
      const result = await tool.handle({ relation_id: 1 }, context);
      const data = JSON.parse(result.content[0]!.text!);

      expect(data.success).toBe(false);
      expect(data.error).toBe('RELATION_GRAPH_UNAVAILABLE');
      expect(data.message).toContain('관계 그래프 서비스');
    } finally {
      db.close();
    }
  });

  it('superseded 끝점 간선은 삭제하지 않고 RELATION_NOT_FOUND 로 응답한다 (#1604)', async () => {
    const db = await setupTestDatabase();
    try {
      db.exec(`INSERT INTO memory_item (id, type, content, owner_id, project_id) VALUES
        ('old', 'semantic', 'old body', 'a', 'p'),
        ('target', 'semantic', 'new body', 'a', 'p');
        UPDATE memory_item SET superseded_by = 'target' WHERE id = 'old';
        INSERT INTO memory_relation (source_id, target_id, relation_type) VALUES ('old', 'target', 'REFERENCES');`);
      const relationId = Number(
        db.prepare('SELECT id FROM memory_relation WHERE source_id = ?').pluck().get('old'),
      );
      const context: ToolContext = {
        db,
        boundAgentId: 'a',
        boundProjectId: 'p',
        services: { relationGraph: createRelationGraph(db) },
      };
      const result = await new RemoveRelationTool().handle({ relation_id: relationId }, context);
      const data = JSON.parse(result.content[0]!.text!);
      expect(data.error).toBe('RELATION_NOT_FOUND');
      expect(db.prepare('SELECT COUNT(*) FROM memory_relation').pluck().get()).toBe(1);
    } finally {
      db.close();
    }
  });
});

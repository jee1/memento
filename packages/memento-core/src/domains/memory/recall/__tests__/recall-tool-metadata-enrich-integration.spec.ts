import { describe, it, expect, vi } from 'vitest';
import { describeRecallTool, db, tool, context, hybridSearchEngine } from './recall-tool.test-setup.js';

function stripHybridMetadata(item: Record<string, unknown>) {
  const {
    privacy_scope: _ps,
    source: _src,
    origin_source: _os,
    task_goal: _tg,
    steps: _steps,
    reflection_notes: _rn,
    workflow_name: _wn,
    skill_name: _sn,
    trigger_conditions: _tc,
    version: _v,
    version_series_id: _vs,
    ...rest
  } = item;
  return rest;
}

describeRecallTool('metadata enrich integration (#1009)', () => {
  describe('T2-a match_trigger_conditions 회귀', () => {
    it('하이브리드 목 결과에 trigger_conditions 가 없어도 DB 값으로 매칭된다', async () => {
      const memoryId = 'mem_trigger_enrich_1009';

      db.prepare(`
        INSERT INTO memory_item (
          id, type, content, importance, created_at, trigger_conditions
        ) VALUES (?, 'procedural', 'graphify sync procedure', 0.8, CURRENT_TIMESTAMP, '{"tool_name":"remember"}')
      `).run(memoryId);

      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          stripHybridMetadata({
            id: memoryId,
            content: 'graphify sync procedure',
            type: 'procedural',
            importance: 0.8,
            created_at: new Date().toISOString(),
            finalScore: 0.95,
          }),
        ],
        total_count: 1,
        query_time: 5,
      });

      const result = await tool.handle(
        {
          query: 'graphify',
          type: 'procedural',
          limit: 3,
          match_trigger_conditions: true,
          context: { tool_name: 'remember' },
        },
        context,
      );
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].memory_id).toBe(memoryId);
    });
  });

  describe('T2-b privacy_scope·source·origin_source', () => {
    it('목 결과에 없는 세 필드가 DB 값으로 응답에 포함된다', async () => {
      const memoryIdA = 'mem_privacy_a_1009';
      const memoryIdB = 'mem_privacy_b_1009';

      db.prepare(`
        INSERT INTO memory_item (
          id, type, content, importance, created_at,
          privacy_scope, source, origin_source
        ) VALUES
          (?, 'semantic', 'privacy scope test a', 0.8, CURRENT_TIMESTAMP, 'team', 'agent:cursor-agent', '{"kind":"chat"}'),
          (?, 'semantic', 'privacy scope test b', 0.7, CURRENT_TIMESTAMP, 'private', 'agent:claude-code', '{"kind":"mcp"}')
      `).run(memoryIdA, memoryIdB);

      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          stripHybridMetadata({
            id: memoryIdA,
            content: 'privacy scope test a',
            type: 'semantic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            finalScore: 0.9,
          }),
          stripHybridMetadata({
            id: memoryIdB,
            content: 'privacy scope test b',
            type: 'semantic',
            importance: 0.7,
            created_at: new Date().toISOString(),
            finalScore: 0.8,
          }),
        ],
        total_count: 2,
        query_time: 5,
      });

      const result = await tool.handle(
        {
          query: 'privacy scope',
          type: 'semantic',
          include_metadata: true,
          limit: 5,
        },
        context,
      );
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(2);

      const itemA = resultData.items.find((item: { memory_id: string }) => item.memory_id === memoryIdA);
      const itemB = resultData.items.find((item: { memory_id: string }) => item.memory_id === memoryIdB);

      expect(itemA.privacy_scope).toBe('team');
      expect(itemA.source).toBe('agent:cursor-agent');
      expect(itemA.origin_source).toEqual({ kind: 'chat' });

      expect(itemB.privacy_scope).toBe('private');
      expect(itemB.source).toBe('agent:claude-code');
      expect(itemB.origin_source).toEqual({ kind: 'mcp' });
    });
  });

  describe('T2-c procedural 필드', () => {
    it('목 결과에 없는 procedural 필드가 DB 값으로 채워진다', async () => {
      const memoryId = 'mem_procedural_enrich_1009';

      db.prepare(`
        INSERT INTO memory_item (
          id, type, content, importance, created_at,
          task_goal, steps, workflow_name, skill_name
        ) VALUES (
          ?, 'procedural', 'deploy procedure', 0.8, CURRENT_TIMESTAMP,
          'ship the feature', '["lint","test","deploy"]', 'release-pipeline', 'ci-cd'
        )
      `).run(memoryId);

      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          stripHybridMetadata({
            id: memoryId,
            content: 'deploy procedure',
            type: 'procedural',
            importance: 0.8,
            created_at: new Date().toISOString(),
            finalScore: 0.92,
          }),
        ],
        total_count: 1,
        query_time: 5,
      });

      const result = await tool.handle(
        {
          query: 'deploy',
          type: 'procedural',
          include_metadata: true,
          limit: 3,
        },
        context,
      );
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].task_goal).toBe('ship the feature');
      expect(resultData.items[0].steps).toBe('["lint","test","deploy"]');
      expect(resultData.items[0].workflow_name).toBe('release-pipeline');
      expect(resultData.items[0].skill_name).toBe('ci-cd');
    });
  });

  describe('T2-d 덮어쓰기 없음', () => {
    it('목 결과가 이미 workflow_name 을 갖고 있으면 DB 값으로 바뀌지 않는다', async () => {
      const memoryId = 'mem_no_overwrite_1009';

      db.prepare(`
        INSERT INTO memory_item (
          id, type, content, importance, created_at, workflow_name
        ) VALUES (?, 'procedural', 'overwrite guard', 0.8, CURRENT_TIMESTAMP, 'from-db')
      `).run(memoryId);

      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            ...stripHybridMetadata({
              id: memoryId,
              content: 'overwrite guard',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.9,
            }),
            workflow_name: 'from-search',
          },
        ],
        total_count: 1,
        query_time: 5,
      });

      const result = await tool.handle(
        {
          query: 'overwrite',
          type: 'procedural',
          include_metadata: true,
          limit: 3,
        },
        context,
      );
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].workflow_name).toBe('from-search');
    });
  });
});

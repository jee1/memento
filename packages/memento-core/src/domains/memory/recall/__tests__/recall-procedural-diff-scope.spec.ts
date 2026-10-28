import { it, expect, vi } from 'vitest';
import { describeRecallTool, db, tool, context, hybridSearchEngine } from './recall-tool.test-setup.js';

function insertProcedure(id: string, owner: string, version: number, deleted = false): void {
  db.prepare(`
    INSERT INTO memory_item (
      id, type, content, owner_id, task_goal, steps, version, version_series_id, is_deleted
    ) VALUES (?, 'procedural', 'scope procedure', ?, ?, ?, ?, 'scope-series', ?)
  `).run(id, owner, `${id} goal`, JSON.stringify([`${id} step`]), version, Number(deleted));
}

async function recall(includeDiffWith: string, boundAgentId?: string, includeVersionChain = false) {
  vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
    items: [{
      id: 'current', content: 'scope procedure', type: 'procedural', owner_id: 'owner-a',
      importance: 0.8, created_at: new Date().toISOString(), finalScore: 0.95,
    }],
    total_count: 1,
    query_time: 5,
  });
  const result = await tool.handle({
    query: 'scope procedure', type: 'procedural', include_metadata: true,
    include_diff_with: includeDiffWith, include_version_chain: includeVersionChain,
  }, { ...context, boundAgentId });
  const data = JSON.parse(result.content[0].text);
  expect(data.items).toHaveLength(1);
  return data.items[0];
}

describeRecallTool('procedural enrichment caller scope', () => {
  it('does not compare another owner’s procedure', async () => {
    insertProcedure('current', 'owner-a', 4);
    insertProcedure('foreign', 'owner-b', 3);

    const item = await recall('foreign', 'owner-a');

    expect(item.diff_with).toBeNull();
    expect(JSON.stringify(item)).not.toContain('foreign goal');
    expect(JSON.stringify(item)).not.toContain('foreign step');
  });

  it.each(['owner-a', undefined])('preserves authorized comparisons for caller %s', async (boundAgentId) => {
    insertProcedure('current', 'owner-a', 4);
    insertProcedure('target', boundAgentId ? 'owner-a' : 'owner-b', 3);

    const item = await recall('target', boundAgentId);

    expect(item.diff_with.task_goal.right).toBe('target goal');
    expect(item.diff_with.steps[0].right).toBe('target step');
  });

  it.each(['owner-a', undefined])('excludes deleted comparison targets for caller %s', async (boundAgentId) => {
    insertProcedure('current', 'owner-a', 4);
    insertProcedure('deleted', 'owner-a', 3, true);

    const item = await recall('deleted', boundAgentId);

    expect(item.diff_with).toBeNull();
  });

  it('scopes previous comparisons and version chains to active owned procedures', async () => {
    insertProcedure('current', 'owner-a', 4);
    insertProcedure('foreign', 'owner-b', 3);
    insertProcedure('deleted', 'owner-a', 2, true);
    insertProcedure('previous', 'owner-a', 1);

    const item = await recall('previous', 'owner-a', true);

    expect(item.version_chain.map((entry: { id: string }) => entry.id)).toEqual(['previous', 'current']);
    expect(item.diff_with_previous.left_id).toBe('previous');
    expect(item.diff_with_previous.task_goal.left).toBe('previous goal');
  });

  it('preserves the active cross-owner version chain for an unbound caller', async () => {
    insertProcedure('current', 'owner-a', 4);
    insertProcedure('foreign', 'owner-b', 3);
    insertProcedure('deleted', 'owner-a', 2, true);

    const item = await recall('previous', undefined, true);

    expect(item.version_chain.map((entry: { id: string }) => entry.id)).toEqual(['foreign', 'current']);
    expect(item.diff_with_previous.left_id).toBe('foreign');
  });

  it('returns no previous diff when only another owner’s older procedure remains', async () => {
    insertProcedure('current', 'owner-a', 4);
    insertProcedure('foreign', 'owner-b', 3);

    const item = await recall('previous', 'owner-a');

    expect(item.diff_with_previous).toBeNull();
  });
});

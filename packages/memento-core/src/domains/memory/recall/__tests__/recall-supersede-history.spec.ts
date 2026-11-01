import { expect, it, vi } from 'vitest';
import { SearchEngine } from '../../../search/algorithms/search-engine.js';
import { describeRecallTool, db, tool, context, hybridSearchEngine, anchorManager } from './recall-tool.test-setup.js';

describeRecallTool('#1552 explicit supersede history', () => {
  it('preserves current default and explicit scoped history through the public recall schema', async () => {
    db.exec(`INSERT INTO memory_item (id, type, content, owner_id, project_id, privacy_scope) VALUES
      ('history-old', 'semantic', 'historyneedle old', 'a', 'p', 'private'),
      ('history-target', 'semantic', 'historyneedle current', 'a', 'p', 'private'),
      ('history-foreign-owner', 'semantic', 'historyneedle foreign', 'b', 'p', 'private'),
      ('history-foreign-project', 'semantic', 'historyneedle foreign', 'a', 'q', 'private');
      UPDATE memory_item SET superseded_by = 'history-target' WHERE id = 'history-old';`);
    context.services.searchEngine = new SearchEngine(context.services.repositories!);
    const args = { query: 'historyneedle', type: 'semantic' as const, owner_id: 'a', project_id: 'p', enable_hybrid: false, auto_set_anchor: false, limit: 10 };
    const current = JSON.parse((await tool.handle(args, context)).content[0]!.text!);
    expect(current.items.map((item: { id: string }) => item.id)).toEqual(['history-target']);
    const history = JSON.parse((await tool.handle({ ...args, include_superseded: true }, context)).content[0]!.text!);
    expect(history.items.map((item: { id: string }) => item.id).sort()).toEqual(['history-old', 'history-target']);
    expect(history.filters_applied.include_superseded).toBe(true);
  });

  it('a historical top result does not rotate current anchors', async () => {
    db.exec(`INSERT INTO memory_item (id, type, content) VALUES
      ('history-old', 'semantic', 'old'), ('history-target', 'semantic', 'new');
      UPDATE memory_item SET superseded_by = 'history-target' WHERE id = 'history-old';`);
    await anchorManager.setAnchor('default', 'history-target', 'A');
    vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
      items: [{ id: 'history-old', type: 'semantic', content: 'old', score: 1 }], total_count: 1, query_time: 0,
    } as Awaited<ReturnType<typeof hybridSearchEngine.search>>);
    const result = JSON.parse((await tool.handle({ query: 'old', type: 'semantic', include_superseded: true, auto_set_anchor: true }, context)).content[0]!.text!);
    expect(result.items[0].id).toBe('history-old');
    expect(await anchorManager.getAnchor('default', 'A')).toMatchObject({ memory_id: 'history-target' });
    expect(await anchorManager.getAnchor('default', 'B')).toBeNull();
  });
});

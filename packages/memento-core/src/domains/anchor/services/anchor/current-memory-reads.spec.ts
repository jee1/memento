import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { setupTestDatabase } from '../../../../test/helpers/test-database.js';
import { AnchorManager } from './anchor-manager.js';
import { AnchorCacheService } from './anchor-cache-service.js';
import { AnchorSearchService } from './anchor-search-service.js';
import { SearchLocalTool } from '../../tools/search-local-tool.js';
import type { ToolContext } from '../../../../tools/types.js';
import { MemoryNeighborService } from '../../../memory/services/memory-neighbor-service.js';
import { AddRelationTool } from '../../../relation/tools/add-relation-tool.js';
import { ExtractRelationsTool } from '../../../relation/tools/extract-relations-tool.js';
import { RemoveRelationTool } from '../../../relation/tools/remove-relation-tool.js';
import { VisualizeRelationsTool } from '../../../relation/tools/visualize-relations-tool.js';
import { GetRelationsTool } from '../../../relation/tools/get-relations-tool.js';
import { createRelationGraph } from '../../../../infrastructure/relation-graph-factory.js';
import { RelationGraphQuery } from '../../../relation/services/relation-graph-query.js';
import { RelationGraphTraversal } from '../../../relation/services/relation-graph-traversal.js';
import { RelationGraphCache } from '../../../relation/services/relation-graph-cache.js';
import { NHopLinkedMemoryService } from './n-hop-linked-memory-service.js';
import { LocalSearchService } from './local-search-service.js';
import { NHopSearchService } from './n-hop-search-service.js';
import { QueryFilterService } from './query-filter-service.js';
import { FallbackSearchService } from './fallback-search-service.js';
import { findAnchorMemorySummaryById, findMemoryResourceRowById, listRecentMemoryResourceIds, queryMemoryGraphNodes } from '../../../memory/repositories/memory-item-repository.js';
import { buildMemoryFilterSql } from '../../../../shared/utils/memory-filter-sql.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { RecallSchema } from '../../../memory/recall/recall-tool-schema.js';

describe('#1552 current read contracts', () => {
  let db: Database.Database;
  let cache: AnchorCacheService;
  let manager: AnchorManager;
  let search: AnchorSearchService;

  beforeEach(async () => {
    db = await setupTestDatabase();
    db.exec(`INSERT INTO memory_item (id, type, content, owner_id, project_id, is_deleted) VALUES
      ('old', 'semantic', 'old body', 'a', 'p', 0),
      ('target', 'semantic', 'new body', 'a', 'p', 0),
      ('foreign', 'semantic', 'foreign body', 'b', 'q', 0),
      ('deleted', 'semantic', 'deleted body', 'a', 'p', 1);
      UPDATE memory_item SET superseded_by = 'target' WHERE id = 'old';`);
    cache = new AnchorCacheService();
    cache.setDatabase(db);
    search = new AnchorSearchService(cache, { db });
    manager = new AnchorManager(cache, search, { db });
  });
  afterEach(() => db.close());

  it('ID and Anchor Map reads hide stale/deleted and explicit history preserves scope', () => {
    expect(findMemoryResourceRowById(db, 'old', {})).toBeUndefined();
    expect(findMemoryResourceRowById(db, 'deleted', {})).toBeUndefined();
    expect(findAnchorMemorySummaryById(db, 'old', {})).toBeUndefined();
    expect(listRecentMemoryResourceIds(db, {}).map(row => row.id).sort()).toEqual(['foreign', 'target']);
    expect(findMemoryResourceRowById(db, 'old', { owner_id: 'a', project_id: 'p' }, true)?.id).toBe('old');
    expect(findMemoryResourceRowById(db, 'foreign', { owner_id: 'a', project_id: 'p' }, true)).toBeUndefined();
    expect(findMemoryResourceRowById(db, 'deleted', {}, true)).toBeUndefined();
  });

  it('admin graph count and candidates exclude stale before LIMIT', () => {
    const graph = queryMemoryGraphNodes(db, { limit: 10 });
    expect(graph.totalAvailableNodes).toBe(2);
    expect(graph.rawNodes.map(row => row.id).sort()).toEqual(['foreign', 'target']);
  });

  it('only explicit supersede history bypasses current state, retaining owner/project filters', () => {
    expect(RecallSchema.parse({ query: 'body', type: 'semantic', include_superseded: true }).include_superseded).toBe(true);
    expect(RecallSchema.safeParse({ query: 'body', type: 'semantic', include_superseded: 'true' }).success).toBe(false);
    const { clauses, params } = buildMemoryFilterSql({ include_superseded: true, owner_id: 'a', project_id: 'p' }, { itemAlias: 'm' });
    const ids = db.prepare(`SELECT m.id FROM memory_item m WHERE COALESCE(m.is_deleted, 0) = 0 AND ${clauses.join(' AND ')}`).all(...params) as Array<{ id: string }>;
    expect(ids.map(row => row.id).sort()).toEqual(['old', 'target']);
  });

  it.each(['graph', 'legacy'] as const)('filters stale/deleted linked %s results and stale seeds', async (mode) => {
    db.exec(`INSERT INTO memory_item (id, type, content) VALUES ('root', 'semantic', 'root');
      INSERT INTO memory_link (source_id, target_id, relation_type) VALUES
      ('root', 'old', 'cause_of'), ('root', 'target', 'cause_of'), ('root', 'deleted', 'cause_of');`);
    const relations = ['old', 'target', 'deleted'].map((id, i) => ({
      id: i, source_id: 'root', target_id: id, relation_type: 'supported_by' as const,
      confidence: 0.9, created_at: new Date(), updated_at: new Date(),
    }));
    const graph = mode === 'graph' ? {
      getRelations: async () => relations,
      getRelationsBatch: async (ids: string[]) => new Map(ids.map(id => [id, relations])),
    } : null;
    const links = new NHopLinkedMemoryService(cache, () => db, () => graph);
    const result = await links.getLinkedMemoriesBatch(['root']);
    expect(result.get('root')?.map(row => row.memory_id)).toEqual(['target']);
    expect((await links.getLinkedMemoriesBatch(['old'])).get('old')).toEqual([]);
  });

  it('relation query cache and BFS hide stale endpoints, refill limit and revive after restore', async () => {
    db.exec(`INSERT INTO memory_item (id, type, content) VALUES ('root', 'semantic', 'root');
      INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES
      ('root', 'old', 'supported_by', 1), ('root', 'target', 'supported_by', 0.9);`);
    const store = new Map();
    const cache = { get: (key: string) => store.get(key), set: (key: string, value: unknown) => store.set(key, value) } as ConstructorParameters<typeof RelationGraphCache>[0];
    const query = new RelationGraphQuery(db, new RelationGraphCache(cache, cache));
    const bfs = new RelationGraphTraversal(db);
    const reads = vi.spyOn(DatabaseUtils, 'all');
    expect((await query.getRelations('root', { limit: 1 })).map(row => row.target_id)).toEqual(['target']);
    const [, sql, params] = reads.mock.calls
      .find(([, statement]) => statement.includes('SELECT * FROM memory_relation'))!;
    reads.mockRestore();
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params!) as Array<{ detail: string }>;
    expect(plan.some(row => row.detail.includes('SEARCH memory_relation USING INDEX'))).toBe(true);
    expect(plan.some(row => /SCAN (?:mi|memory_item)\b/.test(row.detail))).toBe(false);
    expect((await query.getRelationsBatch(['root'])).get('root')?.map(row => row.target_id)).toEqual(['target']);
    expect((await bfs.getRelatedMemories('root', { maxHops: 2 })).map(row => row.memory_id)).toEqual(['target']);
    db.prepare("UPDATE memory_item SET superseded_by = NULL WHERE id = 'old'").run();
    expect((await query.getRelations('root', { limit: 1 })).map(row => row.target_id)).toEqual(['old']);
    db.prepare("UPDATE memory_item SET superseded_by = 'target' WHERE id = 'old'").run();
    expect((await query.getRelations('root', { limit: 1 })).map(row => row.target_id)).toEqual(['target']);
  });

  it('relation tool exposes history only explicitly and preserves token scope', async () => {
    db.exec(`INSERT INTO memory_item (id, type, content, owner_id, project_id) VALUES ('root', 'semantic', 'root', 'a', 'p');
      INSERT INTO memory_relation (source_id, target_id, relation_type) VALUES
      ('root', 'old', 'supported_by'), ('root', 'target', 'supported_by'), ('root', 'foreign', 'supported_by');`);
    const context = { db, boundAgentId: 'a', boundProjectId: 'p', services: { relationGraph: createRelationGraph(db) } };
    const tool = new GetRelationsTool();
    const current = JSON.parse((await tool.handle({ memory_id: 'root' }, context)).content[0]!.text!);
    expect(current.relations.map((row: { target_id: string }) => row.target_id)).toEqual(['target']);
    const history = JSON.parse((await tool.handle({ memory_id: 'root', include_superseded: true }, context)).content[0]!.text!);
    expect(history.relations.map((row: { target_id: string }) => row.target_id).sort()).toEqual(['old', 'target']);
    expect(JSON.parse((await tool.handle({ memory_id: 'old' }, context)).content[0]!.text!).error).toBe('MEMORY_NOT_FOUND');
  });

  it('relation mutations reject stale endpoints and visualization allows explicit history', async () => {
    const relationId = Number(db.prepare("INSERT INTO memory_relation (source_id, target_id, relation_type) VALUES ('old', 'target', 'supported_by')").run().lastInsertRowid);
    const context = { db, boundAgentId: 'a', boundProjectId: 'p', services: { relationGraph: createRelationGraph(db) } };
    const add = await new AddRelationTool().handle({ source_id: 'old', target_id: 'target', relation_type: 'REFERENCES' }, context);
    expect(JSON.parse(add.content[0]!.text!).error).toBe('SOURCE_MEMORY_NOT_FOUND');
    const extract = await new ExtractRelationsTool().handle({ memory_id: 'old' }, context);
    expect(JSON.parse(extract.content[0]!.text!).error).toBe('MEMORY_NOT_FOUND');
    const remove = await new RemoveRelationTool().handle({ relation_id: relationId }, context);
    expect(JSON.parse(remove.content[0]!.text!).error).toBe('RELATION_NOT_FOUND');
    const visualize = new VisualizeRelationsTool();
    expect(JSON.parse((await visualize.handle({ memory_id: 'old' }, context)).content[0]!.text!).error).toBe('MEMORY_NOT_FOUND');
    const history = JSON.parse((await visualize.handle({ memory_id: 'old', include_superseded: true }, context)).content[0]!.text!);
    expect(history.relation_count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) FROM memory_relation').pluck().get()).toBe(1);
  });

  it('neighbor lookup rejects a stale seed before embedding or vector work', async () => {
    const vector = { setDatabase: vi.fn(), search: vi.fn() };
    const service = new MemoryNeighborService(
      vector as unknown as ConstructorParameters<typeof MemoryNeighborService>[0],
      {} as ConstructorParameters<typeof MemoryNeighborService>[1], db,
    );
    await expect(service.getNeighbors('old', { scope: { owner_id: 'a', project_id: 'p' } })).rejects.toThrow('not found');
    expect(vector.search).not.toHaveBeenCalled();
  });

  it('search_local removes stale candidates and predecessors before the final limit', async () => {
    const local = (search as unknown as { localSearchService: LocalSearchService }).localSearchService;
    vi.spyOn(local, 'performNHopSearch').mockResolvedValue(['old', 'target'].map(id => ({
      memory_id: id, content: id, type: 'semantic', similarity: 0.9, hop_distance: 1,
      importance: 0.5, created_at: '', predecessor_id: 'old', predecessor_ids: ['old', 'target'],
    })));
    const result = await search.searchLocal('a', 'A', undefined, 1,
      { limit: 1, min_results: 0, owner_id: 'a' }, 'target', null, Date.now());
    expect(result.items.map(item => item.id)).toEqual(['target']);
    expect(result.items[0]?.predecessor_id).toBeUndefined();
    expect(result.items[0]?.predecessor_ids).toEqual(['target']);
  });

  it('search_local rejects an anchor seed outside a project-only scope', async () => {
    await expect(search.searchLocal('a', 'A', undefined, 1,
      { min_results: 0, ...{ project_id: 'q' } }, 'target', null, Date.now())).rejects.toThrow('not found');
  });

  it('uses the same absent-anchor response for empty, replaced and out-of-scope slots', async () => {
    const failures: Array<{ name: string; message: string }> = [];
    const fallback = vi.fn().mockResolvedValue({ items: [], total_count: 0, query_time: 0 });
    const tool = new SearchLocalTool();
    const context = { db, boundAgentId: 'a', boundProjectId: 'p', services: {
      anchorManager: manager, hybridSearchEngine: { search: fallback },
    } } as unknown as ToolContext;
    const responses = [];
    for (const memoryId of [null, 'old', 'foreign']) {
      db.prepare('DELETE FROM anchor').run();
      if (memoryId) db.prepare("INSERT INTO anchor (agent_id, slot, memory_id) VALUES ('a', 'A', ?)").run(memoryId);
      const error = await manager.searchLocal('a', 'A', undefined, 1,
        { min_results: 0, owner_id: 'a', project_id: 'p' }).then(() => null, (error: Error) => error);
      expect(error).toBeInstanceOf(Error);
      failures.push({ name: error!.name, message: error!.message });
      responses.push(await tool.handle({ slot: 'A', query: 'body' }, context));
    }
    expect(responses).toEqual(Array(3).fill(responses[0]));
    expect(JSON.parse(responses[0]!.content[0]!.text!)).toMatchObject({ fallback_used: true, items: [] });
    expect(fallback).toHaveBeenCalledTimes(3);
    for (const [, options] of fallback.mock.calls) expect(options.filters).toEqual({ owner_id: 'a', project_id: 'p' });
    expect(failures).toEqual(Array(3).fill({
      name: 'AnchorNotFoundError', message: 'Anchor not found for agent_id: a, slot: A',
    }));
  });

  it.each(['graph', 'legacy'] as const)('search_local preserves a scoped fresh top-1 before hop limits (%s)', async mode => {
    db.exec(`INSERT INTO memory_item (id, type, content, owner_id, project_id) VALUES
      ('other-project', 'semantic', 'foreign project', 'a', 'q'),
      ('other-project-2', 'semantic', 'foreign project 2', 'a', 'q'),
      ('other-project-3', 'semantic', 'foreign project 3', 'a', 'q'),
      ('fresh', 'semantic', 'fresh', 'a', 'p');`);
    if (mode === 'graph') {
      db.exec(`INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES
        ('target', 'other-project', 'supported_by', 1),
        ('target', 'other-project-2', 'supported_by', 1), ('target', 'other-project-3', 'supported_by', 1),
        ('target', 'old', 'supported_by', 0.99),
        ('target', 'fresh', 'supported_by', 0.7);`);
      search.setRelationGraph(createRelationGraph(db));
    } else {
      db.exec(`INSERT INTO memory_link (source_id, target_id, relation_type) VALUES
        ('target', 'other-project', 'cause_of'), ('target', 'other-project-2', 'cause_of'),
        ('target', 'other-project-3', 'cause_of'), ('target', 'old', 'cause_of'), ('target', 'fresh', 'cause_of');`);
    }
    const result = await search.searchLocal('a', 'A', undefined, 1,
      { limit: 1, min_results: 0, owner_id: 'a', ...{ project_id: 'p' } }, 'target', null, Date.now());
    expect(result.items.map(item => item.id)).toEqual(['fresh']);
  });

  it('rejects stale/deleted anchor assignment', async () => {
    await expect(manager.setAnchor('agent', 'old', 'A')).rejects.toThrow();
    await expect(manager.setAnchor('agent', 'deleted', 'A')).rejects.toThrow();
  });

  it.each(['cold', 'warm'] as const)('hides %s anchors without deleting rows and revives after target deletion', async (mode) => {
    db.prepare("INSERT INTO anchor (agent_id, slot, memory_id) VALUES ('agent', 'A', 'old')").run();
    if (mode === 'warm') cache.updateCache('agent', 'A', 'old');
    expect(await manager.getAnchor('agent', 'A')).toBeNull();
    expect((await manager.getAnchor('agent')) ?? []).toEqual([]);
    expect(db.prepare('SELECT memory_id FROM anchor').get()).toEqual({ memory_id: 'old' });
    db.prepare("UPDATE memory_item SET is_deleted = 1 WHERE id = 'target'").run();
    expect(await manager.getAnchor('agent', 'A')).toMatchObject({ memory_id: 'old' });
    db.prepare("UPDATE memory_item SET is_deleted = 0 WHERE id = 'target'").run();
    expect(await manager.getAnchor('agent', 'A')).toBeNull();
    db.prepare("DELETE FROM memory_item WHERE id = 'target'").run();
    expect(await manager.getAnchor('agent', 'A')).toMatchObject({ memory_id: 'old' });
  });

  it('cached embeddings, local seeds and reanchor scoring reject a replaced memory', async () => {
    const embedding = Buffer.from(new Float32Array([1, 0]).buffer);
    db.prepare("INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions) VALUES ('old', 'tfidf', 'native', ?, 2, 2)").run(embedding);
    db.prepare("INSERT INTO anchor (agent_id, slot, memory_id) VALUES ('agent', 'A', 'old')").run();
    const local = new LocalSearchService(cache, new NHopSearchService(cache), new QueryFilterService(cache), new FallbackSearchService());
    local.setDatabase(db);
    expect(await cache.getAnchorEmbedding('old')).toBeNull();
    expect(await local.getAnchorWithEmbedding('agent', 'A')).toBeNull();
    expect(await search.calculateReanchorScore('old')).toBe(0);
    await expect(search.searchLocal('agent', 'A', undefined, 1, { min_results: 0 }, 'old', null, Date.now())).rejects.toThrow();
  });
});

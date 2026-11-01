/**
 * Relation tools and search_local read only live memories inside the caller's
 * bound owner and project. Unbound callers keep every live memory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { setupTestDatabase } from '../../test/helpers/test-database.js';
import type { ToolContext } from '../types.js';
import { createRelationGraph } from '../../infrastructure/relation-graph-factory.js';
import { GetRelationsTool } from '../../domains/relation/tools/get-relations-tool.js';
import { VisualizeRelationsTool } from '../../domains/relation/tools/visualize-relations-tool.js';
import { AddRelationTool } from '../../domains/relation/tools/add-relation-tool.js';
import { RemoveRelationTool } from '../../domains/relation/tools/remove-relation-tool.js';
import { ExtractRelationsTool } from '../../domains/relation/tools/extract-relations-tool.js';
import { RelationExtractor } from '../../domains/relation/services/relation-extractor.js';
import { AnchorSearchService } from '../../domains/anchor/services/anchor/anchor-search-service.js';
import { ExportMemoriesTool } from '../../domains/memory/tools/export-memories-tool.js';
import { filterCallerOwnedIds } from '../caller-scope.js';
import type { IAnchorCacheService } from '../../domains/anchor/services/anchor/anchor-interfaces.js';

const ROWS = [
  { id: 'root', owner: 'agent-a', project: 'proj-1', deleted: 0 },
  { id: 'same-scope', owner: 'agent-a', project: 'proj-1', deleted: 0 },
  { id: 'other-owner', owner: 'agent-b', project: 'proj-1', deleted: 0 },
  { id: 'other-project', owner: 'agent-a', project: 'proj-2', deleted: 0 },
  { id: 'removed', owner: 'agent-a', project: 'proj-1', deleted: 1 },
];
const RELATED = ROWS.filter((row) => row.id !== 'root').map((row) => row.id);

function payload(result: { content: Array<{ text?: string }> }) {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('relation tools and search_local honour the caller scope', () => {
  let db: Database.Database;
  let relationGraph: ReturnType<typeof createRelationGraph>;

  beforeEach(async () => {
    db = await setupTestDatabase();
    const insert = db.prepare(
      `INSERT INTO memory_item (id, type, content, owner_id, project_id, is_deleted) VALUES (?, 'semantic', ?, ?, ?, ?)`,
    );
    for (const row of ROWS) insert.run(row.id, `content ${row.id}`, row.owner, row.project, row.deleted);
    const relate = db.prepare(
      `INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES ('root', ?, 'REFERENCES', 0.9)`,
    );
    for (const id of RELATED) relate.run(id);
    relationGraph = createRelationGraph(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  const bound = () => ({ db, boundAgentId: 'agent-a', boundProjectId: 'proj-1', services: { relationGraph } }) as unknown as ToolContext;
  const unbound = () => ({ db, services: { relationGraph } }) as unknown as ToolContext;

  const relatedIds = async (context: ToolContext, memory_id = 'root') => {
    const body = payload(await new GetRelationsTool().handle({ memory_id }, context));
    return ((body.relations ?? []) as Array<{ target_id: string }>).map((relation) => relation.target_id).sort();
  };

  it('get_relations keeps live relations inside the bound owner and project', async () => {
    expect(await relatedIds(bound())).toEqual(['same-scope']);
    expect(await relatedIds(unbound())).toEqual(['other-owner', 'other-project', 'same-scope']);
  });

  it('get_relations reports a soft-deleted or out-of-scope root as not found', async () => {
    db.prepare(`UPDATE memory_item SET is_deleted = 1 WHERE id = 'root'`).run();
    expect(payload(await new GetRelationsTool().handle({ memory_id: 'root' }, unbound()))).toMatchObject({ error: expect.stringMatching(/NOT_FOUND/) });
  });

  it('visualize_relations draws only live relations inside the scope', async () => {
    const draw = async (context: ToolContext) =>
      String(payload(await new VisualizeRelationsTool().handle({ memory_id: 'root', format: 'json', show_memory_ids: true }, context)).visualization);

    const scoped = await draw(bound());
    expect(scoped).toContain('same-scope');
    for (const id of ['other-owner', 'other-project', 'removed']) expect(scoped).not.toContain(id);
    expect(await draw(unbound())).not.toContain('removed');
  });

  it('add_relation refuses a target outside the scope or soft-deleted', async () => {
    const add = async (context: ToolContext, target_id: string) =>
      payload(await new AddRelationTool().handle({ source_id: 'root', target_id, relation_type: 'CAUSES' }, context));

    expect(await add(bound(), 'other-project')).toMatchObject({ error: 'TARGET_MEMORY_NOT_FOUND' });
    expect(await add(unbound(), 'removed')).toMatchObject({ error: 'TARGET_MEMORY_NOT_FOUND' });
    expect(await add(bound(), 'same-scope')).not.toHaveProperty('error');
  });

  it('remove_relation refuses a relation that reaches outside the bound project', async () => {
    const result = payload(await new RemoveRelationTool().handle(
      { source_id: 'root', target_id: 'other-project', relation_type: 'REFERENCES' },
      bound(),
    ));
    expect(result).toMatchObject({ error: expect.stringMatching(/NOT_FOUND/) });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM memory_relation WHERE target_id = 'other-project'`).get()).toEqual({ n: 1 });
  });

  it('extract_relations offers only live memories inside the scope as candidates', async () => {
    const extract = vi.spyOn(RelationExtractor.prototype, 'extractRelations').mockResolvedValue([]);

    await new ExtractRelationsTool().handle({ memory_id: 'root' }, bound());
    expect((extract.mock.calls[0]?.[1] ?? []).map((item) => item.id).sort()).toEqual(['same-scope']);

    await new ExtractRelationsTool().handle({ memory_id: 'root' }, unbound());
    expect((extract.mock.calls[1]?.[1] ?? []).map((item) => item.id).sort()).toEqual(['other-owner', 'other-project', 'same-scope']);
  });

  it('export writes only live memories inside the bound owner and project', async () => {
    const exported = async (context: ToolContext) => {
      const text = String(payload(await new ExportMemoriesTool().handle({ format: 'jsonl' }, context)).content ?? '');
      return text.split('\n').filter(Boolean).map((line) => (JSON.parse(line) as { id: string }).id).sort();
    };
    expect(await exported(bound())).toEqual(['root', 'same-scope']);
    expect(await exported(unbound())).toEqual(['other-owner', 'other-project', 'root', 'same-scope']);
  });

  it('owner checks for bound callers skip soft-deleted memories', () => {
    expect([...filterCallerOwnedIds(bound(), ['same-scope', 'removed', 'other-owner'])]).toEqual(['same-scope']);
  });

  describe('search_local', () => {
    async function searchIds(options: { owner_id?: string; project_id?: string }) {
      const service = new AnchorSearchService({} as IAnchorCacheService, { db });
      const hops = RELATED.map((id, i) => ({
        memory_id: id, content: id, type: 'semantic', similarity: 0.9 - i * 0.01, hop_distance: 1, importance: 0.5, created_at: '',
        predecessor_id: 'removed',
      }));
      const local = (service as unknown as { localSearchService: { performNHopSearch: () => Promise<unknown> } }).localSearchService;
      vi.spyOn(local, 'performNHopSearch').mockResolvedValue(hops);
      const result = await service.searchLocal('agent-a', 'A', undefined, 1, { limit: 10, min_results: 0, ...options }, 'root', null, Date.now());
      return result.items;
    }

    it('drops hop results outside the bound owner and project or soft-deleted', async () => {
      expect((await searchIds({ owner_id: 'agent-a', project_id: 'proj-1' })).map((item) => item.id)).toEqual(['same-scope']);
    });

    it('keeps other owners and projects for unbound callers but never soft-deleted memories or predecessors', async () => {
      const items = await searchIds({});
      expect(items.map((item) => item.id).sort()).toEqual(['other-owner', 'other-project', 'same-scope']);
      expect(items.every((item) => item.predecessor_id === undefined)).toBe(true);
    });
  });
});

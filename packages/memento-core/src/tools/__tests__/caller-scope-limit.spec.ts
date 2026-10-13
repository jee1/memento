/**
 * A token-bound caller must get up to `limit` of its own memories even when
 * other owners' memories rank higher — the owner filter has to run before the
 * limit, not after it (#1342).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { setupTestDatabase } from '../../test/helpers/test-database.js';
import type { ToolContext } from '../types.js';
import { MetaMemoryService } from '../../domains/memory/introspection/meta-memory-service.js';
import { GetMetaMemoryStatsTool } from '../../domains/monitoring/tools/get-meta-memory-stats-tool.js';
import { AnchorSearchService } from '../../domains/anchor/services/anchor/anchor-search-service.js';
import type { IAnchorCacheService } from '../../domains/anchor/services/anchor/anchor-interfaces.js';
import { GetMemoryNeighborsTool } from '../../domains/memory/tools/get-memory-neighbors-tool.js';
import { MemoryNeighborService } from '../../domains/memory/services/memory-neighbor-service.js';

const OTHER = ['mem_b1', 'mem_b2', 'mem_b3'];
const OWN = ['mem_a1', 'mem_a2'];

function payload(result: { content: Array<{ text?: string }> }) {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('bound caller gets limit results (#1342)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
    const insert = db.prepare(`INSERT INTO memory_item (id, type, content, owner_id) VALUES (?, 'semantic', 'x', ?)`);
    for (const id of OTHER) insert.run(id, 'agent-b');
    for (const id of OWN) insert.run(id, 'agent-a');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it('get_meta_memory_stats scopes by owner before LIMIT', async () => {
    const service = new MetaMemoryService(db);
    const stat = db.prepare(
      `INSERT INTO meta_memory_stats (memory_id, recall_count, success_count, failure_count, avg_confidence) VALUES (?, ?, 0, 0, 0.5)`,
    );
    for (const id of OTHER) stat.run(id, 10);
    for (const id of OWN) stat.run(id, 1);
    const context = { db, boundAgentId: 'agent-a', services: { metaMemoryService: service } } as unknown as ToolContext;

    const body = payload(await new GetMetaMemoryStatsTool().handle({ limit: 2 }, context));

    expect((body.items as Array<{ memory_id: string }>).map((i) => i.memory_id).sort()).toEqual(OWN);
    expect(body.total_count).toBe(2);
  });

  it('searchLocal scopes hop results by owner before slicing to limit', async () => {
    const service = new AnchorSearchService({} as IAnchorCacheService, { db });
    const hops = [...OTHER, ...OWN].map((id, i) => ({
      memory_id: id, content: 'x', type: 'semantic', similarity: 0.9 - i * 0.01, hop_distance: 1, importance: 0.5, created_at: '',
    }));
    const local = (service as unknown as { localSearchService: { performNHopSearch: () => Promise<unknown> } }).localSearchService;
    vi.spyOn(local, 'performNHopSearch').mockResolvedValue(hops);

    const result = await service.searchLocal('agent-a', 'A', undefined, 1, { limit: 2, min_results: 0, owner_id: 'agent-a' }, 'mem_a1', null, Date.now());

    expect(result.items.map((i) => i.id)).toEqual(OWN);
  });

  it('get_memory_neighbors passes the bound owner into the neighbor search', async () => {
    const getNeighbors = vi.spyOn(MemoryNeighborService.prototype, 'getNeighbors')
      .mockResolvedValue({ memory_id: 'mem_a1', neighbors: [], total_count: 0, query_time: 0 });
    const context = { db, boundAgentId: 'agent-a', services: { vectorSearchEngine: {}, embeddingService: {} } } as unknown as ToolContext;

    await new GetMemoryNeighborsTool().handle({ memory_id: 'mem_a1' }, context);

    expect(getNeighbors).toHaveBeenCalledWith('mem_a1', expect.objectContaining({ owner_id: 'agent-a' }));
  });
});

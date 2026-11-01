import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeDatabase } from '../../../../infrastructure/database/sqlite/init.js';
import { MINILM_MODEL_NAME } from '../../../../shared/config/embedding-models.js';
import { encodeFloat32Embedding } from '../../../../shared/utils/embedding-serialization.js';
import { MemoryNeighborService, MemoryNotFoundError } from '../memory-neighbor-service.js';
import { getVectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';
import { MemoryEmbeddingService } from '../../../embedding/services/memory-embedding-service.js';
import { handleIncludeNeighbors, type RecallNeighborsContext } from '../../recall/recall-tool-neighbors-fetch.js';
import type { RecallToolHost } from '../../recall/recall-tool-host.js';

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
  env: { useBrowserCache: false, useCustomCache: false },
}));

const ROWS = [
  { id: 'root', owner: 'agent-a', project: 'proj-1', deleted: 0 },
  { id: 'same-scope', owner: 'agent-a', project: 'proj-1', deleted: 0 },
  { id: 'other-owner', owner: 'agent-b', project: 'proj-1', deleted: 0 },
  { id: 'other-project', owner: 'agent-a', project: 'proj-2', deleted: 0 },
  { id: 'soft-deleted', owner: 'agent-a', project: 'proj-1', deleted: 1 },
];

describe('memory neighbors honour the caller scope', () => {
  let dir: string;
  let db: Database.Database;
  let vectorSearchEngine: ReturnType<typeof getVectorSearchEngine>;
  let embeddingService: MemoryEmbeddingService;
  let service: MemoryNeighborService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'neighbor-scope-'));
    db = await initializeDatabase(join(dir, 'memory.db'));
    vectorSearchEngine = getVectorSearchEngine();
    vectorSearchEngine.initialize(db);
    embeddingService = new MemoryEmbeddingService();
    service = new MemoryNeighborService(vectorSearchEngine, embeddingService, db);

    const vector = new Array<number>(384).fill(0);
    vector[0] = 1;
    const blob = encodeFloat32Embedding(vector);
    for (const row of ROWS) {
      db.prepare(
        `INSERT INTO memory_item (id, type, content, importance, privacy_scope, owner_id, project_id, is_deleted)
         VALUES (?, 'semantic', ?, 0.5, 'private', ?, ?, ?)`,
      ).run(row.id, `content ${row.id}`, row.owner, row.project, row.deleted);
      db.prepare(
        `INSERT INTO memory_embedding
           (memory_id, embedding_provider, projection_type, embedding, dim, model, dimensions, precision, normalized, version, created_by)
         VALUES (?, 'minilm', 'native', ?, 384, ?, 384, 32, 1, 1, 'test')`,
      ).run(row.id, blob, MINILM_MODEL_NAME);
    }
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const neighborIds = async (scope: { owner_id?: string; project_id?: string }) =>
    (await service.getNeighbors('root', { limit: 10, similarity_threshold: 0, scope })).neighbors
      .map((neighbor) => neighbor.id)
      .sort();

  it('returns only neighbors in the bound owner and project', async () => {
    expect(await neighborIds({ owner_id: 'agent-a', project_id: 'proj-1' })).toEqual(['same-scope']);
    expect(await neighborIds({ owner_id: 'agent-a' })).toEqual(['other-project', 'same-scope']);
  });

  it('keeps unscoped access for unbound callers and still skips deleted memories', async () => {
    expect(await neighborIds({})).toEqual(['other-owner', 'other-project', 'same-scope']);
  });

  it('reports a root outside the scope as not found', async () => {
    await expect(service.getNeighbors('root', { scope: { owner_id: 'agent-b' } })).rejects.toBeInstanceOf(
      MemoryNotFoundError,
    );
    await expect(service.getNeighbors('root', { scope: { project_id: 'proj-2' } })).rejects.toBeInstanceOf(
      MemoryNotFoundError,
    );
  });

  it('refuses a call that does not state a scope', async () => {
    await expect(
      service.getNeighbors('root', {} as Parameters<MemoryNeighborService['getNeighbors']>[1]),
    ).rejects.toThrow(/scope/);
  });

  describe('recall include_neighbors', () => {
    const host = { logWarning: vi.fn(), logError: vi.fn() } as unknown as RecallToolHost;

    const recallNeighborIds = async (bound: { boundAgentId?: string; boundProjectId?: string }) => {
      const context = {
        db,
        ...bound,
        services: { vectorSearchEngine, embeddingService },
      } as unknown as RecallNeighborsContext;
      const [neighbors] = await handleIncludeNeighbors(host, [{ id: 'root' } as never], 1, 10, 0, context);
      return (neighbors ?? []).map((neighbor) => neighbor.id).sort();
    };

    it('scopes neighbors to the token-bound owner and project', async () => {
      expect(await recallNeighborIds({ boundAgentId: 'agent-a', boundProjectId: 'proj-1' })).toEqual(['same-scope']);
    });

    it('leaves unbound callers unchanged', async () => {
      expect(await recallNeighborIds({})).toEqual(['other-owner', 'other-project', 'same-scope']);
    });
  });
});

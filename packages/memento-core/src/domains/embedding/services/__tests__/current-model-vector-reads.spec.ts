/**
 * #1731, #1732: 저장 벡터를 직접 읽는 경로는 벡터 검색(#889)과 같은 규칙을 따라야 한다.
 * native 행만 읽고, 모델을 거르는 provider(minilm)는 지금 모델로 만든 행만 쓴다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeDatabase } from '../../../../infrastructure/database/sqlite/init.js';
import { MINILM_MODEL_NAME } from '../../../../shared/config/embedding-models.js';
import { encodeFloat32Embedding } from '../../../../shared/utils/embedding-serialization.js';
import { MemoryNeighborService } from '../../../memory/services/memory-neighbor-service.js';
import { getVectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';
import { backfillTextOnlyVectorResults } from '../../../search/algorithms/hybrid-vector-backfill.js';
import { AnchorCacheService } from '../../../anchor/services/anchor/anchor-cache-service.js';
import { ConsolidationRepository } from '../../../consolidation/repositories/consolidation-repository.js';
import { MemoryEmbeddingService } from '../memory-embedding-service.js';

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
  env: { useBrowserCache: false, useCustomCache: false },
}));

const OLD_MODEL = 'all-MiniLM-L6-v2';

function unit(axis: number): number[] {
  const vector = new Array<number>(384).fill(0);
  vector[axis] = 1;
  return vector;
}

describe('stored vector reads use the current-model native row', () => {
  let dir: string;
  let db: Database.Database;

  const insertMemory = (id: string) =>
    db.prepare(
      `INSERT INTO memory_item (id, type, content, importance, privacy_scope)
       VALUES (?, 'semantic', ?, 0.5, 'private')`,
    ).run(id, `content ${id}`);

  const insertEmbedding = (id: string, projection: string, vector: number[], model: string, createdAt: string) =>
    db.prepare(
      `INSERT INTO memory_embedding
         (memory_id, embedding_provider, projection_type, embedding, dim, model, dimensions, precision, normalized, version, created_by, created_at)
       VALUES (?, 'minilm', ?, ?, 384, ?, 384, 32, 1, 1, 'test', ?)`,
    ).run(id, projection, encodeFloat32Embedding(vector), model, createdAt);

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'current-model-reads-'));
    db = await initializeDatabase(join(dir, 'memory.db'));
    for (const id of ['root', 'near-native', 'near-window', 'stale']) insertMemory(id);
    // root: native(e0) 뒤에 창 행(e1)이 쓰인 긴 기억. 창 행이 created_at 으로 더 최근이다.
    insertEmbedding('root', 'native', unit(0), MINILM_MODEL_NAME, '2026-01-01 00:00:00');
    insertEmbedding('root', 'window:0', unit(1), MINILM_MODEL_NAME, '2026-01-01 00:00:05');
    insertEmbedding('root', 'window:1', unit(1), MINILM_MODEL_NAME, '2026-01-01 00:00:05');
    insertEmbedding('near-native', 'native', unit(0), MINILM_MODEL_NAME, '2026-01-01 00:00:00');
    insertEmbedding('near-window', 'native', unit(1), MINILM_MODEL_NAME, '2026-01-01 00:00:00');
    // stale: 재색인 전의 옛 모델 행만 있는 기억.
    insertEmbedding('stale', 'native', unit(0), OLD_MODEL, '2026-01-01 00:00:00');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const neighborIds = async (id: string) => {
    const engine = getVectorSearchEngine();
    engine.initialize(db);
    const service = new MemoryNeighborService(engine, new MemoryEmbeddingService(), db);
    const { neighbors } = await service.getNeighbors(id, { limit: 10, similarity_threshold: 0.8, scope: {} });
    return neighbors.map((neighbor) => neighbor.id).sort();
  };

  it('neighbors of a long memory are found with its native vector, not a window vector', async () => {
    expect(await neighborIds('root')).toEqual(['near-native']);
  });

  it('a memory with only an old-model vector has no neighbors yet', async () => {
    expect(await neighborIds('stale')).toEqual([]);
  });

  it('the anchor cache returns the native vector and skips old-model rows', async () => {
    const cache = new AnchorCacheService(db);
    expect((await cache.getAnchorEmbedding('root'))?.embedding).toEqual(unit(0));
    expect(await cache.getAnchorEmbedding('stale')).toBeNull();
  });

  it('consolidation loads only current-model vectors', () => {
    const vectors = new ConsolidationRepository(db).loadEmbeddingsMap(['stale', 'near-native'], { provider: 'minilm' });
    expect([...vectors.keys()]).toEqual(['near-native']);
  });

  it('the text-only backfill ignores old-model rows', () => {
    const backfilled = backfillTextOnlyVectorResults(
      db,
      [{ id: 'stale', content: 'content stale' }, { id: 'near-native', content: 'content near-native' }],
      [],
      [{ provider: 'minilm', embedding: unit(0) }],
    );
    expect(backfilled.map((result) => result.id)).toEqual(['near-native']);
  });

  it('the fallback similarity search ignores old-model rows', async () => {
    const service = new MemoryEmbeddingService();
    const unified = service.getUnifiedEmbeddingService();
    vi.spyOn(unified, 'isAvailable').mockReturnValue(true);
    vi.spyOn(unified, 'generateEmbedding').mockResolvedValue({
      embedding: unit(0),
      model: MINILM_MODEL_NAME,
      provider: 'minilm',
      usage: { prompt_tokens: 1, total_tokens: 1 },
    });
    const { results } = await service.searchBySimilarity(db, 'query', { limit: 10 });
    const ids = results.map((result) => result.id);
    expect(ids).toContain('near-native');
    expect(ids).not.toContain('stale');
  });
});

/**
 * #1729: 기억끼리 기준값으로 정한 결과를 고정 fixture 로 남긴다.
 * 코사인은 지금 기준값 바로 위와 아래의 고정 값이다. 전환 PR 이 기준값을 바꾸면 여기 기대가 함께 바뀐다.
 */

import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_EMBEDDING_MODEL } from '../embedding-models.js';
import { initializeDatabase } from '../../../infrastructure/database/sqlite/init.js';
import { encodeFloat32Embedding } from '../../utils/embedding-serialization.js';
import { ClusteringService } from '../../../domains/consolidation/services/clustering-service.js';
import { SleepConsolidationService } from '../../../domains/consolidation/services/sleep-consolidation-service.js';
import { MemoryNeighborService } from '../../../domains/memory/services/memory-neighbor-service.js';
import { MemoryEmbeddingService } from '../../../domains/embedding/services/memory-embedding-service.js';
import { getVectorSearchEngine } from '../../../domains/search/algorithms/vector-search-engine.js';

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
  env: { useBrowserCache: false, useCustomCache: false },
}));

const DIMENSIONS = 384;
/** 첫 축과 코사인이 cosine 인 단위 벡터. axis 가 다르면 서로의 코사인은 두 cosine 의 곱이다. */
function atCosine(cosine: number, axis: number): number[] {
  const values = new Array<number>(DIMENSIONS).fill(0);
  values[0] = cosine;
  values[axis] = Math.sqrt(1 - cosine * cosine);
  return values;
}

const SEED = atCosine(1, 1);

describe('기억끼리 기준값 fixture (#1729)', () => {
  it('Sleep consolidation 군집: 0.678 은 묶고 0.658 은 뺀다(consolidationCluster 0.668)', () => {
    const item = (id: string, embedding: number[]) => ({
      row: { id, content: id, importance: 0.5, ownerId: null, createdAt: '2026-01-01', pinned: false, isConsolidated: false },
      embedding,
    });

    const clusters = new ClusteringService().clusterGroup([
      item('a-seed', SEED),
      item('b-above', atCosine(0.678, 2)),
      item('c-below', atCosine(0.658, 3)),
    ]);

    expect(clusters.map((cluster) => cluster.episodicIds.slice().sort())).toEqual([['a-seed', 'b-above']]);
  });

  it('요약 합침 대상: 0.804 는 고르고 0.784 는 버린다(consolidationMerge 0.794)', async () => {
    const findMergeTarget = (semantics: Array<{ id: string; embedding: number[] }>) => {
      const service = new SleepConsolidationService({} as Database.Database, {
        relationGraph: {} as never,
        consolidationRepository: {
          findSemanticsByOwner: () => semantics.map((s) => ({ ...s, content: s.id, originSource: '{}' })),
        } as never,
        memoryEmbeddingService: {
          getUnifiedEmbeddingService: () => ({
            generateEmbedding: async () => ({ embedding: SEED, provider: 'minilm', model: 'm' }),
          }),
        } as never,
      });
      return (service as unknown as {
        findMergeTarget: (clusterId: string, ownerId: string | null, summary: string) => Promise<{ id: string } | null>;
      }).findMergeTarget('cluster-1', null, 'summary');
    };

    expect((await findMergeTarget([{ id: 'above', embedding: atCosine(0.804, 2) }]))?.id).toBe('above');
    expect(await findMergeTarget([{ id: 'below', embedding: atCosine(0.784, 2) }])).toBeNull();
  });

  describe('이웃 기억', () => {
    let dir: string | undefined;
    let db: Database.Database | undefined;

    afterEach(() => {
      db?.close();
      db = undefined;
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    });

    it('이웃 기본 임계값: 0.755 는 이웃이고 0.735 는 아니다(neighbor 0.745)', async () => {
      dir = mkdtempSync(join(tmpdir(), 'memory-similarity-neighbor-'));
      db = await initializeDatabase(join(dir, 'memory.db'));
      const rows: Array<[string, number[]]> = [
        ['root', SEED],
        ['above', atCosine(0.755, 2)],
        ['below', atCosine(0.735, 3)],
      ];
      for (const [id, vector] of rows) {
        db.prepare(
          `INSERT INTO memory_item (id, type, content, importance, privacy_scope) VALUES (?, 'semantic', ?, 0.5, 'private')`
        ).run(id, `content ${id}`);
        db.prepare(
          `INSERT INTO memory_embedding
             (memory_id, embedding_provider, projection_type, embedding, dim, model, dimensions, precision, normalized, version, created_by)
           VALUES (?, 'minilm', 'native', ?, ?, ?, ?, 32, 1, 1, 'test')`
        ).run(id, encodeFloat32Embedding(vector), DIMENSIONS, LOCAL_EMBEDDING_MODEL.storedName, DIMENSIONS);
      }
      const vectorSearchEngine = getVectorSearchEngine();
      vectorSearchEngine.initialize(db);
      const service = new MemoryNeighborService(vectorSearchEngine, new MemoryEmbeddingService(), db);

      const { neighbors } = await service.getNeighbors('root', { limit: 10, scope: {} });

      expect(neighbors.map((neighbor) => neighbor.id)).toEqual(['above']);
    });
  });
});

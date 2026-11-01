import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeDatabase } from '@memento/core';
import type { HybridSearchResult } from '@memento/core/domains/search/algorithms/hybrid-search-types.js';
import {
  benchmarkIdsInMergedPool,
  collectMergedPoolForQuery,
  countMemoryRelationsInDb,
  DEFAULT_RELATION_BFS_EVAL_CONSTANTS,
} from './relation-bfs-eval-runner.js';
import {
  buildBenchmarkIdMaps,
  countRelationJsonlRows,
  loadRelationKoPanelCorpusRows,
  loadRelationKoPanelForbiddenByQuery,
  loadRelationKoPanelGroundTruth,
  loadRelationKoPanelQueries,
  seedRelationGraphFromCorpusAndJsonl,
} from './relation-ko-panel-seed.js';

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/search-quality/relation-ko-panel-v1');

function hopObsHybridItem(): HybridSearchResult {
  return {
    id: 'cl_01_src_hop_obs',
    content: '',
    type: 'episodic',
    importance: 0.5,
    created_at: '2026-09-01T10:00:00Z',
    pinned: false,
    textScore: 0.2,
    vectorScore: 0.3,
    finalScore: 0.85,
    recall_reason: 'test_seed',
  };
}

describe('relation-bfs-eval diagnostic (#1555)', () => {
  it('relations.jsonl row count matches fixture contract (205 rows; protocol.md)', () => {
    expect(countRelationJsonlRows(FIXTURE_DIR)).toBe(205);
  });

  it('seedRelationGraphFromCorpusAndJsonl loads memory_relation count equal to relations.jsonl', async () => {
    const db = await initializeDatabase(':memory:');
    try {
      const expected = countRelationJsonlRows(FIXTURE_DIR);
      seedRelationGraphFromCorpusAndJsonl(db, FIXTURE_DIR);
      expect(countMemoryRelationsInDb(db)).toBe(expected);
    } finally {
      db.close();
    }
  });

  it('includes multi_hop gold in merged BFS pool for cl_01_q_multi (maxHops=2)', async () => {
    const corpus = loadRelationKoPanelCorpusRows(FIXTURE_DIR);
    const maps = buildBenchmarkIdMaps(corpus);
    const multi = loadRelationKoPanelQueries(FIXTURE_DIR).find((q) => q.query_id === 'cl_01_q_multi');
    expect(multi).toBeDefined();
    const gold = loadRelationKoPanelGroundTruth(FIXTURE_DIR).get('cl_01_q_multi')!.relevantIds[0]!;

    const db = await initializeDatabase(':memory:');
    try {
      const safetyMetaByBenchmarkId = seedRelationGraphFromCorpusAndJsonl(db, FIXTURE_DIR);
      const ctx = {
        db,
        embeddingProvider: 'minilm' as const,
        memoryIdToBenchmarkId: maps.memoryIdToBenchmarkId,
        contentByBenchmarkId: maps.contentByBenchmarkId,
        safetyMetaByBenchmarkId,
        forbiddenByQueryId: loadRelationKoPanelForbiddenByQuery(FIXTURE_DIR),
        constants: { ...DEFAULT_RELATION_BFS_EVAL_CONSTANTS },
      };
      const merged = await collectMergedPoolForQuery(
        ctx,
        multi!,
        { maxHops: 2, maxSeeds: 5, bfsLimit: 35 },
        [hopObsHybridItem()],
      );
      const benchmarkIds = benchmarkIdsInMergedPool(merged, maps.memoryIdToBenchmarkId);
      expect(benchmarkIds).toContain(gold);
    } finally {
      db.close();
    }
  });

  it('collectMergedPoolForQuery does not mutate cached hybrid finalScore', async () => {
    const corpus = loadRelationKoPanelCorpusRows(FIXTURE_DIR);
    const maps = buildBenchmarkIdMaps(corpus);
    const multi = loadRelationKoPanelQueries(FIXTURE_DIR).find((q) => q.query_id === 'cl_01_q_multi');
    expect(multi).toBeDefined();

    const db = await initializeDatabase(':memory:');
    try {
      const safetyMetaByBenchmarkId = seedRelationGraphFromCorpusAndJsonl(db, FIXTURE_DIR);
      const ctx = {
        db,
        embeddingProvider: 'minilm' as const,
        memoryIdToBenchmarkId: maps.memoryIdToBenchmarkId,
        contentByBenchmarkId: maps.contentByBenchmarkId,
        safetyMetaByBenchmarkId,
        forbiddenByQueryId: loadRelationKoPanelForbiddenByQuery(FIXTURE_DIR),
        constants: { ...DEFAULT_RELATION_BFS_EVAL_CONSTANTS },
      };
      const cached = hopObsHybridItem();
      const scoreBefore = cached.finalScore;
      await collectMergedPoolForQuery(
        ctx,
        multi!,
        { maxHops: 2, maxSeeds: 3, bfsLimit: 15 },
        [cached],
      );
      expect(cached.finalScore).toBe(scoreBefore);
    } finally {
      db.close();
    }
  });
});

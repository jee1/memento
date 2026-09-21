import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRelationGraph } from '@memento/core';
import { HybridSearchFactory } from '../packages/memento-core/src/domains/search/factories/hybrid-search.factory.js';
import { getBenchmarkVectorProviderFilter } from '../packages/memento-core/src/shared/types/benchmark.types.js';
import { createSeededBenchmarkDatabase } from './lib/benchmark-search-database.js';
import {
  formatComparisonTable,
  formatSummaryTable,
  runRelationPocComparison,
  summarizeRows,
  type RelationPocComparisonRow,
} from './relation-recall-poc-comparison.js';

const here = dirname(fileURLToPath(import.meta.url));
const relationPocDir = join(here, '..', 'tests/fixtures/search-quality/relation-poc');

describe('relation-recall-poc-comparison (#959)', () => {
  it('summarizes per-mode MRR, recall, and p95 latency', () => {
    const rows: RelationPocComparisonRow[] = [
      { mode: 'off', query: 'q1', mrr: 0.5, recall_at_10: 1, first_relevant_rank: 2, latency_ms: 10 },
      { mode: 'plain', query: 'q1', mrr: 1, recall_at_10: 1, first_relevant_rank: 1, latency_ms: 12 },
      { mode: 'weighted', query: 'q1', mrr: 1, recall_at_10: 1, first_relevant_rank: 1, latency_ms: 13 },
    ];
    const summaries = summarizeRows(rows);
    expect(summaries).toHaveLength(3);
    expect(formatComparisonTable(rows)).toContain('mode | query | MRR');
    expect(formatSummaryTable(summaries)).toContain('mean_MRR');
  });

  describe('relation-poc fixture integration', () => {
    let seeded: Awaited<ReturnType<typeof createSeededBenchmarkDatabase>>;
    let previousProvider: string | undefined;

    beforeAll(async () => {
      previousProvider = process.env.EMBEDDING_PROVIDER;
      process.env.EMBEDDING_PROVIDER = 'tfidf';
      seeded = await createSeededBenchmarkDatabase(relationPocDir);
    }, 120_000);

    afterAll(() => {
      seeded?.close();
      if (previousProvider === undefined) {
        delete process.env.EMBEDDING_PROVIDER;
      } else {
        process.env.EMBEDDING_PROVIDER = previousProvider;
      }
    });

    async function searchWithMode(
      mode: 'off' | 'plain' | 'weighted' | undefined,
      query: string,
      limit = 10
    ) {
      const engine = HybridSearchFactory.createDefaultEngine(seeded.db);
      engine.setRelationGraph(createRelationGraph(seeded.db));
      return engine.search(seeded.db, {
        query,
        limit,
        provider_filter: getBenchmarkVectorProviderFilter(),
        relationRecallExpansion: mode === 'off' ? undefined : mode,
      });
    }

    it('off mode matches unset expansion (parity)', async () => {
      const query = 'pagination 중복 항목 문제';
      const off = await searchWithMode('off', query);
      const unset = await searchWithMode(undefined, query);
      expect(off.items.map((item) => item.id)).toEqual(unset.items.map((item) => item.id));
    });

    it('weighted mode does not regress rq_001 shallow-gap decision rank', async () => {
      const query = 'pagination 중복 항목 문제';
      const baseline = await searchWithMode('off', query);
      const weighted = await searchWithMode('weighted', query);
      const decisionId = 'relpoc_dec_000001';
      const baselineRank = baseline.items.findIndex((item) => item.id === decisionId);
      const weightedRank = weighted.items.findIndex((item) => item.id === decisionId);
      expect(baselineRank).toBeGreaterThan(0);
      expect(weightedRank).toBeGreaterThanOrEqual(0);
      expect(weightedRank).toBeLessThanOrEqual(baselineRank);
    });

    it('plain expansion adds absent relation candidates for rq_001', async () => {
      const query = 'pagination 중복 항목 문제';
      const baseline = await searchWithMode('off', query);
      const plain = await searchWithMode('plain', query);
      expect(plain.items.length).toBeGreaterThanOrEqual(baseline.items.length);
      expect(new Set(plain.items.map((item) => item.id)).size).toBe(plain.items.length);
    });

    it('weighted mode ranks decision higher than plain for rq_002', async () => {
      const query = '임베딩 타임아웃이 잦다';
      const plain = await searchWithMode('plain', query);
      const weighted = await searchWithMode('weighted', query);
      const decisionId = 'relpoc_dec_000002';
      const plainRank = plain.items.findIndex((item) => item.id === decisionId);
      const weightedRank = weighted.items.findIndex((item) => item.id === decisionId);
      expect(plainRank).toBeGreaterThanOrEqual(0);
      expect(weightedRank).toBeGreaterThanOrEqual(0);
      expect(weightedRank).toBeLessThanOrEqual(plainRank);
      if (plainRank >= 0 && weightedRank >= 0) {
        expect(weighted.items[weightedRank].finalScore).toBeGreaterThan(plain.items[plainRank].finalScore);
      }
    });

    it('does not regress unrelated control query rq_003', async () => {
      const query = 'WAL 체크포인트 경고';
      const baseline = await searchWithMode('off', query);
      const expanded = await searchWithMode('weighted', query);
      expect(baseline.items[0]?.id).toBe('relpoc_iso_000001');
      expect(expanded.items[0]?.id).toBe('relpoc_iso_000001');
    });

    it('runs three-condition comparison harness', async () => {
      const { rows, summaries } = await runRelationPocComparison();
      expect(rows.length).toBe(9);
      expect(summaries.length).toBe(3);
    }, 180_000);
  });
});

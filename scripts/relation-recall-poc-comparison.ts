#!/usr/bin/env node
import { isMain } from './lib/cli.js';
/**
 * #959 relation-poc: compare disabled / plain / weighted expansion on identical inputs.
 * Reports recall-quality + latency only — no adoption claim.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRelationGraph } from '@memento/core';
import { HybridSearchFactory } from '../packages/memento-core/src/domains/search/factories/hybrid-search.factory.js';
import {
  calculateRecallAtK,
  type GroundTruth,
} from '../packages/memento-core/src/domains/monitoring/services/quality-assurance/search-quality-metrics.js';
import { calculateMRR } from '../packages/memento-core/src/domains/monitoring/services/quality-assurance/search-metrics-collector.js';
import {
  loadBenchmarkCorpus,
  loadBenchmarkQueries,
} from '../packages/memento-core/src/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import { getBenchmarkVectorProviderFilter } from '../packages/memento-core/src/shared/types/benchmark.types.js';
import type { RelationRecallExpansionMode } from '../packages/memento-core/src/domains/search/algorithms/relation-recall-candidate-expansion.js';
import { createSeededBenchmarkDatabase } from './lib/benchmark-search-database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RELATION_POC_DIR = join(ROOT, 'tests/fixtures/search-quality/relation-poc');
const MODES: RelationRecallExpansionMode[] = ['off', 'plain', 'weighted'];
const TOP_K = 10;

export type RelationPocComparisonRow = {
  mode: RelationRecallExpansionMode;
  query: string;
  mrr: number;
  recall_at_10: number;
  first_relevant_rank: number | null;
  latency_ms: number;
};

export type RelationPocComparisonSummary = {
  mode: RelationRecallExpansionMode;
  mean_mrr: number;
  mean_recall_at_10: number;
  p95_latency_ms: number;
};

function loadGroundTruth(): GroundTruth[] {
  const raw = JSON.parse(readFileSync(join(RELATION_POC_DIR, 'ground-truth.json'), 'utf8')) as Array<{
    queryId: string;
    relevantIds: string[];
  }>;
  return raw.map((row) => ({ queryId: row.queryId, relevantIds: row.relevantIds }));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

export function summarizeRows(rows: RelationPocComparisonRow[]): RelationPocComparisonSummary[] {
  return MODES.map((mode) => {
    const subset = rows.filter((row) => row.mode === mode);
    const mean_mrr = subset.reduce((sum, row) => sum + row.mrr, 0) / Math.max(subset.length, 1);
    const mean_recall_at_10 =
      subset.reduce((sum, row) => sum + row.recall_at_10, 0) / Math.max(subset.length, 1);
    return {
      mode,
      mean_mrr,
      mean_recall_at_10,
      p95_latency_ms: percentile(
        subset.map((row) => row.latency_ms),
        95
      ),
    };
  });
}

export async function runRelationPocComparison(): Promise<{
  rows: RelationPocComparisonRow[];
  summaries: RelationPocComparisonSummary[];
}> {
  const previousProvider = process.env.EMBEDDING_PROVIDER;
  process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? 'tfidf';

  const seeded = await createSeededBenchmarkDatabase(RELATION_POC_DIR);
  try {
    const corpus = loadBenchmarkCorpus(RELATION_POC_DIR);
    const queries = loadBenchmarkQueries(RELATION_POC_DIR);
    const memoryIdToBenchmarkId = new Map(corpus.map((entry) => [entry.source_memory_id, entry.benchmark_id]));
    const benchmarkIdToMemoryId = new Map(corpus.map((entry) => [entry.benchmark_id, entry.source_memory_id]));
    const groundTruths = loadGroundTruth();

    const rows: RelationPocComparisonRow[] = [];

    for (const mode of MODES) {
      const engine = HybridSearchFactory.createDefaultEngine(seeded.db);
      engine.setRelationGraph(createRelationGraph(seeded.db));

      for (const gt of groundTruths) {
        const queryRow = queries.find((q) => q.query === gt.queryId || q.query_id === gt.queryId);
        const queryText = queryRow?.query ?? gt.queryId;
        const started = performance.now();
        const searchResult = await engine.search(seeded.db, {
          query: queryText,
          limit: TOP_K,
          provider_filter: getBenchmarkVectorProviderFilter(),
          relationRecallExpansion: mode === 'off' ? undefined : mode,
        });
        const latency_ms = performance.now() - started;

        const mappedResults = searchResult.items.map((item) => ({
          id: memoryIdToBenchmarkId.get(item.id) ?? item.id,
          score: item.finalScore,
        }));
        const queryResults = new Map<string, typeof mappedResults>([[gt.queryId, mappedResults]]);
        const mrr = calculateMRR(queryResults, [gt]);
        const recall_at_10 = calculateRecallAtK(mappedResults, gt.relevantIds, TOP_K);
        const relevantMemoryIds = gt.relevantIds
          .map((benchmarkId) => benchmarkIdToMemoryId.get(benchmarkId))
          .filter((id): id is string => Boolean(id));
        const first_relevant_rank = (() => {
          for (let i = 0; i < searchResult.items.length; i++) {
            if (relevantMemoryIds.includes(searchResult.items[i]!.id)) {
              return i + 1;
            }
          }
          return null;
        })();

        rows.push({
          mode,
          query: gt.queryId,
          mrr,
          recall_at_10,
          first_relevant_rank,
          latency_ms,
        });
      }
    }

    return { rows, summaries: summarizeRows(rows) };
  } finally {
    seeded.close();
    if (previousProvider === undefined) {
      delete process.env.EMBEDDING_PROVIDER;
    } else {
      process.env.EMBEDDING_PROVIDER = previousProvider;
    }
  }
}

export function formatComparisonTable(rows: RelationPocComparisonRow[]): string {
  const header = 'mode | query | MRR | R@10 | 1st_rel_rank | latency_ms';
  const lines = rows.map(
    (row) =>
      `${row.mode} | ${row.query} | ${row.mrr.toFixed(4)} | ${row.recall_at_10.toFixed(4)} | ${row.first_relevant_rank ?? '-'} | ${row.latency_ms.toFixed(1)}`
  );
  return [header, ...lines].join('\n');
}

export function formatSummaryTable(summaries: RelationPocComparisonSummary[]): string {
  const header = 'mode | mean_MRR | mean_R@10 | p95_latency_ms';
  const lines = summaries.map(
    (row) =>
      `${row.mode} | ${row.mean_mrr.toFixed(4)} | ${row.mean_recall_at_10.toFixed(4)} | ${row.p95_latency_ms.toFixed(1)}`
  );
  return [header, ...lines].join('\n');
}

async function main(): Promise<void> {
  const { rows, summaries } = await runRelationPocComparison();
  console.log(`fixture=${RELATION_POC_DIR}`);
  console.log(formatComparisonTable(rows));
  console.log('');
  console.log(formatSummaryTable(summaries));
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

import type Database from 'better-sqlite3';
import { HybridSearchFactory } from '@memento/core/domains/search/factories/hybrid-search.factory.js';
import {
  getBenchmarkVectorProviderFilter,
  resolveBenchmarkEmbeddingProvider,
} from '@memento/core/shared/types/benchmark.types.js';
import {
  calculateRecallAtK,
  type GroundTruth,
  type SearchResult,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-metrics.js';
import {
  loadBenchmarkGroundTruth,
  loadBenchmarkManifest,
  loadBenchmarkQueries,
  type BenchmarkCorpusEntry,
  type BenchmarkQuery,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';

export const REJECTION_BASELINE_TOP_K = 10;

export interface RejectionBaselineQueryRow {
  query_id: string;
  query: string;
  group: 'relevant' | 'unrelated';
}

export interface RejectionBaselineRelevantResult {
  query_id: string;
  query: string;
  result_count: number;
  recall_at_k: number;
  first_relevant_rank: number | null;
  reciprocal_rank: number;
  latency_ms: number;
}

export interface RejectionBaselineUnrelatedResult {
  query_id: string;
  query: string;
  returned_any: boolean;
  result_count: number;
  latency_ms: number;
}

export interface RejectionBaselineReport {
  schema_version: 1;
  benchmark_version: string;
  embedding_provider: string;
  vector_dims: number;
  ranking_baseline_note: string;
  corpus: {
    parent: string;
    parent_document_count: number;
    overlay_document_count: number;
  };
  top_k: number;
  latency_ms: {
    p95: number;
  };
  relevant: RejectionBaselineRelevantResult[];
  unrelated: RejectionBaselineUnrelatedResult[];
  aggregates: {
    unrelated_returned_any_count: number;
    relevant_recall_at_k_mean: number;
    relevant_reciprocal_rank_mean: number;
  };
}

export function percentileLatencyMs(values: number[], p = 95): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * (p / 100)) - 1;
  return sorted[Math.max(0, idx)]!;
}

export function firstRelevantRank(
  results: SearchResult[],
  relevantIds: string[]
): number | null {
  const relevantSet = new Set(relevantIds);
  for (let i = 0; i < results.length; i++) {
    const row = results[i];
    if (row && relevantSet.has(row.id)) {
      return i + 1;
    }
  }
  return null;
}

export function reciprocalRank(rank: number | null): number {
  return rank !== null && rank > 0 ? 1 / rank : 0;
}

export function loadRejectionBaselineQueries(benchmarkDir: string): RejectionBaselineQueryRow[] {
  const queries = loadBenchmarkQueries(benchmarkDir) as Array<
    BenchmarkQuery & { group?: string }
  >;
  const rows: RejectionBaselineQueryRow[] = [];
  for (const query of queries) {
    if (query.group !== 'relevant' && query.group !== 'unrelated') {
      throw new Error(`Rejection baseline query ${query.query_id} missing group`);
    }
    rows.push({
      query_id: query.query_id,
      query: query.query,
      group: query.group,
    });
  }
  return rows;
}

export function assertRejectionBaselineQueryGroups(rows: RejectionBaselineQueryRow[]): void {
  const relevant = rows.filter((row) => row.group === 'relevant');
  const unrelated = rows.filter((row) => row.group === 'unrelated');
  if (relevant.length !== 6 || unrelated.length !== 6) {
    throw new Error(
      `Rejection baseline expects 6 relevant and 6 unrelated queries (got ${relevant.length}/${unrelated.length})`
    );
  }
}

export function assertOverlayCorpusNeutralized(overlay: BenchmarkCorpusEntry[]): void {
  if (overlay.length === 0) {
    return;
  }
  const tagSets = overlay.map((entry) => JSON.stringify([...(entry.tags ?? [])].sort()));
  const uniqueTags = new Set(tagSets);
  if (uniqueTags.size !== 1) {
    throw new Error('Overlay corpus tags must be identical across rows (#973 neutralization)');
  }
}

export async function measureRejectionBaseline(
  db: Database.Database,
  benchmarkDir: string,
  options: {
    overlayCorpus: BenchmarkCorpusEntry[];
    parentDocumentCount: number;
    topK?: number;
    vectorDims?: number;
  }
): Promise<RejectionBaselineReport> {
  const topK = options.topK ?? REJECTION_BASELINE_TOP_K;
  const manifest = loadBenchmarkManifest(benchmarkDir) as {
    benchmark_version: string;
    parent_corpus?: string;
  };
  const queryRows = loadRejectionBaselineQueries(benchmarkDir);
  assertRejectionBaselineQueryGroups(queryRows);

  const groundTruths = loadBenchmarkGroundTruth(benchmarkDir);
  const gtByQuery = new Map<string, GroundTruth>(groundTruths.map((gt) => [gt.queryId, gt]));
  const memoryIdToBenchmarkId = new Map(
    options.overlayCorpus.map((entry) => [entry.source_memory_id, entry.benchmark_id])
  );

  const searchEngine = HybridSearchFactory.createDefaultEngine(db);
  const latencies: number[] = [];
  const relevant: RejectionBaselineRelevantResult[] = [];
  const unrelated: RejectionBaselineUnrelatedResult[] = [];

  for (const row of queryRows) {
    const started = performance.now();
    const searchResult = await searchEngine.search(db, {
      query: row.query,
      limit: topK,
      provider_filter: getBenchmarkVectorProviderFilter(),
    });
    const latencyMs = performance.now() - started;
    latencies.push(latencyMs);

    const mapped: SearchResult[] = searchResult.items.map((item) => ({
      id: memoryIdToBenchmarkId.get(item.id) ?? item.id,
      score: item.finalScore,
    }));

    if (row.group === 'relevant') {
      const gt = gtByQuery.get(row.query);
      if (!gt || gt.relevantIds.length === 0) {
        throw new Error(`Missing ground truth for relevant query: ${row.query}`);
      }
      const rank = firstRelevantRank(mapped, gt.relevantIds);
      relevant.push({
        query_id: row.query_id,
        query: row.query,
        result_count: mapped.length,
        recall_at_k: calculateRecallAtK(mapped, gt.relevantIds, topK),
        first_relevant_rank: rank,
        reciprocal_rank: reciprocalRank(rank),
        latency_ms: latencyMs,
      });
    } else {
      unrelated.push({
        query_id: row.query_id,
        query: row.query,
        returned_any: mapped.length > 0,
        result_count: mapped.length,
        latency_ms: latencyMs,
      });
    }
  }

  return {
    schema_version: 1,
    benchmark_version: manifest.benchmark_version,
    embedding_provider: resolveBenchmarkEmbeddingProvider(),
    vector_dims: options.vectorDims ?? 384,
    ranking_baseline_note:
      'hybrid search after #1079 (BM25 sigmoid) and #1082 (importance compression); no rejection gate',
    corpus: {
      parent: manifest.parent_corpus ?? 'benchmark-v3',
      parent_document_count: options.parentDocumentCount,
      overlay_document_count: options.overlayCorpus.length,
    },
    top_k: topK,
    latency_ms: {
      p95: percentileLatencyMs(latencies),
    },
    relevant,
    unrelated,
    aggregates: {
      unrelated_returned_any_count: unrelated.filter((row) => row.returned_any).length,
      relevant_recall_at_k_mean:
        relevant.reduce((sum, row) => sum + row.recall_at_k, 0) / Math.max(relevant.length, 1),
      relevant_reciprocal_rank_mean:
        relevant.reduce((sum, row) => sum + row.reciprocal_rank, 0) / Math.max(relevant.length, 1),
    },
  };
}

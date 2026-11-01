import {
  calculateNDCGAtK,
  calculateRecallAtK,
  type GroundTruth,
  type SearchResult,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-metrics.js';

export type QueryCategory = 'single_fact' | 'multi_hop' | 'irrelevant_trap';

export interface RelationBfsQueryMeta {
  queryId: string;
  category: QueryCategory;
  scopeOwnerId: string;
  forbiddenBenchmarkIds: readonly string[];
}

export interface RankedBenchmarkResult {
  benchmarkId: string;
  score: number;
  tokenEstimate: number;
}

export interface PerQueryEvalOutcome {
  queryId: string;
  category: QueryCategory;
  ranked: readonly RankedBenchmarkResult[];
  latencyMs: number;
  returnedTokens: number;
  /** hybrid/BFS merge 후 harness safety 필터 적용 전(풀·토큰 trim만) 위반 집계 */
  rawSafetyViolations: SafetyViolationCounts;
  /** finalizeRanked forbidden·owner·삭제/교체 제거 후 반환 풀 위반( assertZero 대상) */
  safetyViolations: SafetyViolationCounts;
}

export interface SafetyViolationCounts {
  forbiddenInResults: number;
  foreignOwnerInResults: number;
  deletedOrSupersededInResults: number;
  total: number;
}

export interface AggregateMetrics {
  recallAt5: number;
  recallAt10: number;
  ndcgAt5: number;
  ndcgAt10: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  meanReturnedTokens: number;
  queryCount: number;
}

export interface CategorySliceMetrics {
  category: QueryCategory;
  metrics: AggregateMetrics;
}

export function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 3));
}

export function selectWithinTokenBudget(
  ranked: readonly RankedBenchmarkResult[],
  tokenBudget: number,
): RankedBenchmarkResult[] {
  const selected: RankedBenchmarkResult[] = [];
  let used = 0;
  for (const row of ranked) {
    if (used + row.tokenEstimate > tokenBudget) {
      continue;
    }
    selected.push(row);
    used += row.tokenEstimate;
  }
  return selected;
}

export function trimCandidatePool<T>(ranked: readonly T[], poolLimit: number): T[] {
  if (ranked.length <= poolLimit) {
    return [...ranked];
  }
  return ranked.slice(0, poolLimit);
}

export function toSearchResults(ranked: readonly RankedBenchmarkResult[]): SearchResult[] {
  return ranked.map((row) => ({ id: row.benchmarkId, score: row.score }));
}

export function computeAggregateMetrics(
  outcomes: readonly PerQueryEvalOutcome[],
  groundTruths: ReadonlyMap<string, GroundTruth>,
): AggregateMetrics {
  if (outcomes.length === 0) {
    return emptyAggregate();
  }
  let sumR5 = 0;
  let sumR10 = 0;
  let sumN5 = 0;
  let sumN10 = 0;
  let sumTokens = 0;
  const latencies: number[] = [];
  for (const outcome of outcomes) {
    const gt = groundTruths.get(outcome.queryId);
    if (!gt) {
      continue;
    }
    const results = toSearchResults(outcome.ranked);
    sumR5 += calculateRecallAtK(results, gt.relevantIds, 5);
    sumR10 += calculateRecallAtK(results, gt.relevantIds, 10);
    sumN5 += calculateNDCGAtK(results, gt.relevantIds, 5);
    sumN10 += calculateNDCGAtK(results, gt.relevantIds, 10);
    sumTokens += outcome.returnedTokens;
    latencies.push(outcome.latencyMs);
  }
  const n = outcomes.length;
  return {
    recallAt5: sumR5 / n,
    recallAt10: sumR10 / n,
    ndcgAt5: sumN5 / n,
    ndcgAt10: sumN10 / n,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    meanReturnedTokens: sumTokens / n,
    queryCount: n,
  };
}

export function computeMetricsByCategory(
  outcomes: readonly PerQueryEvalOutcome[],
  groundTruths: ReadonlyMap<string, GroundTruth>,
): CategorySliceMetrics[] {
  const categories: QueryCategory[] = ['single_fact', 'multi_hop', 'irrelevant_trap'];
  return categories.map((category) => ({
    category,
    metrics: computeAggregateMetrics(
      outcomes.filter((o) => o.category === category),
      groundTruths,
    ),
  }));
}

export function queryHitsAtK(
  ranked: readonly RankedBenchmarkResult[],
  relevantBenchmarkIds: readonly string[],
  k: number,
): boolean {
  const relevant = new Set(relevantBenchmarkIds);
  return ranked.slice(0, k).some((row) => relevant.has(row.benchmarkId));
}

export function findRegressionQueryIds(
  outcomesA: readonly PerQueryEvalOutcome[],
  outcomesB: readonly PerQueryEvalOutcome[],
  groundTruths: ReadonlyMap<string, GroundTruth>,
  k: number,
): string[] {
  const byB = new Map(outcomesB.map((o) => [o.queryId, o]));
  const regressions: string[] = [];
  for (const a of outcomesA) {
    const gt = groundTruths.get(a.queryId);
    const b = byB.get(a.queryId);
    if (!gt || !b) {
      continue;
    }
    const hitA = queryHitsAtK(a.ranked, gt.relevantIds, k);
    const hitB = queryHitsAtK(b.ranked, gt.relevantIds, k);
    if (hitA && !hitB) {
      regressions.push(a.queryId);
    }
  }
  return regressions;
}

export interface MemorySafetyMeta {
  benchmarkId: string;
  ownerId: string | null;
  isDeleted: boolean;
  supersededBy: string | null;
}

export function countSafetyViolations(
  resultBenchmarkIds: readonly string[],
  metaByBenchmarkId: ReadonlyMap<string, MemorySafetyMeta>,
  scopeOwnerId: string,
  forbiddenBenchmarkIds: readonly string[] = [],
): SafetyViolationCounts {
  const forbidden = new Set(forbiddenBenchmarkIds);
  let forbiddenInResults = 0;
  let foreignOwnerInResults = 0;
  let deletedOrSupersededInResults = 0;
  for (const id of resultBenchmarkIds) {
    if (forbidden.has(id)) {
      forbiddenInResults++;
    }
    const meta = metaByBenchmarkId.get(id);
    if (!meta) {
      continue;
    }
    if (meta.ownerId && meta.ownerId !== scopeOwnerId) {
      foreignOwnerInResults++;
    }
    if (meta.isDeleted || meta.supersededBy) {
      deletedOrSupersededInResults++;
    }
  }
  return {
    forbiddenInResults,
    foreignOwnerInResults,
    deletedOrSupersededInResults,
    total: forbiddenInResults + foreignOwnerInResults + deletedOrSupersededInResults,
  };
}

export function assertZeroSafetyViolations(counts: SafetyViolationCounts, label: string): void {
  if (counts.total !== 0) {
    throw new Error(
      `${label}: expected 0 safety violations, got forbidden=${counts.forbiddenInResults} ` +
        `foreign_owner=${counts.foreignOwnerInResults} deleted_or_superseded=${counts.deletedOrSupersededInResults}`,
    );
  }
}

export function sumSafetyViolationCounts(
  counts: readonly SafetyViolationCounts[],
): SafetyViolationCounts {
  let forbiddenInResults = 0;
  let foreignOwnerInResults = 0;
  let deletedOrSupersededInResults = 0;
  for (const row of counts) {
    forbiddenInResults += row.forbiddenInResults;
    foreignOwnerInResults += row.foreignOwnerInResults;
    deletedOrSupersededInResults += row.deletedOrSupersededInResults;
  }
  return {
    forbiddenInResults,
    foreignOwnerInResults,
    deletedOrSupersededInResults,
    total: forbiddenInResults + foreignOwnerInResults + deletedOrSupersededInResults,
  };
}

export function formatSafetyViolationCounts(counts: SafetyViolationCounts): string {
  return `forbidden=${counts.forbiddenInResults} foreign_owner=${counts.foreignOwnerInResults} ` +
    `deleted_or_superseded=${counts.deletedOrSupersededInResults} total=${counts.total}`;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)]!;
}

function emptyAggregate(): AggregateMetrics {
  return {
    recallAt5: 0,
    recallAt10: 0,
    ndcgAt5: 0,
    ndcgAt10: 0,
    latencyP50Ms: 0,
    latencyP95Ms: 0,
    meanReturnedTokens: 0,
    queryCount: 0,
  };
}

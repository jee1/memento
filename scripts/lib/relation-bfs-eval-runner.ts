import type Database from 'better-sqlite3';
import { createRelationGraph, sqliteRepositoryProvider } from '@memento/core';
import { HybridSearchFactory } from '@memento/core/domains/search/factories/hybrid-search.factory.js';
import { getBenchmarkVectorProviderFilter } from '@memento/core/shared/types/benchmark.types.js';
import type { HybridSearchResult } from '@memento/core/domains/search/algorithms/hybrid-search-types.js';
import {
  countSafetyViolations,
  estimateTokens,
  selectWithinTokenBudget,
  trimCandidatePool,
  type MemorySafetyMeta,
  type PerQueryEvalOutcome,
  type RankedBenchmarkResult,
} from './relation-bfs-eval-metrics.js';
import type { RelationKoPanelQueryRow, RelationKoPanelSafetyMeta } from './relation-ko-panel-seed.js';

export interface RelationBfsHyperparams {
  maxHops: number;
  maxSeeds: number;
  bfsLimit: number;
}

export interface RelationBfsEvalConstants {
  candidatePoolLimit: number;
  tokenBudget: number;
}

export interface RelationBfsEvalContext {
  db: Database.Database;
  memoryIdToBenchmarkId: ReadonlyMap<string, string>;
  contentByBenchmarkId: ReadonlyMap<string, string>;
  safetyMetaByBenchmarkId: ReadonlyMap<string, RelationKoPanelSafetyMeta>;
  forbiddenByQueryId: ReadonlyMap<string, readonly string[]>;
  constants: RelationBfsEvalConstants;
}

function toSafetyMeta(meta: RelationKoPanelSafetyMeta): MemorySafetyMeta {
  return {
    benchmarkId: meta.benchmarkId,
    ownerId: meta.ownerId,
    isDeleted: meta.isDeleted,
    supersededBy: meta.supersededByBenchmarkId,
  };
}

function hybridItemToRanked(
  item: HybridSearchResult,
  memoryIdToBenchmarkId: ReadonlyMap<string, string>,
  contentByBenchmarkId: ReadonlyMap<string, string>,
): RankedBenchmarkResult | null {
  const benchmarkId = memoryIdToBenchmarkId.get(item.id);
  if (!benchmarkId) {
    return null;
  }
  const content = contentByBenchmarkId.get(benchmarkId) ?? item.content;
  return {
    benchmarkId,
    score: item.finalScore,
    tokenEstimate: estimateTokens(content),
  };
}

async function runHybridSearch(
  ctx: RelationBfsEvalContext,
  queryRow: RelationKoPanelQueryRow,
): Promise<{ items: HybridSearchResult[]; latencyMs: number }> {
  const engine = HybridSearchFactory.createDefaultEngine(sqliteRepositoryProvider);
  const started = performance.now();
  const result = await engine.search(ctx.db, {
    query: queryRow.query,
    limit: ctx.constants.candidatePoolLimit,
    include_score_breakdown: false,
    provider_filter: getBenchmarkVectorProviderFilter(),
    filters: {
      owner_id: queryRow.scope_owner_id,
      project_id: queryRow.scope_project_id,
    },
  });
  return { items: result.items, latencyMs: performance.now() - started };
}

async function expandPoolWithBfs(
  db: Database.Database,
  hybridItems: HybridSearchResult[],
  hyper: RelationBfsHyperparams,
  scopeOwnerId: string,
  forbiddenBenchmarkIds: readonly string[],
  memoryIdToBenchmarkId: ReadonlyMap<string, string>,
  safetyMetaByBenchmarkId: ReadonlyMap<string, RelationKoPanelSafetyMeta>,
): Promise<HybridSearchResult[]> {
  const graph = createRelationGraph(db);
  const pool = [...hybridItems];
  const inPool = new Set(pool.map((item) => item.id));
  const seeds = pool.slice(0, hyper.maxSeeds);

  for (const seed of seeds) {
    const related = await graph.getRelatedMemories(seed.id, {
      maxHops: hyper.maxHops,
      limit: hyper.bfsLimit,
    });
    for (const rel of related) {
      if (inPool.has(rel.memory_id)) {
        continue;
      }
      const benchmarkId = memoryIdToBenchmarkId.get(rel.memory_id);
      if (!benchmarkId) {
        continue;
      }
      if (forbiddenBenchmarkIds.includes(benchmarkId)) {
        continue;
      }
      const meta = safetyMetaByBenchmarkId.get(benchmarkId);
      if (meta?.ownerId && meta.ownerId !== scopeOwnerId) {
        continue;
      }
      if (meta?.isDeleted || meta?.supersededByBenchmarkId) {
        continue;
      }
      inPool.add(rel.memory_id);
      pool.push({
        id: rel.memory_id,
        content: '',
        type: 'semantic',
        importance: 0,
        created_at: '',
        pinned: false,
        textScore: 0,
        vectorScore: 0,
        finalScore: 0,
        recall_reason: 'relation_bfs_eval',
      });
    }
  }
  return pool;
}

function finalizeRanked(
  hybridItems: HybridSearchResult[],
  ctx: RelationBfsEvalContext,
): RankedBenchmarkResult[] {
  const mapped = hybridItems
    .map((item) => hybridItemToRanked(item, ctx.memoryIdToBenchmarkId, ctx.contentByBenchmarkId))
    .filter((row): row is RankedBenchmarkResult => row !== null);
  const trimmed = trimCandidatePool(mapped, ctx.constants.candidatePoolLimit);
  return selectWithinTokenBudget(trimmed, ctx.constants.tokenBudget);
}

export async function evaluateQueryHybridOnly(
  ctx: RelationBfsEvalContext,
  queryRow: RelationKoPanelQueryRow,
): Promise<PerQueryEvalOutcome> {
  const { items, latencyMs } = await runHybridSearch(ctx, queryRow);
  const ranked = finalizeRanked(items, ctx);
  const metaByBenchmark = new Map<string, MemorySafetyMeta>();
  for (const [id, meta] of ctx.safetyMetaByBenchmarkId) {
    metaByBenchmark.set(id, toSafetyMeta(meta));
  }
  const safetyViolations = countSafetyViolations(
    ranked.map((r) => r.benchmarkId),
    metaByBenchmark,
    queryRow.scope_owner_id,
  );
  return {
    queryId: queryRow.query_id,
    category: queryRow.category,
    ranked,
    latencyMs,
    returnedTokens: ranked.reduce((sum, row) => sum + row.tokenEstimate, 0),
    safetyViolations,
  };
}

function filterHybridItemsForBfsArm(
  items: HybridSearchResult[],
  memoryIdToBenchmarkId: ReadonlyMap<string, string>,
  safetyMetaByBenchmarkId: ReadonlyMap<string, RelationKoPanelSafetyMeta>,
  scopeOwnerId: string,
): HybridSearchResult[] {
  return items.filter((item) => {
    const benchmarkId = memoryIdToBenchmarkId.get(item.id);
    if (!benchmarkId) {
      return true;
    }
    const meta = safetyMetaByBenchmarkId.get(benchmarkId);
    if (!meta) {
      return true;
    }
    if (meta.ownerId && meta.ownerId !== scopeOwnerId) {
      return false;
    }
    if (meta.isDeleted || meta.supersededByBenchmarkId) {
      return false;
    }
    return true;
  });
}

export async function evaluateQueryHybridWithBfs(
  ctx: RelationBfsEvalContext,
  queryRow: RelationKoPanelQueryRow,
  hyper: RelationBfsHyperparams,
): Promise<PerQueryEvalOutcome> {
  const { items, latencyMs: hybridMs } = await runHybridSearch(ctx, queryRow);
  const scopedItems = filterHybridItemsForBfsArm(
    items,
    ctx.memoryIdToBenchmarkId,
    ctx.safetyMetaByBenchmarkId,
    queryRow.scope_owner_id,
  );
  const bfsStarted = performance.now();
  const expanded = await expandPoolWithBfs(
    ctx.db,
    scopedItems,
    hyper,
    queryRow.scope_owner_id,
    ctx.forbiddenByQueryId.get(queryRow.query_id) ?? [],
    ctx.memoryIdToBenchmarkId,
    ctx.safetyMetaByBenchmarkId,
  );
  const bfsMs = performance.now() - bfsStarted;
  const ranked = finalizeRanked(expanded, ctx);
  const metaByBenchmark = new Map<string, MemorySafetyMeta>();
  for (const [id, meta] of ctx.safetyMetaByBenchmarkId) {
    metaByBenchmark.set(id, toSafetyMeta(meta));
  }
  const safetyViolations = countSafetyViolations(
    ranked.map((r) => r.benchmarkId),
    metaByBenchmark,
    queryRow.scope_owner_id,
  );
  return {
    queryId: queryRow.query_id,
    category: queryRow.category,
    ranked,
    latencyMs: hybridMs + bfsMs,
    returnedTokens: ranked.reduce((sum, row) => sum + row.tokenEstimate, 0),
    safetyViolations,
  };
}

export const DEFAULT_BFS_TUNE_GRID: readonly RelationBfsHyperparams[] = (() => {
  const grid: RelationBfsHyperparams[] = [];
  for (const maxHops of [1, 2]) {
    for (const maxSeeds of [3, 5]) {
      for (const bfsLimit of [15, 25, 35]) {
        grid.push({ maxHops, maxSeeds, bfsLimit });
      }
    }
  }
  return grid;
})();

export function pickBestHyperparamsOnDev(
  devOutcomesByHyper: ReadonlyMap<string, readonly PerQueryEvalOutcome[]>,
  groundTruths: ReadonlyMap<string, { relevantIds: string[] }>,
): RelationBfsHyperparams {
  let bestKey = '';
  let bestRecall = -1;
  let best: RelationBfsHyperparams = DEFAULT_BFS_TUNE_GRID[0]!;
  for (const hyper of DEFAULT_BFS_TUNE_GRID) {
    const key = hyperKey(hyper);
    const outcomes = devOutcomesByHyper.get(key);
    if (!outcomes) {
      continue;
    }
    let sum = 0;
    for (const outcome of outcomes) {
      const gt = groundTruths.get(outcome.queryId);
      if (!gt) {
        continue;
      }
      const hit = outcome.ranked.slice(0, 10).some((row) => gt.relevantIds.includes(row.benchmarkId));
      sum += hit ? 1 : 0;
    }
    const recall = sum / outcomes.length;
    if (recall > bestRecall || (recall === bestRecall && key < bestKey)) {
      bestRecall = recall;
      bestKey = key;
      best = hyper;
    }
  }
  return best;
}

export function hyperKey(hyper: RelationBfsHyperparams): string {
  return `h${hyper.maxHops}-s${hyper.maxSeeds}-l${hyper.bfsLimit}`;
}

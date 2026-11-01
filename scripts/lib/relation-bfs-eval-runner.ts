import type Database from 'better-sqlite3';
import { createRelationGraph, DatabaseUtils, sqliteRepositoryProvider } from '@memento/core';
import { HybridSearchFactory } from '@memento/core/domains/search/factories/hybrid-search.factory.js';
import type { EmbeddingProvider } from '@memento/core/shared/types/embedding.types.js';
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

export const DEFAULT_RELATION_BFS_EVAL_CONSTANTS: RelationBfsEvalConstants = {
  candidatePoolLimit: 30,
  tokenBudget: 4096,
};

export interface RelationBfsEvalContext {
  db: Database.Database;
  embeddingProvider: EmbeddingProvider;
  memoryIdToBenchmarkId: ReadonlyMap<string, string>;
  contentByBenchmarkId: ReadonlyMap<string, string>;
  safetyMetaByBenchmarkId: ReadonlyMap<string, RelationKoPanelSafetyMeta>;
  forbiddenByQueryId: ReadonlyMap<string, readonly string[]>;
  constants: RelationBfsEvalConstants;
}

export interface HybridSearchSnapshot {
  items: HybridSearchResult[];
}

/** Mirrors RELATION_TYPE_BOOST_MAP in packages/memento-core/src/shared/types/relation.ts */
const RELATION_TYPE_BOOST: Record<string, number> = {
  CAUSES: 1.2,
  DEPENDS_ON: 1.1,
  FOLLOWS: 1.0,
  CONTRASTS_WITH: 0.9,
  REFERENCES: 0.8,
  BELONGS_TO: 1.0,
  VERSION_OF: 1.0,
  extracted_from: 0.7,
  supported_by: 0.7,
};

/** Fixture relations.jsonl uses ~0.9 confidence; harness has no per-edge confidence in BFS path. */
const BFS_EDGE_CONFIDENCE = 0.9;

type BfsRelationPathEdge = { relation_type: string };

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

/** 풀 limit·토큰 예산만 적용하고 forbidden/owner/삭제 harness 필터는 적용하지 않는다. */
export function rankedBenchmarkIdsBeforeHarnessSafetyFilter(
  items: HybridSearchResult[],
  ctx: RelationBfsEvalContext,
): string[] {
  const mapped = items
    .map((item) => hybridItemToRanked(item, ctx.memoryIdToBenchmarkId, ctx.contentByBenchmarkId))
    .filter((row): row is RankedBenchmarkResult => row !== null)
    .sort((a, b) => b.score - a.score);
  const trimmed = trimCandidatePool(mapped, ctx.constants.candidatePoolLimit);
  return selectWithinTokenBudget(trimmed, ctx.constants.tokenBudget).map((row) => row.benchmarkId);
}

export function countMemoryRelationsInDb(db: Database.Database): number {
  const row = DatabaseUtils.get(db, 'SELECT COUNT(*) AS n FROM memory_relation') as { n: number };
  return row.n;
}

export async function runHybridSearch(
  ctx: RelationBfsEvalContext,
  queryRow: RelationKoPanelQueryRow,
): Promise<{ items: HybridSearchResult[]; latencyMs: number }> {
  const engine = HybridSearchFactory.createDefaultEngine(sqliteRepositoryProvider);
  const started = performance.now();
  const result = await engine.search(ctx.db, {
    query: queryRow.query,
    limit: ctx.constants.candidatePoolLimit,
    include_score_breakdown: false,
    provider_filter: [ctx.embeddingProvider],
    filters: {
      owner_id: queryRow.scope_owner_id,
      project_id: queryRow.scope_project_id,
    },
  });
  return { items: result.items, latencyMs: performance.now() - started };
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

export function scoreBfsCandidate(
  seedScore: number,
  relationPath: readonly BfsRelationPathEdge[],
): number {
  let factor = 1;
  for (const edge of relationPath) {
    factor *= BFS_EDGE_CONFIDENCE;
    factor *= RELATION_TYPE_BOOST[edge.relation_type] ?? 1;
  }
  return seedScore * factor;
}

export async function expandPoolWithBfs(
  db: Database.Database,
  hybridItems: HybridSearchResult[],
  hyper: RelationBfsHyperparams,
  scopeOwnerId: string,
  forbiddenBenchmarkIds: readonly string[],
  memoryIdToBenchmarkId: ReadonlyMap<string, string>,
  safetyMetaByBenchmarkId: ReadonlyMap<string, RelationKoPanelSafetyMeta>,
): Promise<HybridSearchResult[]> {
  const graph = createRelationGraph(db);
  const byId = new Map<string, HybridSearchResult>();
  for (const item of hybridItems) {
    byId.set(item.id, { ...item });
  }
  const seeds = hybridItems.slice(0, hyper.maxSeeds);

  for (const seed of seeds) {
    const related = await graph.getRelatedMemories(seed.id, {
      maxHops: hyper.maxHops,
      limit: hyper.bfsLimit,
    });
    for (const rel of related) {
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
      const bfsScore = scoreBfsCandidate(seed.finalScore, rel.relation_path);
      const existing = byId.get(rel.memory_id);
      if (existing) {
        if (bfsScore > existing.finalScore) {
          byId.set(rel.memory_id, { ...existing, finalScore: bfsScore });
        }
        continue;
      }
      byId.set(rel.memory_id, {
        id: rel.memory_id,
        content: '',
        type: 'semantic',
        importance: 0,
        created_at: '',
        pinned: false,
        textScore: 0,
        vectorScore: 0,
        finalScore: bfsScore,
        recall_reason: 'relation_bfs_eval',
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.finalScore - a.finalScore);
}

/** Merged candidate pool benchmark ids (before pool limit / token budget). */
export function benchmarkIdsInMergedPool(
  mergedItems: readonly HybridSearchResult[],
  memoryIdToBenchmarkId: ReadonlyMap<string, string>,
): string[] {
  const ids: string[] = [];
  for (const item of mergedItems) {
    const benchmarkId = memoryIdToBenchmarkId.get(item.id);
    if (benchmarkId) {
      ids.push(benchmarkId);
    }
  }
  return ids;
}

export async function collectMergedPoolForQuery(
  ctx: RelationBfsEvalContext,
  queryRow: RelationKoPanelQueryRow,
  hyper: RelationBfsHyperparams,
  hybridItems: HybridSearchResult[],
): Promise<HybridSearchResult[]> {
  const scopedItems = filterHybridItemsForBfsArm(
    hybridItems,
    ctx.memoryIdToBenchmarkId,
    ctx.safetyMetaByBenchmarkId,
    queryRow.scope_owner_id,
  );
  return expandPoolWithBfs(
    ctx.db,
    scopedItems,
    hyper,
    queryRow.scope_owner_id,
    ctx.forbiddenByQueryId.get(queryRow.query_id) ?? [],
    ctx.memoryIdToBenchmarkId,
    ctx.safetyMetaByBenchmarkId,
  );
}

function finalizeRanked(
  mergedItems: HybridSearchResult[],
  ctx: RelationBfsEvalContext,
  queryRow: RelationKoPanelQueryRow,
): RankedBenchmarkResult[] {
  const forbidden = new Set(ctx.forbiddenByQueryId.get(queryRow.query_id) ?? []);
  const mapped = mergedItems
    .map((item) => hybridItemToRanked(item, ctx.memoryIdToBenchmarkId, ctx.contentByBenchmarkId))
    .filter((row): row is RankedBenchmarkResult => row !== null)
    .filter((row) => !forbidden.has(row.benchmarkId))
    .filter((row) => {
      const meta = ctx.safetyMetaByBenchmarkId.get(row.benchmarkId);
      if (!meta) {
        return true;
      }
      if (meta.ownerId && meta.ownerId !== queryRow.scope_owner_id) {
        return false;
      }
      if (meta.isDeleted || meta.supersededByBenchmarkId) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.score - a.score);
  const trimmed = trimCandidatePool(mapped, ctx.constants.candidatePoolLimit);
  return selectWithinTokenBudget(trimmed, ctx.constants.tokenBudget);
}

export async function evaluateQueryHybridOnly(
  ctx: RelationBfsEvalContext,
  queryRow: RelationKoPanelQueryRow,
  cached?: HybridSearchSnapshot,
): Promise<PerQueryEvalOutcome> {
  const { items, latencyMs } = cached
    ? { items: cached.items, latencyMs: 0 }
    : await runHybridSearch(ctx, queryRow);
  const metaByBenchmark = new Map<string, MemorySafetyMeta>();
  for (const [id, meta] of ctx.safetyMetaByBenchmarkId) {
    metaByBenchmark.set(id, toSafetyMeta(meta));
  }
  const forbidden = ctx.forbiddenByQueryId.get(queryRow.query_id) ?? [];
  const rawIds = rankedBenchmarkIdsBeforeHarnessSafetyFilter(items, ctx);
  const rawSafetyViolations = countSafetyViolations(
    rawIds,
    metaByBenchmark,
    queryRow.scope_owner_id,
    forbidden,
  );
  const ranked = finalizeRanked(items, ctx, queryRow);
  const safetyViolations = countSafetyViolations(
    ranked.map((r) => r.benchmarkId),
    metaByBenchmark,
    queryRow.scope_owner_id,
    forbidden,
  );
  return {
    queryId: queryRow.query_id,
    category: queryRow.category,
    ranked,
    latencyMs,
    returnedTokens: ranked.reduce((sum, row) => sum + row.tokenEstimate, 0),
    rawSafetyViolations,
    safetyViolations,
  };
}

export async function evaluateQueryHybridWithBfs(
  ctx: RelationBfsEvalContext,
  queryRow: RelationKoPanelQueryRow,
  hyper: RelationBfsHyperparams,
  cached?: HybridSearchSnapshot,
  measureLatency = true,
): Promise<PerQueryEvalOutcome> {
  let hybridMs = 0;
  let items: HybridSearchResult[];
  if (cached) {
    items = cached.items;
  } else {
    const run = await runHybridSearch(ctx, queryRow);
    items = run.items;
    hybridMs = run.latencyMs;
  }

  const bfsStarted = measureLatency ? performance.now() : 0;
  const merged = await collectMergedPoolForQuery(ctx, queryRow, hyper, items);
  const bfsMs = measureLatency ? performance.now() - bfsStarted : 0;
  const metaByBenchmark = new Map<string, MemorySafetyMeta>();
  for (const [id, meta] of ctx.safetyMetaByBenchmarkId) {
    metaByBenchmark.set(id, toSafetyMeta(meta));
  }
  const forbidden = ctx.forbiddenByQueryId.get(queryRow.query_id) ?? [];
  const rawIds = rankedBenchmarkIdsBeforeHarnessSafetyFilter(merged, ctx);
  const rawSafetyViolations = countSafetyViolations(
    rawIds,
    metaByBenchmark,
    queryRow.scope_owner_id,
    forbidden,
  );
  const ranked = finalizeRanked(merged, ctx, queryRow);
  const safetyViolations = countSafetyViolations(
    ranked.map((r) => r.benchmarkId),
    metaByBenchmark,
    queryRow.scope_owner_id,
    forbidden,
  );
  return {
    queryId: queryRow.query_id,
    category: queryRow.category,
    ranked,
    latencyMs: hybridMs + bfsMs,
    returnedTokens: ranked.reduce((sum, row) => sum + row.tokenEstimate, 0),
    rawSafetyViolations,
    safetyViolations,
  };
}

/** Warm-up 이후, 쿼리별 A/B 검색 지연을 번갈아 측정한다. */
export async function measurePairedSearchLatencies(
  ctx: RelationBfsEvalContext,
  queryRow: RelationKoPanelQueryRow,
  hyper: RelationBfsHyperparams,
): Promise<{ hybridOnlyMs: number; hybridWithBfsMs: number }> {
  const orderBFirst = queryRow.query_id.charCodeAt(queryRow.query_id.length - 1)! % 2 === 0;

  const runHybridOnly = async (): Promise<number> => {
    const t0 = performance.now();
    await runHybridSearch(ctx, queryRow);
    return performance.now() - t0;
  };

  const runHybridWithBfs = async (): Promise<number> => {
    const t0 = performance.now();
    const hybrid = await runHybridSearch(ctx, queryRow);
    await collectMergedPoolForQuery(ctx, queryRow, hyper, hybrid.items);
    return performance.now() - t0;
  };

  if (orderBFirst) {
    const hybridWithBfsMs = await runHybridWithBfs();
    const hybridOnlyMs = await runHybridOnly();
    return { hybridOnlyMs, hybridWithBfsMs };
  }
  const hybridOnlyMs = await runHybridOnly();
  const hybridWithBfsMs = await runHybridWithBfs();
  return { hybridOnlyMs, hybridWithBfsMs };
}

export const DEFAULT_BFS_TUNE_GRID: readonly RelationBfsHyperparams[] = (() => {
  const grid: RelationBfsHyperparams[] = [];
  for (const maxHops of [1, 2, 3]) {
    for (const maxSeeds of [3, 5]) {
      for (const bfsLimit of [15, 25, 35]) {
        grid.push({ maxHops, maxSeeds, bfsLimit });
      }
    }
  }
  return grid;
})();

export interface DevGridRow {
  key: string;
  hyper: RelationBfsHyperparams;
  multiHopRecallAt10: number;
  singleFactRecallAt10: number;
  irrelevantTrapRecallAt10: number;
  overallRecallAt10: number;
}

export function buildDevGridRows(
  devOutcomesByHyper: ReadonlyMap<string, readonly PerQueryEvalOutcome[]>,
  groundTruths: ReadonlyMap<string, { relevantIds: string[] }>,
  queryCategoryById: ReadonlyMap<string, RelationKoPanelQueryRow['category']>,
): DevGridRow[] {
  const rows: DevGridRow[] = [];
  for (const hyper of DEFAULT_BFS_TUNE_GRID) {
    const key = hyperKey(hyper);
    const outcomes = devOutcomesByHyper.get(key) ?? [];
    rows.push({
      key,
      hyper,
      multiHopRecallAt10: categoryRecallAt10(outcomes, groundTruths, queryCategoryById, 'multi_hop'),
      singleFactRecallAt10: categoryRecallAt10(outcomes, groundTruths, queryCategoryById, 'single_fact'),
      irrelevantTrapRecallAt10: categoryRecallAt10(
        outcomes,
        groundTruths,
        queryCategoryById,
        'irrelevant_trap',
      ),
      overallRecallAt10: categoryRecallAt10(outcomes, groundTruths, queryCategoryById, null),
    });
  }
  return rows;
}

function categoryRecallAt10(
  outcomes: readonly PerQueryEvalOutcome[],
  groundTruths: ReadonlyMap<string, { relevantIds: string[] }>,
  queryCategoryById: ReadonlyMap<string, RelationKoPanelQueryRow['category']>,
  category: RelationKoPanelQueryRow['category'] | null,
): number {
  const filtered =
    category === null
      ? outcomes
      : outcomes.filter((o) => queryCategoryById.get(o.queryId) === category);
  if (filtered.length === 0) {
    return 0;
  }
  let hits = 0;
  for (const outcome of filtered) {
    const gt = groundTruths.get(outcome.queryId);
    if (!gt) {
      continue;
    }
    if (outcome.ranked.slice(0, 10).some((row) => gt.relevantIds.includes(row.benchmarkId))) {
      hits++;
    }
  }
  return hits / filtered.length;
}

export function pickBestHyperparamsOnDev(
  devGrid: readonly DevGridRow[],
): RelationBfsHyperparams {
  let best = devGrid[0]?.hyper ?? DEFAULT_BFS_TUNE_GRID[0]!;
  let bestMulti = -1;
  let bestOverall = -1;
  let bestKey = '';
  for (const row of devGrid) {
    if (
      row.multiHopRecallAt10 > bestMulti ||
      (row.multiHopRecallAt10 === bestMulti && row.overallRecallAt10 > bestOverall) ||
      (row.multiHopRecallAt10 === bestMulti &&
        row.overallRecallAt10 === bestOverall &&
        row.key < bestKey)
    ) {
      bestMulti = row.multiHopRecallAt10;
      bestOverall = row.overallRecallAt10;
      bestKey = row.key;
      best = row.hyper;
    }
  }
  return best;
}

export function hyperKey(hyper: RelationBfsHyperparams): string {
  return `h${hyper.maxHops}-s${hyper.maxSeeds}-l${hyper.bfsLimit}`;
}

export function formatDevGridMarkdown(rows: readonly DevGridRow[]): string {
  const header =
    '| key | maxHops | maxSeeds | bfsLimit | multi_hop R@10 | single_fact R@10 | trap R@10 | overall R@10 |\n' +
    '|---|---:|---:|---:|---:|---:|---:|---:|';
  const body = rows
    .map(
      (row) =>
        `| ${row.key} | ${row.hyper.maxHops} | ${row.hyper.maxSeeds} | ${row.hyper.bfsLimit} | ` +
        `${row.multiHopRecallAt10.toFixed(3)} | ${row.singleFactRecallAt10.toFixed(3)} | ` +
        `${row.irrelevantTrapRecallAt10.toFixed(3)} | ${row.overallRecallAt10.toFixed(3)} |`,
    )
    .join('\n');
  return `${header}\n${body}`;
}

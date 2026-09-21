/**
 * #959 PoC: relation-based recall candidate expansion (opt-in only).
 */

import type Database from 'better-sqlite3';
import type { MemorySearchFilters } from '../../../shared/types/search.types.js';
import { buildMemoryFilterSql, hasMemoryFilter } from '../../../shared/utils/memory-filter-sql.js';
import { logger } from '../../../shared/utils/logger.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import type { HybridRelationGraphReader } from './hybrid-search-types.js';
import type {
  HybridSearchQuery,
  HybridSearchResult,
  HybridWeights,
} from './hybrid-search-types.js';
import type { HybridResultRanker } from './hybrid-result-ranker.js';

export type RelationRecallExpansionMode = 'off' | 'plain' | 'weighted';

export const RELATION_RECALL_EXPANSION_LIMITS = {
  maxSeeds: 5,
  maxHops: 2,
  maxAdditions: 30,
} as const;

/** Explicit hop decay for weighted propagation (0.5^hop). */
export function relationRecallHopDecay(hopDistance: number, decayBase = 0.5): number {
  if (hopDistance <= 0) {
    return 1;
  }
  return Math.pow(decayBase, hopDistance);
}

export type DiscoveredRelationCandidate = {
  memory_id: string;
  hop_distance: number;
  path_confidence: number;
  propagated_weight: number;
};

type FrontierNode = {
  memory_id: string;
  hop_distance: number;
  path_confidence: number;
};

function isExpansionEnabled(mode: RelationRecallExpansionMode | undefined): mode is 'plain' | 'weighted' {
  return mode === 'plain' || mode === 'weighted';
}

/** Tenant access boundaries only — not type/tags/time search filters. */
function pickTraversalBoundaryFilters(
  filters: MemorySearchFilters | undefined
): MemorySearchFilters | undefined {
  if (!filters) {
    return undefined;
  }
  const boundary: MemorySearchFilters = {};
  if (filters.project_id !== undefined && filters.project_id !== null && filters.project_id !== '') {
    boundary.project_id = filters.project_id;
  }
  if (filters.owner_id !== undefined && filters.owner_id !== null) {
    boundary.owner_id = filters.owner_id;
  }
  if (filters.process_id !== undefined && filters.process_id !== null) {
    boundary.process_id = filters.process_id;
  }
  if (filters.session_id !== undefined && filters.session_id !== null) {
    boundary.session_id = filters.session_id;
  }
  return hasMemoryFilter(boundary) ? boundary : undefined;
}

type ScopeCheckStatement = {
  get(memoryId: string): boolean;
};

function createScopeCheckStatement(
  db: Database.Database,
  filters: MemorySearchFilters | undefined
): ScopeCheckStatement {
  const liveClause = '(COALESCE(m.is_deleted, 0) = 0)';
  const { clauses, params } = buildMemoryFilterSql(filters, { itemAlias: 'm' });
  const filterClauses = clauses.length > 0 ? clauses.join(' AND ') : null;
  const sql = filterClauses
    ? `SELECT 1 AS ok FROM memory_item m WHERE m.id = ? AND ${liveClause} AND ${filterClauses} LIMIT 1`
    : `SELECT 1 AS ok FROM memory_item m WHERE m.id = ? AND ${liveClause} LIMIT 1`;
  const stmt = db.prepare(sql);
  return {
    get(memoryId: string): boolean {
      const row = stmt.get(memoryId, ...params) as { ok: number } | undefined;
      return row !== undefined;
    },
  };
}

/** Live record + tenant boundaries for graph traversal intermediaries. */
export function memoryPassesTraversalBoundary(
  db: Database.Database,
  memoryId: string,
  filters: MemorySearchFilters | undefined,
  scopeCheck?: ScopeCheckStatement
): boolean {
  const checker =
    scopeCheck ?? createScopeCheckStatement(db, pickTraversalBoundaryFilters(filters));
  return checker.get(memoryId);
}

/** Full recall filters for expanded candidates returned to the result set. */
export function memoryPassesRecallScopeFilters(
  db: Database.Database,
  memoryId: string,
  filters: MemorySearchFilters | undefined,
  scopeCheck?: ScopeCheckStatement
): boolean {
  if (!hasMemoryFilter(filters)) {
    return memoryPassesTraversalBoundary(db, memoryId, filters, scopeCheck);
  }
  const checker = scopeCheck ?? createScopeCheckStatement(db, filters);
  return checker.get(memoryId);
}

function isBetterDiscoveredPath(
  mode: 'plain' | 'weighted',
  candidate: DiscoveredRelationCandidate,
  prev: DiscoveredRelationCandidate
): boolean {
  if (mode === 'weighted') {
    return candidate.propagated_weight > prev.propagated_weight;
  }
  return (
    candidate.hop_distance < prev.hop_distance ||
    (candidate.hop_distance === prev.hop_distance &&
      candidate.path_confidence > prev.path_confidence)
  );
}

function resolveNeighborId(
  memoryId: string,
  relation: { source_id: string; target_id: string }
): string {
  return relation.source_id === memoryId ? relation.target_id : relation.source_id;
}

export type RelationRecallDiscoveryResult = {
  /** Previously absent candidates (max 30). */
  additions: DiscoveredRelationCandidate[];
  /** Weighted mode: best hop-decayed score per reachable memory (includes in-pool targets). */
  propagatedWeights: Map<string, number>;
};

export async function discoverRelationRecallCandidates(
  db: Database.Database,
  relationGraph: HybridRelationGraphReader,
  seedMemoryIds: string[],
  existingIds: ReadonlySet<string>,
  filters: MemorySearchFilters | undefined,
  mode: 'plain' | 'weighted'
): Promise<RelationRecallDiscoveryResult> {
  const seeds = seedMemoryIds.slice(0, RELATION_RECALL_EXPANSION_LIMITS.maxSeeds);
  const traversalScopeCheck = createScopeCheckStatement(db, pickTraversalBoundaryFilters(filters));
  const candidateScopeCheck = createScopeCheckStatement(db, filters);
  const bestById = new Map<string, DiscoveredRelationCandidate>();
  const propagatedWeights = new Map<string, number>();
  let frontier: FrontierNode[] = seeds
    .filter((id) => memoryPassesTraversalBoundary(db, id, filters, traversalScopeCheck))
    .map((memory_id) => ({ memory_id, hop_distance: 0, path_confidence: 1 }));

  while (frontier.length > 0) {
    const batch = frontier;
    frontier = [];
    const batchIds = batch.map((node) => node.memory_id);
    const relationsByMemory = await relationGraph.getRelationsBatch(batchIds, {
      direction: 'both',
      minConfidence: 0,
    });

    for (const node of batch) {
      if (node.hop_distance >= RELATION_RECALL_EXPANSION_LIMITS.maxHops) {
        continue;
      }

      const relations = relationsByMemory.get(node.memory_id) ?? [];
      for (const relation of relations) {
        const neighborId = resolveNeighborId(node.memory_id, relation);
        if (!memoryPassesTraversalBoundary(db, neighborId, filters, traversalScopeCheck)) {
          continue;
        }

        const hop_distance = node.hop_distance + 1;
        const path_confidence = node.path_confidence * relation.confidence;
        const propagated_weight =
          mode === 'weighted'
            ? path_confidence * relationRecallHopDecay(hop_distance)
            : 0;

        const candidate: DiscoveredRelationCandidate = {
          memory_id: neighborId,
          hop_distance,
          path_confidence,
          propagated_weight,
        };
        const prev = bestById.get(neighborId);
        const pathImproves = !prev || isBetterDiscoveredPath(mode, candidate, prev);
        if (hop_distance > 0 && pathImproves) {
          bestById.set(neighborId, candidate);
        }
        if (mode === 'weighted' && propagated_weight > 0) {
          const prevWeight = propagatedWeights.get(neighborId) ?? 0;
          if (propagated_weight > prevWeight) {
            propagatedWeights.set(neighborId, propagated_weight);
          }
        }

        const shouldExpand =
          hop_distance < RELATION_RECALL_EXPANSION_LIMITS.maxHops && pathImproves;
        if (shouldExpand) {
          frontier.push({
            memory_id: neighborId,
            hop_distance,
            path_confidence,
          });
        }
      }
    }
  }

  const additions = [...bestById.values()]
    .filter(
      (candidate) =>
        !existingIds.has(candidate.memory_id) &&
        memoryPassesRecallScopeFilters(db, candidate.memory_id, filters, candidateScopeCheck)
    )
    .sort((a, b) =>
      mode === 'weighted'
        ? b.propagated_weight - a.propagated_weight || a.hop_distance - b.hop_distance
        : a.hop_distance - b.hop_distance || b.path_confidence - a.path_confidence
    )
    .slice(0, RELATION_RECALL_EXPANSION_LIMITS.maxAdditions);

  return { additions, propagatedWeights };
}

type MemoryRow = {
  id: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed_at: string | null;
  pinned: number;
  tags: string | null;
  project_id: string | null;
  owner_id: string | null;
  process_id: string | null;
  session_id: string | null;
};

function parseTags(raw: string | null): string[] | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function loadHybridResultsForMemoryIds(
  db: Database.Database,
  memoryIds: string[],
  existingById: ReadonlyMap<string, HybridSearchResult>
): HybridSearchResult[] {
  const missing = memoryIds.filter((id) => !existingById.has(id));
  if (missing.length === 0) {
    return [];
  }

  const placeholders = missing.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, content, type, importance, created_at, last_accessed_at, pinned, tags,
              project_id, owner_id, process_id, session_id
       FROM memory_item
       WHERE id IN (${placeholders}) AND is_deleted = 0`
    )
    .all(...missing) as MemoryRow[];

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    type: row.type,
    importance: row.importance,
    created_at: row.created_at,
    last_accessed: row.last_accessed_at ?? undefined,
    pinned: Boolean(row.pinned),
    tags: parseTags(row.tags),
    textScore: 0,
    vectorScore: 0,
    finalScore: 0,
    recall_reason: '관계 확장 후보',
    project_id: row.project_id,
    owner_id: row.owner_id,
    process_id: row.process_id,
    session_id: row.session_id,
  }));
}

export async function applyRelationRecallCandidateExpansion(args: {
  db: Database.Database;
  query: HybridSearchQuery;
  mode: RelationRecallExpansionMode;
  primaryRanked: HybridSearchResult[];
  resultRanker: HybridResultRanker;
  relationGraph: HybridRelationGraphReader | null;
  weights: HybridWeights;
  outputLimit: number;
  includeRelations: boolean;
}): Promise<HybridSearchResult[]> {
  const {
    db,
    query,
    mode,
    primaryRanked,
    resultRanker,
    relationGraph,
    weights,
    outputLimit,
    includeRelations,
  } = args;

  if (!isExpansionEnabled(mode)) {
    return primaryRanked.slice(0, outputLimit);
  }

  if (!relationGraph) {
    logger.warn('[relation-recall-expansion] relation graph unavailable — returning primary ranking', {
      mode,
    });
    return primaryRanked.slice(0, outputLimit);
  }

  try {
    const seeds = primaryRanked.slice(0, RELATION_RECALL_EXPANSION_LIMITS.maxSeeds).map((item) => item.id);
    const existingIds = new Set(primaryRanked.map((item) => item.id));
    const { additions: discovered, propagatedWeights } = await discoverRelationRecallCandidates(
      db,
      relationGraph,
      seeds,
      existingIds,
      query.filters,
      mode
    );

    const shouldRerank =
      mode === 'weighted'
        ? propagatedWeights.size > 0 || discovered.length > 0
        : discovered.length > 0;

    if (!shouldRerank) {
      return primaryRanked.slice(0, outputLimit);
    }

    const existingById = new Map(primaryRanked.map((item) => [item.id, item]));
    const additionStubs = loadHybridResultsForMemoryIds(
      db,
      discovered.map((item) => item.memory_id),
      existingById
    );
    const merged = [...primaryRanked, ...additionStubs];
    const propagatedRelationWeights =
      mode === 'weighted' ? propagatedWeights : undefined;

    return resultRanker.rerankExpandedResults(
      merged,
      weights,
      outputLimit,
      db,
      includeRelations,
      query,
      propagatedRelationWeights
    );
  } catch (error) {
    const maskedError = error instanceof Error
      ? PIIMasker.maskError(error)
      : { message: String(error), name: 'Error' };
    logger.warn('[relation-recall-expansion] expansion failed — returning primary ranking', {
      mode,
      error: maskedError.message,
    });
    return primaryRanked.slice(0, outputLimit);
  }
}

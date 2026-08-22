/**
 * remember write-path near-duplicate detection (Issue #730)
 */

import type Database from 'better-sqlite3';
import type { MemoryTypeRequest } from '../../../shared/types/memory.types.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { getVectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';
import type { ToolContext } from '../../../tools/types.js';
import type { RememberToolHost } from './remember-tool-host.js';
import type { ProceduralMemoryItem } from './remember-tool-types.js';
import type { RememberParams } from './remember-tool-schema.js';

export interface NearDuplicateCandidate {
  id: string;
  similarity: number;
}

export interface SimilarityWarning {
  count: number;
  similar_ids: string[];
  candidates: NearDuplicateCandidate[];
  suggestion?: 'incremental';
  action?: 'warned' | 'merged' | 'rejected';
}

const NEAR_DUP_MERGE_TYPES = new Set<MemoryTypeRequest>(['working', 'episodic', 'semantic']);

export function isNearDupMergeType(type: MemoryTypeRequest): boolean {
  return NEAR_DUP_MERGE_TYPES.has(type);
}

export function buildSimilarityWarningFromCandidates(
  candidates: NearDuplicateCandidate[],
  action?: SimilarityWarning['action'],
): SimilarityWarning | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  return {
    count: candidates.length,
    similar_ids: candidates.map((c) => c.id),
    candidates,
    suggestion: 'incremental',
    ...(action ? { action } : {}),
  };
}

function scopeMatchesHit(
  scope: { ownerId: string | null; projectId: string | null },
  hit: { owner_id?: string | null; project_id?: string | null },
): boolean {
  // Prefer hit metadata from KNN JOIN (no per-hit SELECT). null≡null.
  return String(hit.owner_id ?? '') === String(scope.ownerId ?? '')
    && String(hit.project_id ?? '') === String(scope.projectId ?? '');
}

export async function findNearDuplicateCandidates(
  db: Database.Database,
  content: string,
  scope: { type: MemoryTypeRequest; ownerId: string | null; projectId: string | null },
  threshold: number,
  context: ToolContext,
  host?: RememberToolHost,
): Promise<NearDuplicateCandidate[]> {
  try {
    const embSvc = context.services?.embeddingService;
    if (!embSvc?.isAvailable()) {
      return [];
    }

    const vecEng = context.services?.vectorSearchEngine ?? getVectorSearchEngine();
    vecEng.initialize(db);
    const unified = embSvc.getUnifiedEmbeddingService();
    const qEmb = await unified.generateEmbedding(content);
    if (!qEmb?.embedding || !Array.isArray(qEmb.embedding)) {
      return [];
    }

    const prov = unified.getCurrentProviderName() ?? 'tfidf';
    const hits = await vecEng.search(
      qEmb.embedding,
      {
        limit: 8,
        threshold,
        types: [scope.type],
        ...(scope.ownerId ? { owner_id: scope.ownerId } : {}),
        ...(scope.projectId ? { project_id: scope.projectId } : {}),
      },
      prov,
    );

    return hits
      .filter((hit) => hit.similarity >= threshold && scopeMatchesHit(scope, hit))
      .map((hit) => ({ id: hit.memory_id, similarity: hit.similarity }));
  } catch (error) {
    host?.logWarning('near-dup candidate search failed (fail-open)', {
      error: error instanceof Error ? error.message : String(error),
      type: scope.type,
    });
    return [];
  }
}

export async function loadMemoryItemForNearDupMerge(
  db: Database.Database,
  memoryId: string,
  host: RememberToolHost,
): Promise<ProceduralMemoryItem | null> {
  try {
    const row = await DatabaseUtils.get(db, `
      SELECT
        id, type, content, importance, privacy_scope,
        created_at, last_accessed, pinned, tags, source,
        task_goal, steps, reflection_notes,
        workflow_name, skill_name, trigger_conditions,
        recall_count, last_accessed_at, g_value, consolidation_score,
        version, version_series_id, num_times
      FROM memory_item
      WHERE id = ? AND (COALESCE(is_deleted, 0) = 0)
    `, [memoryId]);

    if (!row) {
      return null;
    }

    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      type: r.type as ProceduralMemoryItem['type'],
      content: r.content as string,
      importance: r.importance as number,
      privacy_scope: r.privacy_scope as ProceduralMemoryItem['privacy_scope'],
      created_at: new Date(r.created_at as string),
      last_accessed: r.last_accessed ? new Date(r.last_accessed as string) : undefined,
      pinned: Boolean(r.pinned),
      tags: r.tags ? JSON.parse(r.tags as string) : undefined,
      source: (r.source as string | null) || undefined,
      task_goal: r.task_goal as string | undefined,
      steps: r.steps as string | undefined,
      reflection_notes: r.reflection_notes as string | undefined,
      workflow_name: r.workflow_name as string | undefined,
      skill_name: r.skill_name as string | undefined,
      trigger_conditions: r.trigger_conditions as string | undefined,
      recall_count: r.recall_count as number | undefined,
      g_value: r.g_value as number | undefined,
      last_accessed_at: r.last_accessed_at != null
        ? new Date(r.last_accessed_at as string)
        : undefined,
      version: r.version as number | undefined,
      version_series_id: r.version_series_id as string | undefined,
      consolidation_score: r.consolidation_score as number | undefined,
      num_times: r.num_times as number | undefined,
    } as ProceduralMemoryItem;
  } catch (error) {
    host.logWarning('near-dup merge 대상 memory 조회 실패', {
      memory_id: memoryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** near-dup incremental merge용 params 보정 (Assumptions §6) */
export function applyNearDupMergeInputs(
  params: RememberParams,
  numTimes: number,
  existing: ProceduralMemoryItem,
  type: MemoryTypeRequest,
): { params: RememberParams; numTimes: number; existing: ProceduralMemoryItem } {
  const requestImportance = params.importance ?? 0.5;
  const tagSet = new Set<string>([...(existing.tags ?? []), ...(params.tags ?? [])]);
  const mergedTags = tagSet.size > 0 ? [...tagSet] : undefined;
  const mergedNumTimes = type === 'semantic'
    ? (existing.num_times ?? 1) + 1
    : numTimes;

  return {
    params: {
      ...params,
      importance: Math.max(existing.importance, requestImportance),
      ...(mergedTags ? { tags: mergedTags } : {}),
    },
    numTimes: mergedNumTimes,
    existing: {
      ...existing,
      last_accessed_at: new Date(),
    },
  };
}

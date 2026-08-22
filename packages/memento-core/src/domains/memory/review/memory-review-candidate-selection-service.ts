/**
 * Memory review candidate selection — DB-backed scan + scoring (Issue #241).
 */

import Database from 'better-sqlite3';
import { ensureMetaMemoryStatsSchema } from '../../../shared/utils/ensure-meta-memory-stats-schema.js';
import { ensureMemoryReviewCandidateSchema } from '../../../shared/utils/ensure-memory-review-candidate-schema.js';
import { parseMemoryReviewSelectionEnv } from './memory-review-candidate-selection-env.js';
import {
  buildReason,
  buildScoreBreakdown,
  computePriority,
  computeStaleDays,
  computeStaleRatio,
  passesEligibility,
  resolveStaleAnchor,
} from './memory-review-candidate-selection-scoring.js';
import type {
  MemoryReviewCandidateSelectionItem,
  MemoryReviewCandidateSelectionOptions,
  MemoryReviewCandidateSourceRow,
} from './memory-review-candidate-selection.types.js';

const SELECT_CANDIDATE_ROWS_SQL = `
SELECT
  m.id AS memory_id,
  m.importance AS importance,
  m.pinned AS pinned,
  m.is_deleted AS is_deleted,
  m.deleted_at AS deleted_at,
  m.created_at AS created_at,
  s.last_recalled_at AS last_recalled_at
FROM memory_item m
LEFT JOIN meta_memory_stats s ON s.memory_id = m.id
WHERE (m.pinned = 0 OR m.pinned IS NULL)
  AND m.is_deleted = 0
  AND (m.deleted_at IS NULL OR m.deleted_at = '')
  AND m.importance >= ?
  AND NOT EXISTS (
    SELECT 1 FROM memory_review_candidate c
    WHERE c.memory_id = m.id AND c.status = 'pending'
  )
ORDER BY m.importance DESC, COALESCE(s.last_recalled_at, m.created_at) ASC
LIMIT ?
`;

export function selectionWindowLimit(maxCandidates: number): number {
  return Math.max(maxCandidates * 10, 200);
}

export function selectMemoryReviewCandidates(
  db: Database.Database,
  options?: Partial<MemoryReviewCandidateSelectionOptions>,
): MemoryReviewCandidateSelectionItem[] {
  ensureMetaMemoryStatsSchema(db);
  ensureMemoryReviewCandidateSchema(db);

  const env = parseMemoryReviewSelectionEnv();
  const merged: MemoryReviewCandidateSelectionOptions = {
    importanceThreshold: options?.importanceThreshold ?? env.importanceThreshold,
    staleDays: options?.staleDays ?? env.staleDays,
    maxCandidates: options?.maxCandidates ?? env.maxCandidates,
    now: options?.now ?? new Date(),
  };

  const stmt = db.prepare(SELECT_CANDIDATE_ROWS_SQL);
  const rows = stmt.all(
    merged.importanceThreshold,
    selectionWindowLimit(merged.maxCandidates),
  ) as MemoryReviewCandidateSourceRow[];

  const items: MemoryReviewCandidateSelectionItem[] = [];
  for (const row of rows) {
    if (!passesEligibility(row, merged)) continue;
    const resolved = resolveStaleAnchor(row);
    if (!resolved) continue;
    const staleDays = computeStaleDays(resolved.instant, merged.now);
    const staleRatio = computeStaleRatio(staleDays, merged.staleDays);
    const priority = computePriority(row.importance, staleRatio);
    const score_breakdown = buildScoreBreakdown(row, merged);
    const reason = buildReason(score_breakdown);
    items.push({ memory_id: row.memory_id, priority, reason, score_breakdown });
  }

  items.sort((a, b) => b.priority - a.priority);
  return items.slice(0, merged.maxCandidates);
}

import type {
  MemoryReviewCandidateFiltersApplied,
  MemoryReviewCandidateListItem,
  MemoryReviewCandidatePagination,
  MemoryReviewCandidateStatus,
  MemoryReviewCandidateUnusedAnchor,
  QueryMemoryReviewCandidatesInput,
} from './memory-review-candidate-persistence.types.js';

export const MEMORY_REVIEW_CANDIDATE_PAGE_SIZES = [25, 50] as const;
export type MemoryReviewCandidatePageSize = (typeof MEMORY_REVIEW_CANDIDATE_PAGE_SIZES)[number];

export const MEMORY_REVIEW_MEMORY_TYPES = ['working', 'episodic', 'semantic', 'procedural'] as const;
export type MemoryReviewMemoryType = (typeof MEMORY_REVIEW_MEMORY_TYPES)[number];

/** Default importance when memory_item.importance is NULL (matches column DEFAULT 0.5). */
export const MEMORY_REVIEW_IMPORTANCE_FALLBACK = 0.5;

const UNUSED_ANCHOR_DATE_EXPR = `COALESCE(NULLIF(TRIM(s.last_recalled_at), ''), NULLIF(TRIM(m.created_at), ''), c.created_at)`;
const UNUSED_DAYS_EXPR = `CAST((julianday(@now) - julianday(${UNUSED_ANCHOR_DATE_EXPR})) AS INTEGER)`;
const IMPORTANCE_EXPR = `COALESCE(m.importance, ${MEMORY_REVIEW_IMPORTANCE_FALLBACK})`;
const UNUSED_ANCHOR_EXPR = `CASE
  WHEN s.last_recalled_at IS NOT NULL AND TRIM(s.last_recalled_at) != '' THEN 'last_recalled_at'
  ELSE 'created_at_fallback'
END`;

const SELECT_COLUMNS = `
  c.id,
  c.memory_id,
  c.status,
  c.priority,
  c.reason,
  c.due_at,
  c.created_at,
  c.updated_at,
  c.reviewed_at,
  c.dismissed_at,
  c.metadata_json,
  m.type AS memory_type,
  ${IMPORTANCE_EXPR} AS importance,
  ${UNUSED_DAYS_EXPR} AS unused_days,
  ${UNUSED_ANCHOR_EXPR} AS unused_anchor
`;

const FROM_JOIN = `
  FROM memory_review_candidate c
  INNER JOIN memory_item m ON m.id = c.memory_id
  LEFT JOIN meta_memory_stats s ON s.memory_id = m.id
`;

export interface BuiltMemoryReviewCandidateListSql {
  whereSql: string;
  params: Record<string, unknown>;
  filtersApplied: MemoryReviewCandidateFiltersApplied;
}

function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function buildMemoryReviewCandidateListSql(
  input: QueryMemoryReviewCandidatesInput,
  nowIso: string,
): BuiltMemoryReviewCandidateListSql {
  const clauses: string[] = [];
  const params: Record<string, unknown> = { now: nowIso };
  const filtersApplied: MemoryReviewCandidateFiltersApplied = {};

  if (input.status) {
    clauses.push(`c.status = @status`);
    params.status = input.status;
    filtersApplied.status = input.status;
  }
  if (input.importance_min !== undefined) {
    clauses.push(`${IMPORTANCE_EXPR} >= @importance_min`);
    params.importance_min = input.importance_min;
    filtersApplied.importance_min = input.importance_min;
  }
  if (input.importance_max !== undefined) {
    clauses.push(`${IMPORTANCE_EXPR} <= @importance_max`);
    params.importance_max = input.importance_max;
    filtersApplied.importance_max = input.importance_max;
  }
  if (input.unused_days_min !== undefined) {
    clauses.push(`${UNUSED_DAYS_EXPR} >= @unused_days_min`);
    params.unused_days_min = input.unused_days_min;
    filtersApplied.unused_days_min = input.unused_days_min;
  }
  if (input.unused_days_max !== undefined) {
    clauses.push(`${UNUSED_DAYS_EXPR} <= @unused_days_max`);
    params.unused_days_max = input.unused_days_max;
    filtersApplied.unused_days_max = input.unused_days_max;
  }
  if (input.memory_type) {
    clauses.push(`m.type = @memory_type`);
    params.memory_type = input.memory_type;
    filtersApplied.memory_type = input.memory_type;
  }
  if (input.reason_contains) {
    clauses.push(`c.reason LIKE @reason_contains ESCAPE '\\'`);
    params.reason_contains = `%${escapeLikePattern(input.reason_contains)}%`;
    filtersApplied.reason_contains = input.reason_contains;
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { whereSql, params, filtersApplied };
}

export function buildMemoryReviewCandidateCountSql(built: BuiltMemoryReviewCandidateListSql): {
  sql: string;
  params: Record<string, unknown>;
} {
  return {
    sql: `SELECT COUNT(*) AS count ${FROM_JOIN} ${built.whereSql}`,
    params: built.params,
  };
}

export function buildMemoryReviewCandidateSelectSql(
  built: BuiltMemoryReviewCandidateListSql,
  pagination?: MemoryReviewCandidatePagination,
): { sql: string; params: Record<string, unknown> } {
  const params = { ...built.params };
  let limitSql = '';
  if (pagination) {
    limitSql = ` LIMIT @limit OFFSET @offset`;
    params.limit = pagination.page_size;
    params.offset = (pagination.page - 1) * pagination.page_size;
  }
  return {
    sql: `SELECT ${SELECT_COLUMNS} ${FROM_JOIN} ${built.whereSql} ORDER BY c.priority DESC, c.due_at ASC${limitSql}`,
    params,
  };
}

export function mapMemoryReviewCandidateListRow(
  row: Record<string, unknown>,
): MemoryReviewCandidateListItem {
  const unusedAnchor = String(row.unused_anchor ?? 'created_at_fallback');
  return {
    id: String(row.id),
    memory_id: String(row.memory_id),
    status: row.status as MemoryReviewCandidateStatus,
    priority: Number(row.priority),
    reason: String(row.reason),
    due_at: String(row.due_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    reviewed_at: row.reviewed_at == null ? null : String(row.reviewed_at),
    dismissed_at: row.dismissed_at == null ? null : String(row.dismissed_at),
    metadata_json: row.metadata_json == null ? null : String(row.metadata_json),
    memory_type: String(row.memory_type),
    importance: Number(row.importance),
    unused_days: Number(row.unused_days),
    unused_anchor: unusedAnchor as MemoryReviewCandidateUnusedAnchor,
  };
}

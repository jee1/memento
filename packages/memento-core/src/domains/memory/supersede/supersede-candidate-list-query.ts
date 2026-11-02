import type { SupersedeVerdict } from './supersede-judge.js';
import type {
  QuerySupersedeCandidatesInput,
  SupersedeCandidateFiltersApplied,
  SupersedeCandidateLifecycleStatus,
} from './supersede-candidate-list.types.js';
import { SUPERSEDE_LIST_DEFAULT_VERDICTS } from './supersede-candidate-list.types.js';

const SUPERSEDE_CONTENT_PREVIEW_CHARS = 200;

const SUPERSEDE_LIFECYCLE_STATUS_EXPR = `CASE
  WHEN c.dismissed_at IS NOT NULL THEN 'dismissed'
  WHEN m_old.superseded_by = c.new_memory_id THEN 'applied'
  WHEN m_old.superseded_by IS NULL AND EXISTS (
    SELECT 1 FROM memory_supersede_event e_applied
    WHERE e_applied.candidate_id = c.id AND e_applied.action = 'applied'
  ) THEN 'restored'
  ELSE 'not_applied'
END`;

const FROM_JOIN = `
  FROM memory_supersede_candidate c
  INNER JOIN memory_item m_old ON m_old.id = c.old_memory_id
  INNER JOIN memory_item m_new ON m_new.id = c.new_memory_id
`;

interface BuiltSupersedeListSql {
  whereSql: string;
  params: Record<string, unknown>;
  filtersApplied: SupersedeCandidateFiltersApplied;
}

export function buildSupersedeCandidateListSql(input: QuerySupersedeCandidatesInput): BuiltSupersedeListSql {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  const filtersApplied: SupersedeCandidateFiltersApplied = {};

  if (input.verdict !== undefined) {
    clauses.push('c.verdict = @verdict');
    params.verdict = input.verdict;
    filtersApplied.verdict = input.verdict;
  } else {
    clauses.push(`c.verdict IN (${SUPERSEDE_LIST_DEFAULT_VERDICTS.map((_, i) => `@verdict_${i}`).join(', ')})`);
    SUPERSEDE_LIST_DEFAULT_VERDICTS.forEach((verdict, index) => {
      params[`verdict_${index}`] = verdict;
    });
    filtersApplied.verdict = [...SUPERSEDE_LIST_DEFAULT_VERDICTS];
  }

  if (input.project_id !== undefined) {
    if (input.project_id === null) {
      clauses.push('c.project_id IS NULL');
    } else {
      clauses.push('c.project_id = @project_id');
      params.project_id = input.project_id;
    }
    filtersApplied.project_id = input.project_id;
  }

  if (input.lifecycle_status !== undefined) {
    clauses.push(`${SUPERSEDE_LIFECYCLE_STATUS_EXPR} = @lifecycle_status`);
    params.lifecycle_status = input.lifecycle_status;
    filtersApplied.lifecycle_status = input.lifecycle_status;
  } else {
    clauses.push('c.dismissed_at IS NULL');
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return { whereSql, params, filtersApplied };
}

export function buildSupersedeCandidateCountSql(built: BuiltSupersedeListSql): {
  sql: string;
  params: Record<string, unknown>;
} {
  return {
    sql: `SELECT COUNT(*) AS count ${FROM_JOIN} ${built.whereSql}`,
    params: built.params,
  };
}

export function buildSupersedeCandidateSelectSql(
  built: BuiltSupersedeListSql,
  pagination: { page: number; page_size: number },
): { sql: string; params: Record<string, unknown> } {
  const params = {
    ...built.params,
    limit: pagination.page_size,
    offset: (pagination.page - 1) * pagination.page_size,
  };
  return {
    sql: `SELECT
      c.id,
      c.verdict,
      c.project_id,
      c.memory_type,
      c.old_memory_id,
      c.new_memory_id,
      c.rationale,
      c.provider,
      c.model,
      c.created_at AS judged_at,
      c.dismissed_at,
      m_old.content AS old_content,
      m_new.content AS new_content,
      ${SUPERSEDE_LIFECYCLE_STATUS_EXPR} AS lifecycle_status
      ${FROM_JOIN}
      ${built.whereSql}
      ORDER BY c.created_at DESC
      LIMIT @limit OFFSET @offset`,
    params,
  };
}

export function mapSupersedeCandidateListRow(
  row: Record<string, unknown>,
  supersedeApplyEnabled: boolean,
): import('./supersede-candidate-list.types.js').SupersedeCandidateListItem {
  const preview = (value: unknown) => String(value ?? '').slice(0, SUPERSEDE_CONTENT_PREVIEW_CHARS);
  return {
    id: String(row.id),
    verdict: row.verdict as SupersedeVerdict,
    lifecycle_status: row.lifecycle_status as SupersedeCandidateLifecycleStatus,
    project_id: row.project_id == null ? null : String(row.project_id),
    memory_type: String(row.memory_type),
    old_memory_id: String(row.old_memory_id),
    new_memory_id: String(row.new_memory_id),
    old_content_preview: preview(row.old_content),
    new_content_preview: preview(row.new_content),
    rationale: String(row.rationale),
    provider: String(row.provider),
    model: String(row.model),
    judged_at: String(row.judged_at),
    dismissed_at: row.dismissed_at == null ? null : String(row.dismissed_at),
    supersede_apply_enabled: supersedeApplyEnabled,
  };
}

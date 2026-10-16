import type { SqlParam } from '../types/memory.types.js';
import type { MemorySearchFilters } from '../types/search.types.js';

/**
 * 시간 필터 파라미터를 저장 형식(ISO-8601 UTC, 밀리초 3자리)에 맞춘다.
 * created_at 은 마이그레이션 047 이후 전부 이 형식이므로 문자열 비교가 성립하고
 * idx_memory_item_created_at 인덱스를 탄다 (#1007). 파싱 불가 입력은 그대로 넘겨 기존 동작을 유지한다.
 */
function toIsoTimestampParam(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

interface MemoryFilterSqlOptions {
  /** memory_item 별칭 (예: 'm', 'mi', 'scoped_mi', 'scoped_m') */
  itemAlias: string;
  /**
   * memory_embedding 별칭. 주면 #889 모델 필터 절을 함께 낸다.
   * 텍스트 레인처럼 임베딩 조인이 없는 곳에서는 생략한다.
   */
  embeddingAlias?: string;
  /** #889: 이 모델로 만든 임베딩만 비교. embeddingAlias 가 있을 때만 쓴다. */
  modelFilter?: string | null;
}

interface FilterSql {
  clauses: string[];
  params: SqlParam[];
}

function pushIn(out: FilterSql, column: string, values: readonly SqlParam[] | undefined): void {
  if (values && values.length > 0) {
    out.clauses.push(`${column} IN (${values.map(() => '?').join(',')})`);
    out.params.push(...values);
  }
}

function pushIfDefined(out: FilterSql, clause: string, value: SqlParam | undefined): void {
  if (value !== undefined) {
    out.clauses.push(clause);
    out.params.push(value);
  }
}

function appendIdentityClauses(out: FilterSql, filters: MemorySearchFilters, a: string): void {
  pushIn(out, `${a}.id`, filters.id);
  pushIn(out, `${a}.type`, filters.type);
  for (const tag of filters.tags ?? []) {
    out.clauses.push(`EXISTS (SELECT 1 FROM json_each(COALESCE(${a}.tags, '[]')) WHERE value = ?)`);
    out.params.push(tag);
  }
  pushIn(out, `${a}.privacy_scope`, filters.privacy_scope);
  if (filters.pinned !== undefined) {
    pushIfDefined(out, `${a}.pinned = ?`, filters.pinned ? 1 : 0);
  }
}

function appendRangeClauses(out: FilterSql, filters: MemorySearchFilters, a: string): void {
  if (filters.time_from) {
    pushIfDefined(out, `${a}.created_at >= ?`, toIsoTimestampParam(filters.time_from));
  }
  if (filters.time_to) {
    pushIfDefined(out, `${a}.created_at <= ?`, toIsoTimestampParam(filters.time_to));
  }
  pushIfDefined(out, `${a}.importance >= ?`, filters.importance_min);
  pushIfDefined(out, `${a}.importance <= ?`, filters.importance_max);
}

function appendProceduralClauses(out: FilterSql, filters: MemorySearchFilters, a: string): void {
  if (filters.has_reflection_notes !== undefined) {
    out.clauses.push(
      filters.has_reflection_notes
        ? `${a}.reflection_notes IS NOT NULL`
        : `${a}.reflection_notes IS NULL`
    );
  }
  if (filters.workflow_name) {
    pushIfDefined(out, `${a}.workflow_name = ?`, filters.workflow_name);
  }
  if (filters.skill_name) {
    pushIfDefined(out, `${a}.skill_name = ?`, filters.skill_name);
  }
}

function appendScopeClauses(out: FilterSql, filters: MemorySearchFilters, a: string): void {
  if (filters.project_id !== undefined && filters.project_id !== null && filters.project_id !== '') {
    pushIfDefined(out, `${a}.project_id = ?`, filters.project_id);
  }
  for (const [column, value] of [
    ['owner_id', filters.owner_id],
    ['process_id', filters.process_id],
    ['session_id', filters.session_id],
  ] as const) {
    if (Array.isArray(value)) {
      pushIn(out, `${a}.${column}`, value);
    } else if (typeof value === 'string' && value.length > 0) {
      pushIfDefined(out, `${a}.${column} = ?`, value);
    }
  }
}

export function buildMemoryFilterSql(
  filters: MemorySearchFilters | undefined,
  options: MemoryFilterSqlOptions
): FilterSql {
  const out: FilterSql = { clauses: [], params: [] };
  if (filters) {
    const a = options.itemAlias;
    appendIdentityClauses(out, filters, a);
    appendRangeClauses(out, filters, a);
    appendProceduralClauses(out, filters, a);
    appendScopeClauses(out, filters, a);
  }
  if (options.embeddingAlias && options.modelFilter) {
    pushIfDefined(out, `${options.embeddingAlias}.model = ?`, options.modelFilter);
  }
  return out;
}

/** 절이 하나라도 생기는지. 벡터 레인의 hasScopedCandidates 판단에 쓴다. */
export function hasMemoryFilter(filters: MemorySearchFilters | undefined): boolean {
  if (!filters) {
    return false;
  }
  const { clauses } = buildMemoryFilterSql(filters, { itemAlias: 'm' });
  return clauses.length > 0;
}

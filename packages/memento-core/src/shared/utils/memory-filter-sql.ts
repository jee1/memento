import type { SqlParam } from '../types/memory.types.js';
import type { MemorySearchFilters } from '../types/search.types.js';
import type Database from 'better-sqlite3';

/**
 * 시간 필터 파라미터를 저장 형식(ISO-8601 UTC, 밀리초 3자리)에 맞춘다.
 * created_at 은 마이그레이션 047 이후 전부 이 형식이므로 문자열 비교가 성립하고
 * idx_memory_item_created_at 인덱스를 탄다 (#1007). 파싱 불가 입력은 그대로 넘겨 기존 동작을 유지한다.
 */
function toIsoTimestampParam(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

type MemoryItemSqlAlias = 'm' | 'mi' | 'scoped_m' | 'scoped_mi';

/** #1551/#1552: direct live target only; deleting it revives its predecessor. */
export function supersedeByActiveTargetSql(a: MemoryItemSqlAlias): string {
  return `(${a}.superseded_by IS NOT NULL AND EXISTS (
    SELECT 1 FROM memory_item supersede_target
    WHERE
      supersede_target.id = ${a}.superseded_by
      AND COALESCE(supersede_target.is_deleted, 0) = 0
  ))`;
}

/** The partial index is empty before the first approval; do not cache pointer state. */
export function hasActiveSupersedePointers(db: Database.Database): boolean {
  return db.prepare(`SELECT 1 FROM memory_item mi
    WHERE mi.superseded_by IS NOT NULL
      AND ${supersedeByActiveTargetSql('mi')}
    LIMIT 1`).get() !== undefined;
}

interface MemoryFilterSqlOptions {
  /** memory_item 별칭 (예: 'm', 'mi', 'scoped_mi', 'scoped_m') */
  itemAlias: MemoryItemSqlAlias;
  /** Skip current-state SQL only after a same-request DB probe found no live pointers. */
  currentState?: boolean;
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
    out.clauses.push(
      `EXISTS (SELECT 1 FROM json_each(CASE WHEN ${a}.tags IS NOT NULL AND json_valid(${a}.tags) THEN ${a}.tags ELSE '[]' END) WHERE value = ?)`
    );
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

function appendLatestOnlyClause(out: FilterSql, a: string): void {
  out.clauses.push(`(
    ${a}.type != 'procedural'
    OR ${a}.version_series_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM memory_item AS newer
      WHERE newer.type = 'procedural'
        AND COALESCE(newer.is_deleted, 0) = 0
        AND newer.version_series_id = ${a}.version_series_id
        AND COALESCE(newer.version, 0) > COALESCE(${a}.version, 0)
    )
  )`);
}

function appendSpecificVersionClause(out: FilterSql, filters: MemorySearchFilters, a: string): void {
  const parts: string[] = [];
  if (filters.version_series_id) {
    parts.push(`${a}.version_series_id = ?`);
    out.params.push(filters.version_series_id);
  }
  if (filters.version_number !== undefined) {
    parts.push(`COALESCE(${a}.version, 0) = ?`);
    out.params.push(filters.version_number);
  }
  if (parts.length === 0) return;
  out.clauses.push(`(${a}.type != 'procedural' OR (${parts.join(' AND ')}))`);
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
  if (filters.version_filter === 'latest_only') {
    appendLatestOnlyClause(out, a);
  } else if (filters.version_filter === 'specific_version') {
    appendSpecificVersionClause(out, filters, a);
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
  const out: FilterSql = {
    clauses: options.currentState === false || filters?.include_superseded === true
      ? [] : [`NOT ${supersedeByActiveTargetSql(options.itemAlias)}`],
    params: [],
  };
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

/** Whether request filters or live replacement pointers require pre-KNN candidate filtering. */
export function hasMemoryFilter(filters: MemorySearchFilters | undefined, currentState = false): boolean {
  const { clauses } = buildMemoryFilterSql(filters, { itemAlias: 'm', currentState });
  return clauses.length > 0;
}

/** Filter both relation endpoints before ordering, pagination or BFS expansion. */
export function buildRelationMemoryFilterSql(filters?: MemorySearchFilters): FilterSql {
  const current = buildMemoryFilterSql(filters, { itemAlias: 'mi' });
  const endpointSql = ['source_id', 'target_id'].map(column => `EXISTS (
    SELECT 1 FROM memory_item mi
    WHERE COALESCE(mi.is_deleted, 0) = 0
      AND mi.id = ${column}
      ${current.clauses.map(clause => `AND ${clause}`).join(' ')}
  )`);
  return { clauses: endpointSql, params: [...current.params, ...current.params] };
}

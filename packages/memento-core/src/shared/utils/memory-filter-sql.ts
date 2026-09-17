import type { SqlParam } from '../types/memory.types.js';
import type { MemorySearchFilters } from '../types/search.types.js';

export interface MemoryFilterSqlOptions {
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

export function buildMemoryFilterSql(
  filters: MemorySearchFilters | undefined,
  options: MemoryFilterSqlOptions
): { clauses: string[]; params: SqlParam[] } {
  const a = options.itemAlias;
  const clauses: string[] = [];
  const params: SqlParam[] = [];

  if (filters?.id && filters.id.length > 0) {
    clauses.push(`${a}.id IN (${filters.id.map(() => '?').join(',')})`);
    params.push(...filters.id);
  }

  if (filters?.type && filters.type.length > 0) {
    clauses.push(`${a}.type IN (${filters.type.map(() => '?').join(',')})`);
    params.push(...filters.type);
  }

  if (filters?.tags && filters.tags.length > 0) {
    for (const tag of filters.tags) {
      clauses.push(
        `EXISTS (SELECT 1 FROM json_each(COALESCE(${a}.tags, '[]')) WHERE value = ?)`
      );
      params.push(tag);
    }
  }

  if (filters?.privacy_scope && filters.privacy_scope.length > 0) {
    clauses.push(`${a}.privacy_scope IN (${filters.privacy_scope.map(() => '?').join(',')})`);
    params.push(...filters.privacy_scope);
  }

  if (filters?.pinned !== undefined) {
    clauses.push(`${a}.pinned = ?`);
    params.push(filters.pinned ? 1 : 0);
  }

  if (filters?.time_from) {
    // ponytail: created_at 이 ISO 와 'YYYY-MM-DD HH:MM:SS' 두 형식으로 섞여 저장돼 있어
    // 문자열 비교로는 24% 를 놓친다(#998). 인덱스를 살리려면 created_at 을 ISO 로 정규화하는
    // 마이그레이션이 선행돼야 한다.
    clauses.push(`julianday(${a}.created_at) >= julianday(?)`);
    params.push(filters.time_from);
  }

  if (filters?.time_to) {
    clauses.push(`julianday(${a}.created_at) <= julianday(?)`);
    params.push(filters.time_to);
  }

  if (filters?.importance_min !== undefined) {
    clauses.push(`${a}.importance >= ?`);
    params.push(filters.importance_min);
  }

  if (filters?.importance_max !== undefined) {
    clauses.push(`${a}.importance <= ?`);
    params.push(filters.importance_max);
  }

  if (filters?.has_reflection_notes !== undefined) {
    if (filters.has_reflection_notes) {
      clauses.push(`${a}.reflection_notes IS NOT NULL`);
    } else {
      clauses.push(`${a}.reflection_notes IS NULL`);
    }
  }

  if (filters?.workflow_name) {
    clauses.push(`${a}.workflow_name = ?`);
    params.push(filters.workflow_name);
  }

  if (filters?.skill_name) {
    clauses.push(`${a}.skill_name = ?`);
    params.push(filters.skill_name);
  }

  if (filters?.project_id !== undefined && filters.project_id !== null && filters.project_id !== '') {
    clauses.push(`${a}.project_id = ?`);
    params.push(filters.project_id);
  }

  for (const [column, value] of [
    ['owner_id', filters?.owner_id],
    ['process_id', filters?.process_id],
    ['session_id', filters?.session_id],
  ] as const) {
    if (Array.isArray(value) && value.length > 0) {
      clauses.push(`${a}.${column} IN (${value.map(() => '?').join(',')})`);
      params.push(...value);
    } else if (typeof value === 'string' && value.length > 0) {
      clauses.push(`${a}.${column} = ?`);
      params.push(value);
    }
  }

  if (options.embeddingAlias && options.modelFilter) {
    clauses.push(`${options.embeddingAlias}.model = ?`);
    params.push(options.modelFilter);
  }

  return { clauses, params };
}

/** 절이 하나라도 생기는지. 벡터 레인의 hasScopedCandidates 판단에 쓴다. */
export function hasMemoryFilter(filters: MemorySearchFilters | undefined): boolean {
  if (!filters) {
    return false;
  }
  const { clauses } = buildMemoryFilterSql(filters, { itemAlias: 'm' });
  return clauses.length > 0;
}

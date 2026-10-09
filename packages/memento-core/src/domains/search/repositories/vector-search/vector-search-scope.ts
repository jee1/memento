/**
 * 벡터 검색 scope 파싱 (search/hybridSearch 중복 제거)
 */

import type { SqlParam } from '../../../../shared/types/memory.types.js';
import type { MemorySearchFilters } from '../../../../shared/types/search.types.js';
import { buildMemoryFilterSql } from '../../../../shared/utils/memory-filter-sql.js';
import type { VectorSearchQuery } from '../../../../shared/types/vector-search.types.js';
import type { VectorSearchScope } from './vector-search.types.js';

export function parseVectorSearchScope(query: VectorSearchQuery): VectorSearchScope {
  const normalizedOptions = query.options ?? {};
  const {
    type,
    types,
    project_id: scopeProjectId,
    owner_id: scopeOwnerId,
    process_id: scopeProcessId,
    session_id: scopeSessionId,
    filters: optionsFilters,
  } = normalizedOptions;

  const merged: MemorySearchFilters = { ...(optionsFilters ?? {}) };

  const typeFromOptions = Array.isArray(types) && types.length > 0
    ? types.filter(Boolean)
    : (type ? [type] : undefined);
  if (typeFromOptions && typeFromOptions.length > 0) {
    merged.type = typeFromOptions as MemorySearchFilters['type'];
  }

  if (typeof scopeProjectId === 'string' && scopeProjectId.length > 0) {
    merged.project_id = scopeProjectId;
  }
  if (scopeOwnerId !== undefined) {
    merged.owner_id = scopeOwnerId;
  }
  if (scopeProcessId !== undefined) {
    merged.process_id = scopeProcessId;
  }
  if (scopeSessionId !== undefined) {
    merged.session_id = scopeSessionId;
  }

  return merged;
}

/** 바깥 쿼리 WHERE 절 (mi·me 별칭) */
export function buildOuterWhereSql(
  filters: VectorSearchScope,
  modelFilter: string | null
): { sql: string; params: SqlParam[] } {
  const { clauses, params } = buildMemoryFilterSql(filters, {
    itemAlias: 'mi',
    embeddingAlias: 'me',
    modelFilter,
  });
  const sql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')} ` : '';
  return { sql, params };
}

/** sqlite-vec KNN 후보를 scope 에 맞는 rowid 로 좁히는 AND 절 */
export function buildScopedCandidateSql(
  filters: VectorSearchScope,
  provider: string,
  modelFilter: string | null
): { sql: string; params: SqlParam[] } {
  const { clauses, params } = buildMemoryFilterSql(filters, {
    itemAlias: 'scoped_mi',
    embeddingAlias: 'scoped_me',
    modelFilter,
  });
  const whereParts = [
    'scoped_me.embedding_provider = ?',
    '(COALESCE(scoped_mi.is_deleted, 0) = 0)',
    ...clauses,
  ];
  const sql =
    '  AND rowid IN (' +
    'SELECT scoped_me.id FROM memory_embedding scoped_me ' +
    'JOIN memory_item scoped_mi ON scoped_mi.id = scoped_me.memory_id ' +
    `WHERE ${whereParts.join(' AND ')}` +
    ') ';
  return { sql, params: [provider, ...params] };
}

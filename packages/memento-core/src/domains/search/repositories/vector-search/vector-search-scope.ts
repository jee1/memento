/**
 * 벡터 검색 scope 파싱 (search/hybridSearch 중복 제거)
 */

import type { MemorySearchFilters } from '../../../../shared/types/search.types.js';
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

/**
 * 벡터 검색 scope 파싱 (search/hybridSearch 중복 제거)
 */

import type { VectorSearchQuery } from '../../../../shared/types/vector-search.types.js';
import type { VectorSearchScope } from './vector-search.types.js';

export function parseVectorSearchScope(query: VectorSearchQuery): VectorSearchScope {
  const normalizedOptions = query.options ?? {};
  const {
    type,
    types,
    project_id: scopeProjectId,
    owner_id: scopeOwnerId,
  } = normalizedOptions;

  const typeFilters = Array.isArray(types) && types.length > 0
    ? types.filter(Boolean)
    : (type ? [type] : []);

  const hasProjectScope = typeof scopeProjectId === 'string' && scopeProjectId.length > 0;
  const hasOwnerStringScope = typeof scopeOwnerId === 'string' && scopeOwnerId.length > 0;
  const ownerArrayScope = Array.isArray(scopeOwnerId) ? scopeOwnerId.filter(Boolean) : [];
  const hasOwnerScope = hasOwnerStringScope || ownerArrayScope.length > 0;
  const hasScopeFilter = hasProjectScope || hasOwnerScope;

  return {
    typeFilters,
    hasProjectScope,
    hasOwnerStringScope,
    ownerArrayScope,
    hasOwnerScope,
    hasScopeFilter,
    ...(hasProjectScope ? { scopeProjectId } : {}),
    ...(scopeOwnerId !== undefined ? { scopeOwnerId } : {}),
  };
}

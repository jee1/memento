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
    process_id: scopeProcessId,
    session_id: scopeSessionId,
  } = normalizedOptions;

  const typeFilters = Array.isArray(types) && types.length > 0
    ? types.filter(Boolean)
    : (type ? [type] : []);

  const hasProjectScope = typeof scopeProjectId === 'string' && scopeProjectId.length > 0;
  const hasOwnerStringScope = typeof scopeOwnerId === 'string' && scopeOwnerId.length > 0;
  const ownerArrayScope = Array.isArray(scopeOwnerId) ? scopeOwnerId.filter(Boolean) : [];
  const hasOwnerScope = hasOwnerStringScope || ownerArrayScope.length > 0;
  const hasProcessStringScope = typeof scopeProcessId === 'string' && scopeProcessId.length > 0;
  const processArrayScope = Array.isArray(scopeProcessId) ? scopeProcessId.filter(Boolean) : [];
  const hasProcessScope = hasProcessStringScope || processArrayScope.length > 0;
  const hasSessionStringScope = typeof scopeSessionId === 'string' && scopeSessionId.length > 0;
  const sessionArrayScope = Array.isArray(scopeSessionId) ? scopeSessionId.filter(Boolean) : [];
  const hasSessionScope = hasSessionStringScope || sessionArrayScope.length > 0;
  const hasScopeFilter = hasProjectScope || hasOwnerScope || hasProcessScope || hasSessionScope;

  return {
    typeFilters,
    hasProjectScope,
    hasOwnerStringScope,
    ownerArrayScope,
    hasOwnerScope,
    hasProcessStringScope,
    processArrayScope,
    hasProcessScope,
    hasSessionStringScope,
    sessionArrayScope,
    hasSessionScope,
    hasScopeFilter,
    ...(hasProjectScope ? { scopeProjectId } : {}),
    ...(scopeOwnerId !== undefined ? { scopeOwnerId } : {}),
    ...(scopeProcessId !== undefined ? { scopeProcessId } : {}),
    ...(scopeSessionId !== undefined ? { scopeSessionId } : {}),
  };
}

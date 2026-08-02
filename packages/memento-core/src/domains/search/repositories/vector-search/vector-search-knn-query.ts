/**
 * KNN 벡터 검색 SQL 실행
 */

import type Database from 'better-sqlite3';
import { mcpLogger } from '../../../../server/mcp-logger.js';
import type { SqlParam } from '../../../../shared/types/index.js';
import type { VectorSearchResult } from '../../../../shared/types/vector-search.types.js';
import { mapKnnResults } from './vector-search-result-mapper.js';
import type {
  RawVectorSearchResult,
  RuntimeVectorContext,
  VectorSearchExecutionOptions,
  VectorSearchScope,
} from './vector-search.types.js';

export interface KnnQueryParams {
  db: Database.Database;
  effectiveQueryVector: number[];
  runtimeContext: RuntimeVectorContext;
  scope: VectorSearchScope;
  options: VectorSearchExecutionOptions;
}

function buildScopeParams(scope: VectorSearchScope): SqlParam[] {
  const scopeParams: SqlParam[] = [];
  if (scope.hasProjectScope && scope.scopeProjectId) {
    scopeParams.push(scope.scopeProjectId);
  }
  if (scope.hasOwnerStringScope && typeof scope.scopeOwnerId === 'string') {
    scopeParams.push(scope.scopeOwnerId);
  } else if (scope.ownerArrayScope.length > 0) {
    scopeParams.push(...(scope.ownerArrayScope as SqlParam[]));
  }
  if (scope.hasProcessStringScope && typeof scope.scopeProcessId === 'string') {
    scopeParams.push(scope.scopeProcessId);
  } else if (scope.processArrayScope.length > 0) {
    scopeParams.push(...(scope.processArrayScope as SqlParam[]));
  }
  if (scope.hasSessionStringScope && typeof scope.scopeSessionId === 'string') {
    scopeParams.push(scope.scopeSessionId);
  } else if (scope.sessionArrayScope.length > 0) {
    scopeParams.push(...(scope.sessionArrayScope as SqlParam[]));
  }
  return scopeParams;
}

function buildOuterWhereSql(scope: VectorSearchScope): string {
  const whereParts: string[] = [];
  if (scope.typeFilters.length > 0) {
    whereParts.push(`mi.type IN (${scope.typeFilters.map(() => '?').join(',')})`);
  }
  if (scope.hasProjectScope) {
    whereParts.push('mi.project_id = ?');
  }
  if (scope.hasOwnerStringScope) {
    whereParts.push('mi.owner_id = ?');
  } else if (scope.ownerArrayScope.length > 0) {
    whereParts.push(`mi.owner_id IN (${scope.ownerArrayScope.map(() => '?').join(',')})`);
  }
  if (scope.hasProcessStringScope) {
    whereParts.push('mi.process_id = ?');
  } else if (scope.processArrayScope.length > 0) {
    whereParts.push(`mi.process_id IN (${scope.processArrayScope.map(() => '?').join(',')})`);
  }
  if (scope.hasSessionStringScope) {
    whereParts.push('mi.session_id = ?');
  } else if (scope.sessionArrayScope.length > 0) {
    whereParts.push(`mi.session_id IN (${scope.sessionArrayScope.map(() => '?').join(',')})`);
  }
  return whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')} ` : '';
}

export function executeKnnQuery(params: KnnQueryParams): VectorSearchResult[] {
  const { db, effectiveQueryVector, runtimeContext, scope, options } = params;
  const { tableName } = runtimeContext;
  const { limit } = options;

  const prefetchLimit = scope.typeFilters.length > 0 || scope.hasScopeFilter ? limit * 5 : limit;
  const outerWhereSql = buildOuterWhereSql(scope);
  const scopeParams = buildScopeParams(scope);

  const vecQuery =
    'SELECT ' +
    '  me.memory_id as memory_id, ' +
    '  t.distance as similarity, ' +
    '  mi.content, ' +
    '  mi.type, ' +
    '  mi.importance, ' +
    '  mi.created_at, ' +
    '  COALESCE(mi.last_accessed_at, mi.last_accessed) as last_accessed_at, ' +
    '  mi.pinned, ' +
    '  mi.tags, ' +
    '  mi.project_id, ' +
    '  mi.owner_id, ' +
    '  mi.process_id, ' +
    '  mi.session_id, ' +
    '  mi.task_goal, ' +
    '  mi.steps, ' +
    '  mi.reflection_notes, ' +
    '  mi.workflow_name, ' +
    '  mi.skill_name, ' +
    '  mi.trigger_conditions ' +
    'FROM (' +
    '  SELECT rowid, distance ' +
    `  FROM ${tableName} ` +
    '  WHERE embedding MATCH ? ' +
    '  ORDER BY distance ASC ' +
    '  LIMIT ?' +
    ') t ' +
    'JOIN memory_embedding me ON t.rowid = me.id ' +
    'JOIN memory_item mi ON mi.id = me.memory_id AND (COALESCE(mi.is_deleted, 0) = 0) ' +
    outerWhereSql +
    'ORDER BY t.distance ASC ' +
    'LIMIT ?';

  const sqlParams = [
    JSON.stringify(effectiveQueryVector),
    prefetchLimit,
    ...scope.typeFilters,
    ...scopeParams,
    limit
  ];

  const statement = db.prepare(vecQuery);
  if (typeof statement.all !== 'function') {
    mcpLogger.logServer('warn', '벡터 검색 쿼리를 실행할 수 없습니다: all() 메서드가 없습니다.');
    return [];
  }

  const rawResults = statement.all(...sqlParams);
  const results: RawVectorSearchResult[] = Array.isArray(rawResults)
    ? rawResults as RawVectorSearchResult[]
    : [];

  const normalizedResults = mapKnnResults(results, options);
  mcpLogger.logServer('debug', '벡터 검색 완료', {
    resultCount: normalizedResults.length,
    threshold: options.threshold
  });
  return normalizedResults;
}

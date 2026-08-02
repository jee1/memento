/**
 * 하이브리드 벡터+텍스트 검색 SQL 실행
 */

import type Database from 'better-sqlite3';
import { mcpLogger } from '../../../../server/mcp-logger.js';
import type { SqlParam } from '../../../../shared/types/index.js';
import type { VectorSearchResult } from '../../../../shared/types/vector-search.types.js';
import { mapHybridResults } from './vector-search-result-mapper.js';
import type {
  RawVectorSearchResult,
  RuntimeVectorContext,
  VectorSearchExecutionOptions,
  VectorSearchScope,
} from './vector-search.types.js';

export interface HybridQueryParams {
  db: Database.Database;
  effectiveQueryVector: number[];
  textQuery: string | undefined;
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

function buildItemScopeClause(scope: VectorSearchScope): string {
  const parts: string[] = [];
  if (scope.hasProjectScope) {
    parts.push('mi.project_id = ?');
  }
  if (scope.hasOwnerStringScope) {
    parts.push('mi.owner_id = ?');
  } else if (scope.ownerArrayScope.length > 0) {
    parts.push(`mi.owner_id IN (${scope.ownerArrayScope.map(() => '?').join(',')})`);
  }
  if (scope.hasProcessStringScope) {
    parts.push('mi.process_id = ?');
  } else if (scope.processArrayScope.length > 0) {
    parts.push(`mi.process_id IN (${scope.processArrayScope.map(() => '?').join(',')})`);
  }
  if (scope.hasSessionStringScope) {
    parts.push('mi.session_id = ?');
  } else if (scope.sessionArrayScope.length > 0) {
    parts.push(`mi.session_id IN (${scope.sessionArrayScope.map(() => '?').join(',')})`);
  }
  return parts.length > 0 ? `${parts.map(part => `AND ${part}`).join(' ')} ` : '';
}

function buildItemWhereSql(scope: VectorSearchScope): string {
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

export function executeHybridQuery(params: HybridQueryParams): VectorSearchResult[] {
  const { db, effectiveQueryVector, textQuery, runtimeContext, scope, options } = params;
  const { tableName } = runtimeContext;
  const { limit } = options;

  const hasTextQuery = Boolean(textQuery && textQuery.trim().length > 0);
  const scopeParams = buildScopeParams(scope);

  let hybridQuery: string;
  let sqlParams: SqlParam[];

  if (hasTextQuery && textQuery) {
    const textTypeClause = scope.typeFilters.length > 0
      ? `AND mi.type IN (${scope.typeFilters.map(() => '?').join(',')})`
      : '';
    const textScopeClause = buildItemScopeClause(scope);
    const vectorWhereSql = buildItemWhereSql(scope).replace(/^WHERE /, '  WHERE ');
    const prefetchLimit = scope.typeFilters.length > 0 || scope.hasScopeFilter ? limit * 5 : limit;

    hybridQuery =
      'WITH vector_search AS (' +
      '  SELECT ' +
      '    me.memory_id as memory_id, ' +
      '    t.distance as vector_distance, ' +
      '    mi.content, ' +
      '    mi.type, ' +
      '    mi.importance, ' +
      '    mi.created_at, ' +
      '    COALESCE(mi.last_accessed_at, mi.last_accessed) as last_accessed_at, ' +
      '    mi.pinned, ' +
      '    mi.tags, ' +
      '    mi.project_id, ' +
      '    mi.owner_id, ' +
      '    mi.process_id, ' +
      '    mi.session_id, ' +
      '    mi.task_goal, ' +
      '    mi.steps, ' +
      '    mi.reflection_notes, ' +
      '    mi.workflow_name, ' +
      '    mi.skill_name, ' +
      '    mi.trigger_conditions ' +
      '  FROM (' +
      '    SELECT rowid, distance ' +
      `    FROM ${tableName} ` +
      '    WHERE embedding MATCH ? ' +
      '    ORDER BY distance ASC ' +
      '    LIMIT ?' +
      '  ) t ' +
      '  JOIN memory_embedding me ON t.rowid = me.id ' +
      '  JOIN memory_item mi ON mi.id = me.memory_id AND (COALESCE(mi.is_deleted, 0) = 0) ' +
      vectorWhereSql +
      '), ' +
      'text_search AS (' +
      '  SELECT ' +
      '    mi.id as memory_id, ' +
      '    mi.content, ' +
      '    mi.type, ' +
      '    mi.importance, ' +
      '    mi.created_at, ' +
      '    COALESCE(mi.last_accessed_at, mi.last_accessed) as last_accessed_at, ' +
      '    mi.pinned, ' +
      '    mi.tags, ' +
      '    mi.project_id, ' +
      '    mi.owner_id, ' +
      '    mi.process_id, ' +
      '    mi.session_id, ' +
      '    mi.task_goal, ' +
      '    mi.steps, ' +
      '    mi.reflection_notes, ' +
      '    mi.workflow_name, ' +
      '    mi.skill_name, ' +
      '    mi.trigger_conditions, ' +
      '    fts.rank as text_rank ' +
      '  FROM memory_item_fts fts ' +
      '  JOIN memory_item mi ON fts.rowid = mi.rowid AND (COALESCE(mi.is_deleted, 0) = 0) ' +
      '  WHERE memory_item_fts MATCH ? ' +
      textTypeClause +
      textScopeClause +
      ') ' +
      'SELECT * FROM (' +
      'SELECT ' +
      '  COALESCE(vs.memory_id, ts.memory_id) as memory_id, ' +
      '  COALESCE(1 - vs.vector_distance, 0) as vector_similarity, ' +
      '  COALESCE(ts.text_rank, 0) as text_similarity, ' +
      '  COALESCE(vs.content, ts.content) as content, ' +
      '  COALESCE(vs.type, ts.type) as type, ' +
      '  COALESCE(vs.importance, ts.importance) as importance, ' +
      '  COALESCE(vs.created_at, ts.created_at) as created_at, ' +
      '  COALESCE(vs.last_accessed_at, ts.last_accessed_at) as last_accessed_at, ' +
      '  COALESCE(vs.pinned, ts.pinned) as pinned, ' +
      '  COALESCE(vs.tags, ts.tags) as tags, ' +
      '  COALESCE(vs.project_id, ts.project_id) as project_id, ' +
      '  COALESCE(vs.owner_id, ts.owner_id) as owner_id, ' +
      '  COALESCE(vs.process_id, ts.process_id) as process_id, ' +
      '  COALESCE(vs.session_id, ts.session_id) as session_id, ' +
      '  COALESCE(vs.task_goal, ts.task_goal) as task_goal, ' +
      '  COALESCE(vs.steps, ts.steps) as steps, ' +
      '  COALESCE(vs.reflection_notes, ts.reflection_notes) as reflection_notes, ' +
      '  COALESCE(vs.workflow_name, ts.workflow_name) as workflow_name, ' +
      '  COALESCE(vs.skill_name, ts.skill_name) as skill_name, ' +
      '  COALESCE(vs.trigger_conditions, ts.trigger_conditions) as trigger_conditions ' +
      'FROM vector_search vs ' +
      'LEFT JOIN text_search ts ON vs.memory_id = ts.memory_id ' +
      'WHERE vs.memory_id IS NOT NULL ' +
      'UNION ' +
      'SELECT ' +
      '  ts.memory_id, ' +
      '  0 as vector_similarity, ' +
      '  ts.text_rank as text_similarity, ' +
      '  ts.content, ' +
      '  ts.type, ' +
      '  ts.importance, ' +
      '  ts.created_at, ' +
      '  ts.last_accessed_at as last_accessed_at, ' +
      '  ts.pinned, ' +
      '  ts.tags, ' +
      '  ts.project_id, ' +
      '  ts.owner_id, ' +
      '  ts.process_id, ' +
      '  ts.session_id, ' +
      '  ts.task_goal, ' +
      '  ts.steps, ' +
      '  ts.reflection_notes, ' +
      '  ts.workflow_name, ' +
      '  ts.skill_name, ' +
      '  ts.trigger_conditions ' +
      'FROM text_search ts ' +
      'LEFT JOIN vector_search vs ON ts.memory_id = vs.memory_id ' +
      'WHERE vs.memory_id IS NULL ' +
      ') hybrid_ranked ' +
      'ORDER BY (vector_similarity * 0.6 + text_similarity * 0.4) DESC ' +
      'LIMIT ?';

    sqlParams = [
      JSON.stringify(effectiveQueryVector),
      prefetchLimit,
      ...scope.typeFilters,
      ...scopeParams,
      textQuery.trim(),
      ...scope.typeFilters,
      ...scopeParams,
      limit
    ];
  } else {
    const outerWhereSql = buildItemWhereSql(scope);
    const prefetchLimit = scope.typeFilters.length > 0 || scope.hasScopeFilter ? limit * 5 : limit;

    hybridQuery =
      'SELECT ' +
      '  me.memory_id as memory_id, ' +
      '  COALESCE(1 - t.distance, 0) as vector_similarity, ' +
      '  0 as text_similarity, ' +
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

    sqlParams = [
      JSON.stringify(effectiveQueryVector),
      prefetchLimit,
      ...scope.typeFilters,
      ...scopeParams,
      limit
    ];
  }

  const statement = db.prepare(hybridQuery);
  if (typeof statement.all !== 'function') {
    mcpLogger.logServer('warn', '하이브리드 검색 쿼리를 실행할 수 없습니다: all() 메서드가 없습니다.');
    return [];
  }

  const rawResults = statement.all(...sqlParams);
  const results: RawVectorSearchResult[] = Array.isArray(rawResults)
    ? rawResults as RawVectorSearchResult[]
    : [];

  const normalizedResults = mapHybridResults(results, options, hasTextQuery);
  mcpLogger.logServer('debug', '하이브리드 검색 완료', { resultCount: normalizedResults.length });
  return normalizedResults;
}

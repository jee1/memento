/**
 * KNN 벡터 검색 SQL 실행
 */

import type Database from 'better-sqlite3';
import { mcpLogger } from '../../../../server/mcp-logger.js';
import type { SqlParam } from '../../../../shared/types/memory.types.js';
import type { VectorSearchResult } from '../../../../shared/types/vector-search.types.js';
import { resolveVectorPrefetchLimit } from '../../../../shared/config/vector-search.config.js';
import { buildMemoryFilterSql, hasMemoryFilter } from '../../../../shared/utils/memory-filter-sql.js';
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

function buildOuterWhereSql(
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

function buildScopedCandidateSql(
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

export function executeKnnQuery(params: KnnQueryParams): VectorSearchResult[] {
  const { db, effectiveQueryVector, runtimeContext, scope, options } = params;
  const { tableName, provider, modelFilter } = runtimeContext;
  const { limit } = options;
  const prefetchLimit = resolveVectorPrefetchLimit(limit);

  const hasScopedCandidates = hasMemoryFilter(scope);
  const outerWhere = buildOuterWhereSql(scope, modelFilter);
  const scopedCandidate = hasScopedCandidates
    ? buildScopedCandidateSql(scope, provider, modelFilter)
    : { sql: '', params: [] as SqlParam[] };
  const knnFilterSql = hasScopedCandidates ? '  AND k = ? ' + scopedCandidate.sql : '';
  const knnLimitSql = hasScopedCandidates ? '' : '  LIMIT ?';

  // #1112: 한 memory 가 native + window:N 행을 여러 개 가진다. memory_id 별 MIN(distance) 가
  // max-sim(가장 가까운 윈도)이다. SQLite 는 집계가 min() 하나뿐일 때 bare 컬럼을
  // 그 최소 행에서 가져오므로 mi.* 는 정답 윈도가 속한 행의 값이 된다.
  const vecQuery =
    'SELECT ' +
    '  me.memory_id as memory_id, ' +
    '  MIN(t.distance) as similarity, ' +
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
    knnFilterSql +
    '  ORDER BY distance ASC ' +
    knnLimitSql +
    ') t ' +
    'JOIN memory_embedding me ON t.rowid = me.id ' +
    'JOIN memory_item mi ON mi.id = me.memory_id AND (COALESCE(mi.is_deleted, 0) = 0) ' +
    outerWhere.sql +
    'GROUP BY me.memory_id ' +
    'ORDER BY similarity ASC ' +
    'LIMIT ?';

  const sqlParams = [
    JSON.stringify(effectiveQueryVector),
    prefetchLimit,
    ...(hasScopedCandidates ? scopedCandidate.params : []),
    ...outerWhere.params,
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

/**
 * KNN 벡터 검색 SQL 실행
 */

import type Database from 'better-sqlite3';
import { mcpLogger } from '../../../../shared/utils/mcp-logger.js';
import type { SqlParam } from '../../../../shared/types/memory.types.js';
import type { VectorSearchResult } from '../../../../shared/types/vector-search.types.js';
import { resolveVectorPrefetchLimit } from '../../../../shared/config/vector-search.config.js';
import { hasMemoryFilter } from '../../../../shared/utils/memory-filter-sql.js';
import { mapKnnResults } from './vector-search-result-mapper.js';
import { buildOuterWhereSql, buildScopedCandidateSql } from './vector-search-scope.js';
import type {
  RawVectorSearchResult,
  RuntimeVectorContext,
  VectorSearchExecutionOptions,
  VectorSearchScope,
} from './vector-search.types.js';

interface KnnQueryParams {
  db: Database.Database;
  effectiveQueryVector: number[];
  runtimeContext: RuntimeVectorContext;
  scope: VectorSearchScope;
  options: VectorSearchExecutionOptions;
}

export function executeKnnQuery(params: KnnQueryParams): VectorSearchResult[] {
  const { db, effectiveQueryVector, runtimeContext, scope, options } = params;
  const { tableName, provider, modelFilter } = runtimeContext;
  const { limit } = options;
  const prefetchLimit = resolveVectorPrefetchLimit(limit);

  const hasScopedCandidates = hasMemoryFilter(scope);
  // #1386: scope already applied in rowid IN (buildScopedCandidateSql). Repeating it in
  // outer WHERE lets SQLite drive from memory_item and re-run vec0 KNN per in-scope row.
  const outerWhere = hasScopedCandidates
    ? { sql: '', params: [] as SqlParam[] }
    : buildOuterWhereSql(scope, modelFilter);
  const scopedCandidate = hasScopedCandidates
    ? buildScopedCandidateSql(scope, provider, modelFilter)
    : { sql: '', params: [] as SqlParam[] };
  const knnFilterSql = hasScopedCandidates ? '  AND k = ? ' + scopedCandidate.sql : '';
  const knnLimitSql = hasScopedCandidates ? '' : '  LIMIT ?';

  // #1112: 한 memory 가 native + window:N 행을 여러 개 가진다. memory_id 별 MIN(distance) 가
  // max-sim(가장 가까운 윈도)이다.
  // #1477: 내부 top_k 서브쿼리에서 memory_id 와 MIN(t.distance) 만 집계해 상위 K 건을 먼저 추리고,
  // 최종 승자 K 건만 바깥 쿼리에서 memory_item m 과 조인해 무거운 텍스트 컬럼을 읽는다.
  const vecQuery =
    'SELECT ' +
    '  top_k.memory_id as memory_id, ' +
    '  top_k.similarity as similarity, ' +
    '  m.content, ' +
    '  m.type, ' +
    '  m.importance, ' +
    '  m.created_at, ' +
    '  COALESCE(m.last_accessed_at, m.last_accessed) as last_accessed_at, ' +
    '  m.pinned, ' +
    '  m.tags, ' +
    '  m.project_id, ' +
    '  m.owner_id, ' +
    '  m.process_id, ' +
    '  m.session_id, ' +
    '  m.task_goal, ' +
    '  m.steps, ' +
    '  m.reflection_notes, ' +
    '  m.workflow_name, ' +
    '  m.skill_name, ' +
    '  m.trigger_conditions ' +
    'FROM (' +
    '  SELECT ' +
    '    me.memory_id as memory_id, ' +
    '    MIN(t.distance) as similarity ' +
    '  FROM (' +
    '    SELECT rowid, distance ' +
    `    FROM ${tableName} ` +
    '    WHERE embedding MATCH ? ' +
    knnFilterSql +
    '    ORDER BY distance ASC ' +
    knnLimitSql +
    '  ) t ' +
    '  JOIN memory_embedding me ON t.rowid = me.id ' +
    '  JOIN memory_item mi ON mi.id = me.memory_id AND (COALESCE(mi.is_deleted, 0) = 0) ' +
    outerWhere.sql +
    '  GROUP BY me.memory_id ' +
    '  ORDER BY similarity ASC ' +
    '  LIMIT ?' +
    ') top_k ' +
    'JOIN memory_item m ON m.id = top_k.memory_id ' +
    'ORDER BY top_k.similarity ASC';

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

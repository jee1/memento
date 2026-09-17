/**
 * 검색 SQL 빌더 (search() closure에서 추출)
 */

import { buildMemoryFilterSql } from '../../../../shared/utils/memory-filter-sql.js';
import type { BuildSearchStatementParams, BuildSearchStatementResult } from './search-engine.types.js';

export async function buildSearchStatement(
  params: BuildSearchStatementParams
): Promise<BuildSearchStatementResult> {
  const {
    db,
    searchQuery,
    filters,
    limit,
    hasIdFilter,
    preferFts,
    checkFTS5Availability,
    buildFTSQuery,
    buildReflectionNotesSearchCondition,
  } = params;

  let sql: string;
  const sqlParams: unknown[] = [];
  let usedFtsQuery = false;

  if (!hasIdFilter && searchQuery.trim().length > 0) {
    const ftsAvailable = preferFts ? await checkFTS5Availability(db) : false;

    if (ftsAvailable) {
      const ftsQuery = buildFTSQuery(searchQuery);

      if (ftsQuery === '""' || ftsQuery.length === 0) {
        sql = `
              SELECT
                m.id, m.content, m.type, m.importance, m.created_at,
                m.last_accessed, m.pinned, m.tags, m.source,
                m.consolidation_score,
                m.task_goal, m.steps, m.reflection_notes,
                m.workflow_name, m.skill_name, m.trigger_conditions,
                m.version, m.version_series_id,
                m.privacy_scope, m.origin_source, m.owner_id, m.process_id, m.session_id,
                m.num_times, m.last_mentioned_at, m.project_id,
                0 as fts_rank
              FROM memory_item m
            `;
      } else {
        usedFtsQuery = true;
        sql = `
              SELECT
                m.id, m.content, m.type, m.importance, m.created_at,
                m.last_accessed, m.pinned, m.tags, m.source,
                m.consolidation_score,
                m.task_goal, m.steps, m.reflection_notes,
                m.workflow_name, m.skill_name, m.trigger_conditions,
                m.version, m.version_series_id,
                m.privacy_scope, m.origin_source, m.owner_id, m.process_id, m.session_id,
                m.num_times, m.last_mentioned_at, m.project_id,
                memory_item_fts.rank as fts_rank
              FROM memory_item_fts
              JOIN memory_item m ON memory_item_fts.rowid = m.rowid
              WHERE memory_item_fts MATCH ?
            `;
        sqlParams.push(ftsQuery);
      }
    } else {
      const likeQuery = `%${searchQuery}%`;

      const reflectionNotesCondition = buildReflectionNotesSearchCondition(db, searchQuery);
      const reflectionNotesLike = reflectionNotesCondition ? ` OR ${reflectionNotesCondition}` : '';
      const reflectionNotesParams = reflectionNotesCondition ? [likeQuery] : [];

      sql = `
            SELECT
              m.id, m.content, m.type, m.importance, m.created_at,
              m.last_accessed, m.pinned, m.tags, m.source,
              m.consolidation_score,
              m.task_goal, m.steps, m.reflection_notes,
              m.workflow_name, m.skill_name, m.trigger_conditions,
              m.version, m.version_series_id,
              m.privacy_scope, m.origin_source, m.owner_id, m.process_id, m.session_id,
              m.num_times, m.last_mentioned_at, m.project_id,
              0 as fts_rank
            FROM memory_item m
            WHERE (m.content LIKE ? OR m.tags LIKE ? OR m.source LIKE ?${reflectionNotesLike})`;
      sqlParams.push(likeQuery, likeQuery, likeQuery, ...reflectionNotesParams);
    }
  } else {
    sql = `
          SELECT
            m.id, m.content, m.type, m.importance, m.created_at,
            m.last_accessed, m.pinned, m.tags, m.source,
            m.consolidation_score,
            m.task_goal, m.steps, m.reflection_notes,
            m.workflow_name, m.skill_name, m.trigger_conditions,
            m.version, m.version_series_id,
            m.privacy_scope, m.origin_source, m.owner_id, m.process_id, m.session_id,
            m.num_times, m.last_mentioned_at, m.project_id,
            0 as fts_rank
          FROM memory_item m
        `;

    if (!hasIdFilter && searchQuery.trim().length > 0) {
      const likeQuery = `%${searchQuery}%`;

      const reflectionNotesCondition = buildReflectionNotesSearchCondition(db, searchQuery);
      const reflectionNotesLike = reflectionNotesCondition ? ` OR ${reflectionNotesCondition}` : '';
      const reflectionNotesParams = reflectionNotesCondition ? [likeQuery] : [];

      sql += ` WHERE (m.content LIKE ?${reflectionNotesLike})`;
      sqlParams.push(likeQuery, ...reflectionNotesParams);
    }
  }

  const conditions: string[] = ['(COALESCE(m.is_deleted, 0) = 0)'];
  const { clauses: filterClauses, params: filterParams } = buildMemoryFilterSql(filters, { itemAlias: 'm' });
  conditions.push(...filterClauses);
  sqlParams.push(...filterParams);

  if (conditions.length > 0) {
    const whereClause = sql.includes('WHERE') ? ' AND ' : ' WHERE ';
    sql += `${whereClause}${conditions.join(' AND ')}`;
  }

  sql += ' ORDER BY fts_rank ASC, m.created_at DESC LIMIT ?';
  sqlParams.push(limit * 3);

  return { sql, params: sqlParams, usedFtsQuery };
}

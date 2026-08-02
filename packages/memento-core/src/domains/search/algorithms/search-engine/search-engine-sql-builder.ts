/**
 * 검색 SQL 빌더 (search() closure에서 추출)
 */

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

  if (filters?.id && filters.id.length > 0) {
    conditions.push(`m.id IN (${filters.id.map(() => '?').join(',')})`);
    sqlParams.push(...filters.id);
  }

  if (filters?.type && filters.type.length > 0) {
    conditions.push(`m.type IN (${filters.type.map(() => '?').join(',')})`);
    sqlParams.push(...filters.type);
  }

  if (filters?.privacy_scope && filters.privacy_scope.length > 0) {
    conditions.push(`m.privacy_scope IN (${filters.privacy_scope.map(() => '?').join(',')})`);
    sqlParams.push(...filters.privacy_scope);
  }

  if (filters?.pinned !== undefined) {
    conditions.push(`m.pinned = ?`);
    sqlParams.push(filters.pinned ? 1 : 0);
  }

  if (filters?.time_from) {
    conditions.push(`m.created_at >= ?`);
    sqlParams.push(filters.time_from);
  }

  if (filters?.time_to) {
    conditions.push(`m.created_at <= ?`);
    sqlParams.push(filters.time_to);
  }

  if (filters?.has_reflection_notes !== undefined) {
    if (filters.has_reflection_notes) {
      conditions.push(`m.reflection_notes IS NOT NULL`);
    } else {
      conditions.push(`m.reflection_notes IS NULL`);
    }
  }

  if (filters?.workflow_name) {
    conditions.push(`m.workflow_name = ?`);
    sqlParams.push(filters.workflow_name);
  }

  if (filters?.skill_name) {
    conditions.push(`m.skill_name = ?`);
    sqlParams.push(filters.skill_name);
  }

  if (filters?.project_id !== undefined && filters.project_id !== null && filters.project_id !== '') {
    conditions.push(`m.project_id = ?`);
    sqlParams.push(filters.project_id);
  }

  for (const [column, value] of [
    ['owner_id', filters?.owner_id],
    ['process_id', filters?.process_id],
    ['session_id', filters?.session_id],
  ] as const) {
    if (Array.isArray(value) && value.length > 0) {
      conditions.push(`m.${column} IN (${value.map(() => '?').join(',')})`);
      sqlParams.push(...value);
    } else if (typeof value === 'string' && value.length > 0) {
      conditions.push(`m.${column} = ?`);
      sqlParams.push(value);
    }
  }

  if (conditions.length > 0) {
    const whereClause = sql.includes('WHERE') ? ' AND ' : ' WHERE ';
    sql += `${whereClause}${conditions.join(' AND ')}`;
  }

  sql += ' ORDER BY fts_rank DESC, m.created_at DESC LIMIT ?';
  sqlParams.push(limit * 3);

  return { sql, params: sqlParams, usedFtsQuery };
}

/**
 * Remember Tool DB 헬퍼 함수 (remember-tool.ts에서 분리, #582).
 */

import type Database from 'better-sqlite3';
import { MINILM_MODEL_NAME } from '../../../shared/config/embedding-models.js';
import type { MemoryItem } from '../../../shared/types/memory.types.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { supersedeByActiveTargetSql } from '../../../shared/utils/memory-filter-sql.js';
import type { RememberToolHost } from './remember-tool-host.js';
import type { MemoryItemRow, ProceduralMemoryItem } from './remember-tool-types.js';

export async function findExistingProceduralMemory(
  db: Database.Database,
  workflow_name: string | null | undefined,
  skill_name: string | null | undefined,
  ownerId: string | null,
  projectId: string | null,
  host: RememberToolHost
): Promise<ProceduralMemoryItem | null> {
  if (!workflow_name || !skill_name) {
    return null;
  }

  try {
    const row = await DatabaseUtils.get(db, `
      SELECT
        id, type, content, importance, privacy_scope,
        created_at, last_accessed, pinned, tags, source,
        task_goal, steps, reflection_notes,
        workflow_name, skill_name, trigger_conditions,
        recall_count, last_accessed_at,
        version, version_series_id
      FROM memory_item
      WHERE type = 'procedural'
        AND workflow_name = ?
        AND skill_name = ?
        AND owner_id IS ?
        AND project_id IS ?
        AND (COALESCE(is_deleted, 0) = 0)
      ORDER BY created_at DESC
      LIMIT 1
    `, [workflow_name, skill_name, ownerId, projectId]);

    if (!row) {
      return null;
    }
    const r = row as MemoryItemRow & Record<string, unknown>;
    return {
      id: r.id,
      type: r.type as MemoryItem['type'],
      content: r.content,
      importance: r.importance,
      privacy_scope: r.privacy_scope as MemoryItem['privacy_scope'],
      created_at: new Date(r.created_at),
      last_accessed: r.last_accessed ? new Date(r.last_accessed) : undefined,
      pinned: Boolean(r.pinned),
      tags: r.tags ? JSON.parse(r.tags) : undefined,
      source: r.source || undefined,
      task_goal: (r as Record<string, unknown>).task_goal as string | undefined,
      steps: (r as Record<string, unknown>).steps as string | undefined,
      reflection_notes: (r as Record<string, unknown>).reflection_notes as string | undefined,
      workflow_name: (r as Record<string, unknown>).workflow_name as string | undefined,
      skill_name: (r as Record<string, unknown>).skill_name as string | undefined,
      trigger_conditions: (r as Record<string, unknown>).trigger_conditions as string | undefined,
      recall_count: (r as Record<string, unknown>).recall_count as number | undefined,
      last_accessed_at: (r as Record<string, unknown>).last_accessed_at != null
        ? new Date((r as Record<string, unknown>).last_accessed_at as string)
        : undefined,
      version: (r as Record<string, unknown>).version as number | undefined,
      version_series_id: (r as Record<string, unknown>).version_series_id as string | undefined,
    } as ProceduralMemoryItem;
  } catch (error) {
    host.logWarning('기존 procedural memory 조회 실패', {
      workflow_name,
      skill_name,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

function tryLoadVecRelationCandidateRows(
  db: Database.Database,
  excludeId: string,
  limit: number
): MemoryItemRow[] | null {
  try {
    const vecReady = DatabaseUtils.get(
      db,
      `SELECT COUNT(*) AS cnt FROM sqlite_master
       WHERE type IN ('table', 'virtual')
         AND name IN ('memory_embedding', 'memory_item_vec_minilm')`
    ) as { cnt: number } | undefined;
    if (!vecReady || vecReady.cnt < 2) {
      return null;
    }

    const sourceEmbRow = DatabaseUtils.get(
      db,
      `SELECT embedding
       FROM memory_embedding
       WHERE memory_id = ?
         AND embedding_provider = 'minilm'
         AND model = ?
         AND COALESCE(projection_type, 'native') = 'native'
       ORDER BY id ASC
       LIMIT 1`,
      [excludeId, MINILM_MODEL_NAME]
    ) as { embedding: Buffer | string | null } | undefined;
    if (!sourceEmbRow || !sourceEmbRow.embedding) {
      return null;
    }

    let queryVectorParam: Buffer | string;
    if (Buffer.isBuffer(sourceEmbRow.embedding)) {
      if (sourceEmbRow.embedding.byteLength === 0) {
        return null;
      }
      queryVectorParam = sourceEmbRow.embedding;
    } else if (typeof sourceEmbRow.embedding === 'string' && sourceEmbRow.embedding.length > 0) {
      queryVectorParam = sourceEmbRow.embedding;
    } else {
      return null;
    }

    const prefetchK = Math.max(limit * 4, 100);
    const rows = DatabaseUtils.all(
      db,
      `SELECT
         mi.id, mi.type, mi.content, mi.importance, mi.privacy_scope,
         mi.created_at, mi.last_accessed, mi.pinned, mi.tags, mi.source,
         mi.is_consolidated
       FROM (
         SELECT me.memory_id, MIN(v.distance) AS min_distance
         FROM (
           SELECT rowid, distance
           FROM memory_item_vec_minilm
           WHERE embedding MATCH ?
             AND k = ?
             AND rowid IN (
               SELECT scoped_me.id
               FROM memory_embedding scoped_me
               JOIN memory_item scoped_mi ON scoped_mi.id = scoped_me.memory_id
               WHERE scoped_me.embedding_provider = 'minilm'
                 AND scoped_me.model = ?
                 AND scoped_mi.id != ?
                 AND ${relationCandidateScopeSql('scoped_mi')}
             )
         ) v
         JOIN memory_embedding me ON me.id = v.rowid
         GROUP BY me.memory_id
         ORDER BY min_distance ASC
         LIMIT ?
       ) top_k
       JOIN memory_item mi ON mi.id = top_k.memory_id
       ORDER BY top_k.min_distance ASC`,
      [queryVectorParam, prefetchK, MINILM_MODEL_NAME, excludeId, excludeId, excludeId, limit]
    ) as MemoryItemRow[];

    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

/**
 * Relation candidates are current memories in the new memory's owner and project.
 * NULL matches NULL, like the owner rule before project scoping. Binds the new memory id twice.
 */
function relationCandidateScopeSql(a: 'mi' | 'scoped_mi'): string {
  return `COALESCE(${a}.is_deleted, 0) = 0
    AND NOT ${supersedeByActiveTargetSql(a)}
    AND COALESCE(${a}.owner_id, '') = COALESCE((SELECT owner_id FROM memory_item WHERE id = ?), '')
    AND COALESCE(${a}.project_id, '') = COALESCE((SELECT project_id FROM memory_item WHERE id = ?), '')`;
}

export async function getExistingMemoriesForRelationExtraction(
  db: Database.Database,
  excludeId: string,
  limit: number = 100,
  host: RememberToolHost
): Promise<MemoryItem[]> {
  try {
    const vecRows = tryLoadVecRelationCandidateRows(db, excludeId, limit);
    const rows = vecRows ?? (await DatabaseUtils.all(db, `
      SELECT
        id, type, content, importance, privacy_scope,
        created_at, last_accessed, pinned, tags, source,
        is_consolidated
      FROM memory_item mi
      WHERE mi.id != ?
        AND ${relationCandidateScopeSql('mi')}
      ORDER BY mi.created_at DESC
      LIMIT ?
    `, [excludeId, excludeId, excludeId, limit]) as MemoryItemRow[]);

    return rows.map((row: MemoryItemRow): MemoryItem => ({
      id: row.id,
      type: row.type as MemoryItem['type'],
      content: row.content,
      importance: row.importance,
      privacy_scope: row.privacy_scope as MemoryItem['privacy_scope'],
      created_at: new Date(row.created_at),
      last_accessed: row.last_accessed ? new Date(row.last_accessed) : undefined,
      pinned: Boolean(row.pinned),
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      source: row.source || undefined,
      ...(row.is_consolidated !== undefined && row.is_consolidated !== null
        ? { isConsolidated: Boolean(row.is_consolidated) }
        : {})
    }));
  } catch (error) {
    host.logWarning('기존 기억 조회 실패', {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

export async function getMemoryById(
  db: Database.Database,
  id: string,
  host: RememberToolHost
): Promise<MemoryItem | null> {
  try {
    const row = await DatabaseUtils.get(db, `
      SELECT
        id, type, content, importance, privacy_scope,
        created_at, last_accessed, pinned, tags, source,
        is_consolidated
      FROM memory_item
      WHERE id = ?
    `, [id]) as MemoryItemRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      type: row.type as MemoryItem['type'],
      content: row.content,
      importance: row.importance,
      privacy_scope: row.privacy_scope as MemoryItem['privacy_scope'],
      created_at: new Date(row.created_at),
      last_accessed: row.last_accessed ? new Date(row.last_accessed) : undefined,
      pinned: Boolean(row.pinned),
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      source: row.source || undefined,
      ...(row.is_consolidated !== undefined && row.is_consolidated !== null
        ? { isConsolidated: Boolean(row.is_consolidated) }
        : {})
    };
  } catch (error) {
    host.logWarning('기억 조회 실패', {
      memory_id: id,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

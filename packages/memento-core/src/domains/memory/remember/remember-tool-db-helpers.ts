/**
 * Remember Tool DB 헬퍼 함수 (remember-tool.ts에서 분리, #582).
 */

import type Database from 'better-sqlite3';
import type { MemoryItem } from '../../../shared/types/memory.types.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import type { RememberToolHost } from './remember-tool-host.js';
import type { MemoryItemRow, ProceduralMemoryItem } from './remember-tool-types.js';

export async function findExistingProceduralMemory(
  db: Database.Database,
  workflow_name: string | null | undefined,
  skill_name: string | null | undefined,
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
        recall_count, last_accessed_at, g_value, consolidation_score,
        version, version_series_id
      FROM memory_item
      WHERE type = 'procedural'
        AND workflow_name = ?
        AND skill_name = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [workflow_name, skill_name]);

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
      g_value: (r as Record<string, unknown>).g_value as number | undefined,
      last_accessed_at: (r as Record<string, unknown>).last_accessed_at != null
        ? new Date((r as Record<string, unknown>).last_accessed_at as string)
        : undefined,
      version: (r as Record<string, unknown>).version as number | undefined,
      version_series_id: (r as Record<string, unknown>).version_series_id as string | undefined,
      consolidation_score: (r as Record<string, unknown>).consolidation_score as number | undefined
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

export async function getExistingMemoriesForRelationExtraction(
  db: Database.Database,
  excludeId: string,
  limit: number = 100,
  host: RememberToolHost
): Promise<MemoryItem[]> {
  try {
    const rows = await DatabaseUtils.all(db, `
      SELECT
        id, type, content, importance, privacy_scope,
        created_at, last_accessed, pinned, tags, source,
        is_consolidated
      FROM memory_item
      WHERE id != ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [excludeId, limit]) as MemoryItemRow[];

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

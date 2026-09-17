/**
 * 하이브리드/텍스트 레인이 떨어뜨린 memory_item 메타데이터를 최종 후보에 한 번에 채운다 (#1009).
 *
 * 레인마다 필드를 손으로 베끼는 대신 여기서 한 번 채운다. 두 레인이 구조적으로 같은 값을 받게 되므로
 * 레인 간 드리프트(#998, #1006)가 원천적으로 불가능하다.
 * 후처리 필터(applyVersionFilter, filterRecallItemsByTriggerConditions)보다 먼저 실행돼야 한다.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../shared/utils/logger.js';
import type { RecallSearchItem } from './recall-tool-types.js';

const METADATA_COLUMNS = [
  'privacy_scope',
  'source',
  'origin_source',
  'task_goal',
  'steps',
  'reflection_notes',
  'workflow_name',
  'skill_name',
  'trigger_conditions',
  'version',
  'version_series_id',
] as const;

type MetadataColumn = (typeof METADATA_COLUMNS)[number];

type MetadataRow = {
  id: string;
} & Record<MetadataColumn, string | number | null>;

/**
 * 검색 후보 항목에 memory_item 메타데이터를 배치 조회해 채운다.
 * 필드가 이미 정의돼 있으면(텍스트 전용 경로 등) 덮어쓰지 않는다.
 */
export function enrichRecallItemsWithMemoryMetadata(
  db: Database.Database,
  items: RecallSearchItem[],
): RecallSearchItem[] {
  if (items.length === 0) {
    return items;
  }

  const ids = items
    .map((item) => item.id ?? item.memory_id)
    .filter((id): id is string => Boolean(id));

  if (ids.length === 0) {
    return items;
  }

  try {
    const placeholders = ids.map(() => '?').join(',');
    const columns = METADATA_COLUMNS.join(', ');
    const sql = `SELECT id, ${columns} FROM memory_item WHERE id IN (${placeholders})`;
    const rows = db.prepare(sql).all(...ids) as MetadataRow[];
    const rowById = new Map(rows.map((row) => [row.id, row]));

    return items.map((item) => {
      const itemId = item.id ?? item.memory_id;
      if (!itemId) {
        return item;
      }

      const row = rowById.get(itemId);
      if (!row) {
        return item;
      }

      const enriched: RecallSearchItem = { ...item };
      for (const field of METADATA_COLUMNS) {
        if (enriched[field] === undefined) {
          (enriched as Record<string, unknown>)[field] = row[field];
        }
      }
      return enriched;
    });
  } catch (error) {
    logger.warn('recall 메타데이터 enrichment 실패 — 원본 항목 반환', {
      error: error instanceof Error ? error.message : String(error),
    });
    return items;
  }
}

import type Database from 'better-sqlite3';

import { mementoConfig } from '../shared/config/index.js';
import { DatabaseUtils } from '../shared/utils/database.js';
import { logger } from '../shared/utils/logger.js';

export interface ReflexionObservationPinnedScope {
  ownerId: string | null;
  projectId?: string | null;
}

/** pinned=1 로 idx_memory_item_pinned 사용 가능. 삭제된 pinned 행은 슬롯에 포함하지 않는다. */
export function reflexionPinnedObservationWhere(scope: ReflexionObservationPinnedScope): {
  sql: string;
  params: Array<string | null>;
} {
  const params: Array<string | null> = [scope.ownerId];
  let sql = `
  type = 'episodic'
  AND pinned = 1
  AND COALESCE(is_deleted, 0) = 0
  AND source = 'reflexion'
  AND json_extract(origin_source, '$.reflexion.state') IN ('failure_observation', 'unverified_candidate')
  AND owner_id IS ?`;
  if (scope.projectId !== undefined) {
    sql += ' AND project_id IS ?';
    params.push(scope.projectId ?? null);
  }
  return { sql, params };
}

/** REFLEXION_OBSERVATION_PINNED_MAX <= 0 이면 enforcement 를 건너뛴다(무제한 pin, env.example 참고). */
export function enforceReflexionObservationPinnedCap(
  db: Database.Database,
  slotsNeeded = 1,
  scope: ReflexionObservationPinnedScope,
): void {
  if (!mementoConfig.reflexionObservationOnly) {
    return;
  }

  const max = mementoConfig.reflexionObservationPinnedMax;
  if (max <= 0) {
    return;
  }

  const { sql: whereSql, params: scopeParams } = reflexionPinnedObservationWhere(scope);

  const row = DatabaseUtils.get(
    db,
    `SELECT COUNT(*) AS n FROM memory_item WHERE ${whereSql}`,
    scopeParams,
  ) as { n: number };
  const pinnedCount = Number(row?.n ?? 0);
  const toUnpin = pinnedCount + slotsNeeded - max;
  if (toUnpin <= 0) {
    return;
  }

  const victims = DatabaseUtils.all(
    db,
    `SELECT id FROM memory_item WHERE ${whereSql}
     ORDER BY datetime(created_at) ASC, rowid ASC LIMIT ?`,
    [...scopeParams, toUnpin],
  ) as Array<{ id: string }>;

  for (const { id } of victims) {
    DatabaseUtils.run(db, 'UPDATE memory_item SET pinned = 0 WHERE id = ?', [id]);
  }

  if (victims.length > 0) {
    logger.info('Reflexion 관찰 pinned 상한으로 오래된 행 unpin', {
      unpinned_count: victims.length,
      cap: max,
      slots_needed: slotsNeeded,
      owner_id: scope.ownerId,
      project_id: scope.projectId ?? null,
    });
  }
}

/** 테스트·EXPLAIN: victim 선택 쿼리가 pinned=1 조건을 쓰는지 확인한다. */
export function explainReflexionPinnedVictimQueryPlan(
  db: Database.Database,
  scope: ReflexionObservationPinnedScope,
): string {
  const { sql: whereSql, params: scopeParams } = reflexionPinnedObservationWhere(scope);
  const rows = DatabaseUtils.all(
    db,
    `EXPLAIN QUERY PLAN SELECT id FROM memory_item WHERE ${whereSql}
     ORDER BY datetime(created_at) ASC, rowid ASC LIMIT 1`,
    scopeParams,
  ) as Array<Record<string, unknown>>;
  return JSON.stringify(rows);
}

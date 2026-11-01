import type Database from 'better-sqlite3';

import { mementoConfig } from '../shared/config/index.js';
import { DatabaseUtils } from '../shared/utils/database.js';
import { logger } from '../shared/utils/logger.js';

const REFLEXION_PINNED_EPISODIC_WHERE = `
  type = 'episodic'
  AND COALESCE(pinned, 0) = 1
  AND source = 'reflexion'
  AND json_extract(origin_source, '$.reflexion.state') IN ('failure_observation', 'unverified_candidate')
`;

/** 관찰 분리 모드에서 pinned reflexion episodic 총량을 상한 이하로 유지한다. 초과분은 created_at 오름차순 unpin. */
export function enforceReflexionObservationPinnedCap(db: Database.Database, slotsNeeded = 1): void {
  if (!mementoConfig.reflexionObservationOnly) {
    return;
  }

  const max = mementoConfig.reflexionObservationPinnedMax;
  if (max <= 0) {
    return;
  }

  const row = DatabaseUtils.get(
    db,
    `SELECT COUNT(*) AS n FROM memory_item WHERE ${REFLEXION_PINNED_EPISODIC_WHERE}`
  ) as { n: number };
  const pinnedCount = Number(row?.n ?? 0);
  const toUnpin = pinnedCount + slotsNeeded - max;
  if (toUnpin <= 0) {
    return;
  }

  const victims = DatabaseUtils.all(
    db,
    `SELECT id FROM memory_item WHERE ${REFLEXION_PINNED_EPISODIC_WHERE}
     ORDER BY datetime(created_at) ASC, id ASC LIMIT ?`,
    [toUnpin]
  ) as Array<{ id: string }>;

  for (const { id } of victims) {
    DatabaseUtils.run(db, 'UPDATE memory_item SET pinned = 0 WHERE id = ?', [id]);
  }

  if (victims.length > 0) {
    logger.info('Reflexion 관찰 pinned 상한으로 오래된 행 unpin', {
      unpinned_count: victims.length,
      cap: max,
      slots_needed: slotsNeeded,
    });
  }
}

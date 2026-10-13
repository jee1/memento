/**
 * Owner filter shared by the tool-layer caller scope and domain services (#1342).
 */

import type Database from 'better-sqlite3';

/** The subset of `ids` whose memory_item.owner_id is `ownerId`. */
export function selectIdsOwnedBy(db: Database.Database, ownerId: string, ids: readonly string[]): Set<string> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const rows = db
    .prepare(`SELECT id FROM memory_item WHERE owner_id IS ? AND id IN (${unique.map(() => '?').join(',')})`)
    .all(ownerId, ...unique) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

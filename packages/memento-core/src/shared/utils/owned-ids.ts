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

/**
 * Memories a caller may read. Token-bound callers carry their bound owner and project;
 * unbound callers pass `{}` to state legacy unscoped access explicitly (#1094).
 */
export interface CallerMemoryScope {
  readonly owner_id?: string;
  readonly project_id?: string;
}

/** `AND owner_id IS ? AND project_id IS ?` for the set fields of `scope`. */
export function callerMemoryScopeSql(scope: CallerMemoryScope): { sql: string; params: string[] } {
  const sql: string[] = [];
  const params: string[] = [];
  if (scope.owner_id !== undefined) {
    sql.push(' AND owner_id IS ?');
    params.push(scope.owner_id);
  }
  if (scope.project_id !== undefined) {
    sql.push(' AND project_id IS ?');
    params.push(scope.project_id);
  }
  return { sql: sql.join(''), params };
}

/** The subset of `ids` that are live (not soft-deleted) and inside `scope`. */
export function selectIdsInScope(db: Database.Database, scope: CallerMemoryScope, ids: readonly string[]): Set<string> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const caller = callerMemoryScopeSql(scope);
  const rows = db
    .prepare(
      `SELECT id FROM memory_item
       WHERE id IN (${unique.map(() => '?').join(',')}) AND COALESCE(is_deleted, 0) = 0${caller.sql}`,
    )
    .all(...unique, ...caller.params) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

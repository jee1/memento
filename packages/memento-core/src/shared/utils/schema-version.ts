import type Database from 'better-sqlite3';
import { DatabaseUtils } from './database.js';

/**
 * Latest applied schema version from memento_schema_version, or null when the
 * table is missing or empty (#1332).
 */
export function readCurrentSchemaVersion(db: Database.Database): string | null {
  try {
    const row = DatabaseUtils.get(
      db,
      'SELECT version FROM memento_schema_version ORDER BY applied_at DESC, CAST(version AS REAL) DESC LIMIT 1',
    ) as
      | { version?: string }
      | undefined;
    return row?.version ?? null;
  } catch {
    return null;
  }
}

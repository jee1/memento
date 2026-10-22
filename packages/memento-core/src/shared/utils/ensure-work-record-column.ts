import type Database from 'better-sqlite3';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (item) => item.name === column,
  );
}

/** memory_item.work_record (#1446). 이미 있으면 아무 것도 하지 않는다. */
export function ensureWorkRecordColumn(db: Database.Database): void {
  if (!hasColumn(db, 'memory_item', 'work_record')) {
    db.exec('ALTER TABLE memory_item ADD COLUMN work_record TEXT');
  }
}

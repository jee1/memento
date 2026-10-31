import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MemorySupersedePointerMigration } from './060-memory-supersede-pointer.js';

const schemaSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema.sql'),
  'utf8',
);

function seededDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT);
           INSERT INTO memory_item (id) VALUES ('old'), ('new');`);
  return db;
}

function insertEvent(db: Database.Database, action: string): void {
  db.prepare(
    `INSERT INTO memory_supersede_event (
       id, action, old_memory_id, new_memory_id, candidate_id, actor, reason,
       old_content_sha256, new_content_sha256, created_at
     ) VALUES (?, ?, 'old', 'new', NULL, 'operator', NULL, 'a', 'b', '2026-11-01T00:00:00.000Z')`,
  ).run(`e-${action}`, action);
}

const columnNames = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

describe('060-memory-supersede-pointer', () => {
  it('adds the pointer column and the audit table, and can run twice', async () => {
    const db = seededDb();
    const migration = new MemorySupersedePointerMigration();
    await migration.up(db);
    await migration.up(db);
    await migration.validateAfter(db);

    expect(columnNames(db, 'memory_item')).toContain('superseded_by');
    insertEvent(db, 'applied');
    insertEvent(db, 'restored');
    expect(() => insertEvent(db, 'deleted')).toThrow(/CHECK/);
    db.close();
  });

  it('keeps audit events after the memories are hard deleted', async () => {
    const db = seededDb();
    await new MemorySupersedePointerMigration().up(db);
    insertEvent(db, 'applied');
    db.prepare('DELETE FROM memory_item').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_supersede_event').get()).toEqual({ n: 1 });
    db.close();
  });

  it('matches schema.sql for the pointer column and the audit table', async () => {
    const fromMigration = seededDb();
    await new MemorySupersedePointerMigration().up(fromMigration);

    const memoryItemSql = schemaSql.match(/CREATE TABLE IF NOT EXISTS memory_item \([\s\S]*?\n\);/);
    expect(memoryItemSql?.[0]).toMatch(/\n {2}superseded_by TEXT\b/);

    const fromSchema = new Database(':memory:');
    const statements = schemaSql.match(
      /CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS (?:memory_supersede_event|idx_memory_supersede_event_\w+)[\s\S]*?;/g,
    );
    expect(statements).not.toBeNull();
    fromSchema.exec(statements!.join('\n'));

    const shape = (db: Database.Database) => ({
      columns: db.prepare('PRAGMA table_info(memory_supersede_event)').all(),
      foreignKeys: db.prepare('PRAGMA foreign_key_list(memory_supersede_event)').all(),
      indexes: db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memory_supersede_event' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name`,
        )
        .all(),
    });
    expect(shape(fromSchema)).toEqual(shape(fromMigration));
    fromMigration.close();
    fromSchema.close();
  });

  it('down removes the column, the table and the version row', async () => {
    const db = seededDb();
    db.exec(`CREATE TABLE memento_schema_version (version TEXT PRIMARY KEY);
             INSERT INTO memento_schema_version (version) VALUES ('60.0');`);
    const migration = new MemorySupersedePointerMigration();
    await migration.up(db);
    await migration.down(db);
    expect(columnNames(db, 'memory_item')).not.toContain('superseded_by');
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'memory_supersede_event'`).get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM memento_schema_version').get()).toEqual({ n: 0 });
    db.close();
  });
});

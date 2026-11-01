import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SettingOverrideMigration } from './063-setting-override.js';

const schemaSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema.sql'),
  'utf8',
);

const TABLES = ['setting_override', 'setting_override_event'];

function insertEvent(db: Database.Database, overrides: Record<string, unknown> = {}): void {
  db.prepare(
    `INSERT INTO setting_override_event (id, setting_key, action, actor, created_at)
     VALUES (@id, 'REFLEXION_OBSERVATION_ONLY', @action, 'session:abc', '2026-11-01T00:00:00.000Z')`,
  ).run({ id: 'e1', action: 'set', ...overrides });
}

const shape = (db: Database.Database) =>
  TABLES.map((table) => ({
    table,
    columns: db.prepare(`PRAGMA table_info(${table})`).all(),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list(${table})`).all(),
    indexes: db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name`,
      )
      .all(table),
    triggers: db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name = ? ORDER BY name`).all(table),
  }));

describe('063-setting-override', () => {
  it('is idempotent and constrains the event action', async () => {
    const db = new Database(':memory:');
    const migration = new SettingOverrideMigration();
    await migration.up(db);
    await migration.up(db);
    await migration.validateAfter(db);

    insertEvent(db);
    expect(() => insertEvent(db, { id: 'e2', action: 'delete' })).toThrow(/CHECK/);
    expect(shape(db).every((entry) => entry.foreignKeys.length === 0)).toBe(true);
    db.close();
  });

  it('refuses UPDATE and DELETE so the history stays append-only', async () => {
    const db = new Database(':memory:');
    await new SettingOverrideMigration().up(db);
    insertEvent(db);
    expect(() => db.prepare("UPDATE setting_override_event SET action = 'revert'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM setting_override_event').run()).toThrow(/append-only/);
    expect(db.prepare('SELECT action FROM setting_override_event').all()).toEqual([{ action: 'set' }]);
    db.close();
  });

  it('matches schema.sql columns, indexes and triggers', async () => {
    const fromMigration = new Database(':memory:');
    await new SettingOverrideMigration().up(fromMigration);
    const fromSchema = new Database(':memory:');
    const statements = schemaSql.match(
      /CREATE (?:TABLE|INDEX) IF NOT EXISTS (?:setting_override\b|setting_override_event\b|idx_setting_override_event_\w+)[\s\S]*?;|CREATE TRIGGER IF NOT EXISTS setting_override_event_\w+[\s\S]*?END;/g,
    );
    expect(statements).toHaveLength(5);
    fromSchema.exec(statements!.join('\n'));
    expect(shape(fromSchema)).toEqual(shape(fromMigration));
    fromMigration.close();
    fromSchema.close();
  });

  it('down drops both tables and the version row', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE memento_schema_version (version TEXT PRIMARY KEY);
             INSERT INTO memento_schema_version (version) VALUES ('63.0');`);
    const migration = new SettingOverrideMigration();
    await migration.up(db);
    await migration.down(db);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE 'setting_override%'`).all()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM memento_schema_version').get()).toEqual({ n: 0 });
    db.close();
  });
});

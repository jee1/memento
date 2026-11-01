import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProceduralExecutionEvidenceMigration } from './061-procedural-execution-evidence.js';

const schemaSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema.sql'),
  'utf8',
);

function insert(db: Database.Database, overrides: Record<string, unknown> = {}): void {
  db.prepare(
    `INSERT INTO procedural_execution_evidence
       (id, run_id, memory_id, content_sha256, case_id, kind, environment, tool_version, outcome, created_at)
     VALUES (@id, @run_id, 'm', 'sha', 'case', @kind, 'env', '1', @outcome, '2026-11-01T00:00:00.000Z')`,
  ).run({ id: 'e1', run_id: 'r1', kind: 'replay', outcome: 'success', ...overrides });
}

const shape = (db: Database.Database) => ({
  columns: db.prepare('PRAGMA table_info(procedural_execution_evidence)').all(),
  foreignKeys: db.prepare('PRAGMA foreign_key_list(procedural_execution_evidence)').all(),
  indexes: db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='procedural_execution_evidence'
    AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name`).all(),
  triggers: db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='procedural_execution_evidence'
    ORDER BY name`).all(),
});

describe('061-procedural-execution-evidence', () => {
  it('enforces run_id uniqueness and kind/outcome checks', async () => {
    const db = new Database(':memory:');
    const migration = new ProceduralExecutionEvidenceMigration();
    await migration.up(db);
    await migration.up(db);
    await migration.validateAfter(db);

    insert(db);
    expect(() => insert(db, { id: 'e2' })).toThrow(/UNIQUE/);
    expect(() => insert(db, { id: 'e3', run_id: 'r3', kind: 'live' })).toThrow(/CHECK/);
    expect(() => insert(db, { id: 'e4', run_id: 'r4', outcome: 'helpful' })).toThrow(/CHECK/);
    expect(shape(db).foreignKeys).toEqual([]);
    db.close();
  });

  it('refuses UPDATE and DELETE so the evidence stays append-only', async () => {
    const db = new Database(':memory:');
    await new ProceduralExecutionEvidenceMigration().up(db);
    insert(db);
    expect(() => db.prepare("UPDATE procedural_execution_evidence SET outcome = 'failure'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM procedural_execution_evidence').run()).toThrow(/append-only/);
    expect(db.prepare('SELECT outcome FROM procedural_execution_evidence').all()).toEqual([{ outcome: 'success' }]);
    db.close();
  });

  it('matches schema.sql columns, indexes and triggers', async () => {
    const fromMigration = new Database(':memory:');
    await new ProceduralExecutionEvidenceMigration().up(fromMigration);
    const fromSchema = new Database(':memory:');
    const statements = schemaSql.match(
      /CREATE (?:TABLE|INDEX) IF NOT EXISTS (?:procedural_execution_evidence|idx_procedural_execution_evidence_\w+)[\s\S]*?;|CREATE TRIGGER IF NOT EXISTS procedural_execution_evidence_\w+[\s\S]*?END;/g,
    );
    expect(statements).toHaveLength(4);
    fromSchema.exec(statements!.join('\n'));
    expect(shape(fromSchema)).toEqual(shape(fromMigration));
    fromMigration.close();
    fromSchema.close();
  });

  it('down drops the table and its version row', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE memento_schema_version (version TEXT PRIMARY KEY);
             INSERT INTO memento_schema_version (version) VALUES ('61.0');`);
    const migration = new ProceduralExecutionEvidenceMigration();
    await migration.up(db);
    await migration.down(db);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'procedural_execution_evidence'`).get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM memento_schema_version').get()).toEqual({ n: 0 });
    db.close();
  });
});

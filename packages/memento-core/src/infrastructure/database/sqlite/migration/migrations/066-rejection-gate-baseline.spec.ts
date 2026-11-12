import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RejectionGateBaselineMigration } from './066-rejection-gate-baseline.js';

const schemaSql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema.sql'),
  'utf8',
);

const shape = (db: Database.Database) => ({
  columns: db.prepare('PRAGMA table_info(rejection_gate_baseline)').all(),
  triggers: db
    .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='rejection_gate_baseline' ORDER BY name`)
    .all(),
});

function insertPartialReference(db: Database.Database): void {
  db.prepare(
    `INSERT INTO rejection_gate_baseline
       (threshold, n_items, measured_at, judge_model, source, reference_window_start, captured_at)
     VALUES (0.5, 10, '2026-11-12T00:00:00.000Z', 'jev-latest', 'startup', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z')`,
  ).run();
}

describe('066-rejection-gate-baseline', () => {
  it('seeds the two 0.40 measurements and stays the same when run twice', async () => {
    const db = new Database(':memory:');
    const migration = new RejectionGateBaselineMigration();
    await migration.up(db);
    await migration.up(db);
    await migration.validateAfter(db);

    const rows = db.prepare('SELECT * FROM rejection_gate_baseline ORDER BY id').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 1,
      threshold: 0.4,
      n_items: 11121,
      measured_at: '2026-10-18T00:00:00.000Z',
      judge_model: 'jev-latest',
      label_set_id: '#1387 라벨 팩',
      source: 'measurement',
      reference_window_start: '2026-10-18T00:00:00.000Z',
      reference_window_end: '2026-10-25T00:00:00.000Z',
      reference_decided_n: 503,
    });
    expect(rows[0].reference_rejection_rate).toBeCloseTo(104 / 503, 10);
    expect(rows[0].reference_knee_mass).toBeCloseTo(36 / 503, 10);
    expect(rows[1]).toMatchObject({ id: 2, measured_at: '2026-11-09T00:00:00.000Z', reference_decided_n: 503 });
    expect(rows[1].reference_rejection_rate).toBe(rows[0].reference_rejection_rate);
    db.close();
  });

  it('refuses UPDATE and DELETE so the baseline stays append-only', async () => {
    const db = new Database(':memory:');
    await new RejectionGateBaselineMigration().up(db);
    expect(() => db.prepare('UPDATE rejection_gate_baseline SET threshold = 0.5').run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM rejection_gate_baseline').run()).toThrow(/append-only/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM rejection_gate_baseline').get()).toEqual({ n: 2 });
    db.close();
  });

  it('rejects a reference that is only partly filled', async () => {
    const db = new Database(':memory:');
    await new RejectionGateBaselineMigration().up(db);
    expect(insertPartialReference.bind(null, db)).toThrow(/CHECK/);
    db.close();
  });

  it('matches schema.sql columns and triggers, with no seed rows on a fresh database', async () => {
    const fromMigration = new Database(':memory:');
    await new RejectionGateBaselineMigration().up(fromMigration);
    const fromSchema = new Database(':memory:');
    const statements = schemaSql.match(
      /CREATE TABLE IF NOT EXISTS rejection_gate_baseline\b[\s\S]*?\n\);|CREATE TRIGGER IF NOT EXISTS rejection_gate_baseline_\w+[\s\S]*?END;/g,
    );
    expect(statements).toHaveLength(3);
    fromSchema.exec(statements!.join('\n'));
    expect(shape(fromSchema)).toEqual(shape(fromMigration));
    expect(fromSchema.prepare('SELECT COUNT(*) AS n FROM rejection_gate_baseline').get()).toEqual({ n: 0 });
    fromMigration.close();
    fromSchema.close();
  });

  it('down drops the table and the version row', async () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE memento_schema_version (version TEXT PRIMARY KEY);
             INSERT INTO memento_schema_version (version) VALUES ('66.0');`);
    const migration = new RejectionGateBaselineMigration();
    await migration.up(db);
    await migration.down(db);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE 'rejection_gate_baseline%'`).all()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM memento_schema_version').get()).toEqual({ n: 0 });
    db.close();
  });
});

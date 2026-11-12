import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  queryRejectionGateKneeMass,
  queryRejectionGateRate,
} from '../../../../../domains/telemetry/repositories/telemetry-search-quality-query.js';
import { TelemetryEventsMigration } from './027-telemetry-events.js';
import { RejectionGateBaselineMigration, SEED_REFERENCE_WINDOW } from './066-rejection-gate-baseline.js';

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

let eventSeq = 0;

function insertReranked(db: Database.Database, createdAt: string, verdict: string, count: number, topScore: number | null): void {
  const insert = db.prepare(
    `INSERT INTO telemetry_events (id, event_type, request_id, owner_id, outcome, extra_data, created_at)
     VALUES (?, 'memory.search.reranked', ?, NULL, 'success', ?, ?)`,
  );
  const extra = JSON.stringify({ rejection_gate_verdict: verdict, rejection_gate_top_score: topScore });
  for (let i = 0; i < count; i += 1) {
    eventSeq += 1;
    insert.run(`e${eventSeq}`, `r${eventSeq}`, extra, createdAt);
  }
}

async function dbWithTelemetry(fill: (db: Database.Database) => void): Promise<Database.Database> {
  const db = new Database(':memory:');
  await new TelemetryEventsMigration().up(db);
  fill(db);
  await new RejectionGateBaselineMigration().up(db);
  return db;
}

const seedRows = (db: Database.Database) =>
  db.prepare('SELECT * FROM rejection_gate_baseline ORDER BY id').all() as Array<Record<string, unknown>>;

describe('066-rejection-gate-baseline', () => {
  it('computes the seed reference from local telemetry with the monitor aggregation rules', async () => {
    const inWindow = '2026-11-04T12:00:00.000Z';
    const db = await dbWithTelemetry((d) => {
      insertReranked(d, SEED_REFERENCE_WINDOW.start, 'rejected', 40, 0.1);
      insertReranked(d, inWindow, 'passed', 30, 0.4);
      insertReranked(d, inWindow, 'passed', 20, 0.49);
      insertReranked(d, inWindow, 'passed', 25, 0.5);
      insertReranked(d, inWindow, 'passed', 10, 0.9);
      insertReranked(d, inWindow, 'fail_open', 7, null);
      insertReranked(d, inWindow, 'off', 5, null);
      insertReranked(d, SEED_REFERENCE_WINDOW.end, 'rejected', 50, 0.1);
      insertReranked(d, '2026-11-01T23:59:59.999Z', 'rejected', 50, 0.1);
    });

    const rate = queryRejectionGateRate(db, SEED_REFERENCE_WINDOW);
    const knee = queryRejectionGateKneeMass(db, SEED_REFERENCE_WINDOW, 0.4, 0.1);
    expect(rate.rejection_decided_count).toBe(125);
    for (const row of seedRows(db)) {
      expect(row).toMatchObject({
        reference_window_start: SEED_REFERENCE_WINDOW.start,
        reference_window_end: SEED_REFERENCE_WINDOW.end,
        reference_decided_n: rate.rejection_decided_count,
      });
      expect(row.reference_rejection_rate).toBe(rate.rejection_rate);
      expect(row.reference_knee_mass).toBe(knee);
    }
    expect(knee).toBeCloseTo(50 / 125, 10);
    db.close();
  });

  it('leaves the seed reference empty when the window has fewer than 100 decided queries', async () => {
    const db = await dbWithTelemetry((d) => {
      insertReranked(d, '2026-11-04T12:00:00.000Z', 'passed', 99, 0.9);
      insertReranked(d, '2026-11-04T12:00:00.000Z', 'fail_open', 50, null);
    });
    for (const row of seedRows(db)) {
      expect(row).toMatchObject({ reference_window_start: null, reference_decided_n: null, reference_knee_mass: null });
    }
    db.close();
  });

  it('seeds the two 0.40 measurements and stays the same when run twice', async () => {
    const db = new Database(':memory:');
    const migration = new RejectionGateBaselineMigration();
    await migration.up(db);
    await migration.up(db);
    await migration.validateAfter(db);

    const rows = seedRows(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 1,
      threshold: 0.4,
      n_items: 11121,
      measured_at: '2026-10-18T00:00:00.000Z',
      judge_model: 'jev-latest',
      label_set_id: '#1387 라벨 팩',
      source: 'measurement',
      reference_window_start: null,
    });
    expect(rows[1]).toMatchObject({ id: 2, measured_at: '2026-11-09T00:00:00.000Z', reference_window_start: null });
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

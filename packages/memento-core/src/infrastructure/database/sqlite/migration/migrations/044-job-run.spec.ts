import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { JobRunMigration } from './044-job-run.js';

describe('JobRunMigration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates job_run table and indexes', async () => {
    await new JobRunMigration().up(db);
    await new JobRunMigration().validateAfter(db);

    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='job_run'`)
      .get();
    expect(table).toBeDefined();

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='job_run'`)
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map(i => i.name);
    expect(indexNames).toContain('idx_job_run_job_started');
    expect(indexNames).toContain('idx_job_run_started');
  });

  it('accepts insert with schedule/manual trigger and nullable fields', async () => {
    await new JobRunMigration().up(db);

    db.prepare(
      `INSERT INTO job_run (id, job_name, trigger, started_at, ended_at, success, duration_ms, processed, error_count, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('r1', 'cleanup', 'schedule', '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:01.000Z', 1, 1000, null, null, null);

    const row = db.prepare(`SELECT * FROM job_run WHERE id = 'r1'`).get() as Record<string, unknown>;
    expect(row.job_name).toBe('cleanup');
    expect(row.trigger).toBe('schedule');
    expect(row.processed).toBeNull();
  });

  it('down() removes job_run table', async () => {
    const migration = new JobRunMigration();
    await migration.up(db);
    await migration.down(db);

    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='job_run'`)
      .get();
    expect(table).toBeUndefined();
  });
});

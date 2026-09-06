import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { JobRunMigration } from './044-job-run.js';
import { JobRunLogMigration } from './046-job-run-log.js';

describe('JobRunLogMigration', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    await new JobRunMigration().up(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates job_run_log table and index', async () => {
    await new JobRunLogMigration().up(db);
    await new JobRunLogMigration().validateAfter(db);

    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='job_run_log'`)
      .get();
    expect(table).toBeDefined();

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='job_run_log'`)
      .all() as Array<{ name: string }>;
    expect(indexes.map(i => i.name)).toContain('idx_job_run_log_run_ts');
  });

  it('accepts insert with FK to job_run and level check', async () => {
    await new JobRunLogMigration().up(db);

    db.prepare(
      `INSERT INTO job_run (id, job_name, trigger, started_at, ended_at, success, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('jr_1', 'cleanup', 'schedule', '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:01.000Z', 1, 1000);

    db.prepare(
      `INSERT INTO job_run_log (id, run_id, ts, level, message, context_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('jrl_1', 'jr_1', '2026-09-06T00:00:00.100Z', 'info', 'started', '{"phase":"start"}');

    const row = db.prepare(`SELECT * FROM job_run_log WHERE id = 'jrl_1'`).get() as Record<string, unknown>;
    expect(row.run_id).toBe('jr_1');
    expect(row.level).toBe('info');
  });

  it('cascades delete when parent job_run is deleted (PRAGMA foreign_keys=ON)', async () => {
    await new JobRunLogMigration().up(db);

    db.prepare(
      `INSERT INTO job_run (id, job_name, trigger, started_at, ended_at, success, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('jr_1', 'cleanup', 'schedule', '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:01.000Z', 1, 1000);
    db.prepare(
      `INSERT INTO job_run_log (id, run_id, ts, level, message, context_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('jrl_1', 'jr_1', '2026-09-06T00:00:00.100Z', 'info', 'started', null);

    db.prepare(`DELETE FROM job_run WHERE id = ?`).run('jr_1');
    const remaining = db.prepare(`SELECT COUNT(*) AS c FROM job_run_log`).get() as { c: number };
    expect(remaining.c).toBe(0);
  });

  it('down() removes job_run_log table', async () => {
    const migration = new JobRunLogMigration();
    await migration.up(db);
    await migration.down(db);

    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='job_run_log'`)
      .get();
    expect(table).toBeUndefined();
  });

  it('validateBefore fails without job_run', async () => {
    const bare = new Database(':memory:');
    try {
      await expect(new JobRunLogMigration().validateBefore(bare)).rejects.toThrow(/job_run/);
    } finally {
      bare.close();
    }
  });
});

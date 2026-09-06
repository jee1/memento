import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { JobRunMigration } from '../../database/sqlite/migration/migrations/044-job-run.js';
import { JobRunRepository, appendJobRunSafe } from './job-run-repository.js';

const DAY_MS = 86_400_000;

describe('JobRunRepository', () => {
  let db: Database.Database;
  let repo: JobRunRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    await new JobRunMigration().up(db);
    repo = new JobRunRepository();
  });

  afterEach(() => {
    db.close();
  });

  it('append() inserts a row and returns it with generated id', () => {
    const row = repo.append(db, {
      job_name: 'cleanup',
      trigger: 'schedule',
      started_at: '2026-09-06T00:00:00.000Z',
      ended_at: '2026-09-06T00:00:01.200Z',
      success: true,
      duration_ms: 1200,
    });

    expect(row.id).toBeTruthy();
    expect(row.job_name).toBe('cleanup');
    expect(row.trigger).toBe('schedule');
    expect(row.success).toBe(1);
    expect(row.processed).toBeNull();
    expect(row.error_count).toBeNull();
    expect(row.details_json).toBeNull();
  });

  it('append() persists optional processed/error_count/details_json', () => {
    const row = repo.append(db, {
      job_name: 'triple_extraction_batch',
      trigger: 'schedule',
      started_at: '2026-09-06T00:00:00.000Z',
      ended_at: '2026-09-06T00:00:01.000Z',
      success: true,
      duration_ms: 1000,
      processed: 10,
      error_count: 2,
      details_json: JSON.stringify({ note: 'ok' }),
    });

    expect(row.processed).toBe(10);
    expect(row.error_count).toBe(2);
    expect(row.details_json).toBe(JSON.stringify({ note: 'ok' }));
  });

  it('list() returns newest-first and clamps limit to 1..100 (default 50)', () => {
    for (let i = 0; i < 5; i++) {
      repo.append(db, {
        job_name: 'cleanup',
        trigger: 'schedule',
        started_at: new Date(Date.now() - i * 1000).toISOString(),
        ended_at: new Date(Date.now() - i * 1000 + 100).toISOString(),
        success: true,
        duration_ms: 100,
      });
    }

    const rows = repo.list(db, {});
    expect(rows).toHaveLength(5);
    expect(new Date(rows[0]!.started_at).getTime()).toBeGreaterThan(
      new Date(rows[rows.length - 1]!.started_at).getTime(),
    );

    const clampedLow = repo.list(db, { limit: 0 });
    expect(clampedLow.length).toBeLessThanOrEqual(1);

    const clampedHigh = repo.list(db, { limit: 1000 });
    expect(clampedHigh.length).toBeLessThanOrEqual(100);
  });

  it('list() filters by jobName', () => {
    repo.append(db, {
      job_name: 'cleanup',
      trigger: 'schedule',
      started_at: '2026-09-06T00:00:00.000Z',
      ended_at: '2026-09-06T00:00:01.000Z',
      success: true,
      duration_ms: 1000,
    });
    repo.append(db, {
      job_name: 'monitoring',
      trigger: 'manual',
      started_at: '2026-09-06T00:00:02.000Z',
      ended_at: '2026-09-06T00:00:03.000Z',
      success: false,
      duration_ms: 1000,
    });

    const rows = repo.list(db, { jobName: 'monitoring' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.job_name).toBe('monitoring');
  });

  it('list() returns empty array when no rows match', () => {
    expect(repo.list(db, { jobName: 'unknown_job' })).toEqual([]);
  });

  it('deleteExpired() removes rows older than retentionDays using JS ISO cutoff', () => {
    const old = new Date(Date.now() - 91 * DAY_MS).toISOString();
    const recent = new Date(Date.now() - 10 * DAY_MS).toISOString();
    repo.append(db, {
      job_name: 'cleanup',
      trigger: 'schedule',
      started_at: old,
      ended_at: old,
      success: true,
      duration_ms: 100,
    });
    repo.append(db, {
      job_name: 'cleanup',
      trigger: 'schedule',
      started_at: recent,
      ended_at: recent,
      success: true,
      duration_ms: 100,
    });

    const deleted = repo.deleteExpired(db, 90);
    expect(deleted).toBe(1);
    expect(repo.list(db, {})).toHaveLength(1);
  });
});

describe('appendJobRunSafe', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    await new JobRunMigration().up(db);
  });

  afterEach(() => {
    db.close();
  });

  it('appends a row when db is available', () => {
    appendJobRunSafe(db, {
      job_name: 'cleanup',
      trigger: 'manual',
      started_at: '2026-09-06T00:00:00.000Z',
      ended_at: '2026-09-06T00:00:01.000Z',
      success: true,
      duration_ms: 1000,
    });

    const rows = new JobRunRepository().list(db, {});
    expect(rows).toHaveLength(1);
  });

  it('does not throw when db is null (soft-fail)', () => {
    expect(() =>
      appendJobRunSafe(null, {
        job_name: 'cleanup',
        trigger: 'manual',
        started_at: '2026-09-06T00:00:00.000Z',
        ended_at: '2026-09-06T00:00:01.000Z',
        success: true,
        duration_ms: 1000,
      }),
    ).not.toThrow();
  });

  it('does not throw when the table is missing (soft-fail, logs warning)', () => {
    const bareDb = new Database(':memory:');
    const warnSpy = vi.fn();
    try {
      expect(() =>
        appendJobRunSafe(
          bareDb,
          {
            job_name: 'cleanup',
            trigger: 'manual',
            started_at: '2026-09-06T00:00:00.000Z',
            ended_at: '2026-09-06T00:00:01.000Z',
            success: true,
            duration_ms: 1000,
          },
          warnSpy,
        ),
      ).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      bareDb.close();
    }
  });
});

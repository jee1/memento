import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { JobRunMigration } from '../../database/sqlite/migration/migrations/044-job-run.js';
import { JobRunLogMigration } from '../../database/sqlite/migration/migrations/046-job-run-log.js';
import { JobRunRepository } from './job-run-repository.js';
import {
  JobRunLogRepository,
  appendJobRunLogSafe,
  appendJobRunLogsManySafe,
} from './job-run-log-repository.js';

const DAY_MS = 86_400_000;

async function setupDb(): Promise<Database.Database> {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  await new JobRunMigration().up(db);
  await new JobRunLogMigration().up(db);
  return db;
}

function seedRun(db: Database.Database, idSuffix = '1'): string {
  const row = new JobRunRepository().append(db, {
    job_name: 'cleanup',
    trigger: 'schedule',
    started_at: '2026-09-06T00:00:00.000Z',
    ended_at: '2026-09-06T00:00:01.000Z',
    success: true,
    duration_ms: 1000,
  });
  void idSuffix;
  return row.id;
}

describe('JobRunLogRepository', () => {
  let db: Database.Database;
  let repo: JobRunLogRepository;

  beforeEach(async () => {
    db = await setupDb();
    repo = new JobRunLogRepository();
  });

  afterEach(() => {
    db.close();
  });

  it('append() inserts a row and returns it with generated id', () => {
    const runId = seedRun(db);
    const row = repo.append(db, {
      run_id: runId,
      ts: '2026-09-06T00:00:00.100Z',
      level: 'info',
      message: 'cleanup started',
      context_json: JSON.stringify({ phase: 'start' }),
    });

    expect(row.id).toMatch(/^jrl_/);
    expect(row.run_id).toBe(runId);
    expect(row.level).toBe('info');
    expect(row.message).toBe('cleanup started');
    expect(row.context_json).toBe(JSON.stringify({ phase: 'start' }));
  });

  it('appendMany() inserts multiple lines for a run', () => {
    const runId = seedRun(db);
    const count = repo.appendMany(db, runId, [
      { ts: '2026-09-06T00:00:00.100Z', level: 'info', message: 'start' },
      { ts: '2026-09-06T00:00:00.200Z', level: 'warn', message: 'slow' },
      { ts: '2026-09-06T00:00:00.300Z', level: 'error', message: 'fail' },
    ]);
    expect(count).toBe(3);
    expect(repo.listByRunId(db, runId)).toHaveLength(3);
  });

  it('listByRunId() returns chronological ASC and clamps limit to 1..500 (default 200)', () => {
    const runId = seedRun(db);
    for (let i = 0; i < 5; i++) {
      repo.append(db, {
        run_id: runId,
        ts: `2026-09-06T00:00:0${i}.000Z`,
        level: 'info',
        message: `line-${i}`,
      });
    }

    const rows = repo.listByRunId(db, runId);
    expect(rows).toHaveLength(5);
    expect(rows[0]!.message).toBe('line-0');
    expect(rows[4]!.message).toBe('line-4');

    expect(repo.listByRunId(db, runId, { limit: 0 })).toHaveLength(1);
    expect(repo.listByRunId(db, runId, { limit: 2 })).toHaveLength(2);
    expect(repo.listByRunId(db, runId, { limit: 1000 }).length).toBeLessThanOrEqual(500);
  });

  it('listByRunId() returns empty array when no logs', () => {
    const runId = seedRun(db);
    expect(repo.listByRunId(db, runId)).toEqual([]);
  });
});

describe('appendJobRunLogSafe / appendJobRunLogsManySafe', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupDb();
  });

  afterEach(() => {
    db.close();
  });

  it('appendJobRunLogSafe appends when db is available', () => {
    const runId = seedRun(db);
    appendJobRunLogSafe(db, {
      run_id: runId,
      ts: '2026-09-06T00:00:00.100Z',
      level: 'info',
      message: 'ok',
    });
    expect(new JobRunLogRepository().listByRunId(db, runId)).toHaveLength(1);
  });

  it('does not throw when db is null (soft-fail)', () => {
    expect(() =>
      appendJobRunLogSafe(null, {
        run_id: 'jr_x',
        ts: '2026-09-06T00:00:00.100Z',
        level: 'info',
        message: 'ok',
      }),
    ).not.toThrow();
  });

  it('does not throw when table is missing (soft-fail, logs warning)', () => {
    const bareDb = new Database(':memory:');
    const warnSpy = vi.fn();
    try {
      expect(() =>
        appendJobRunLogsManySafe(
          bareDb,
          'jr_x',
          [{ ts: '2026-09-06T00:00:00.100Z', level: 'info', message: 'ok' }],
          warnSpy,
        ),
      ).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      bareDb.close();
    }
  });
});

describe('job_run deleteExpired cascades to job_run_log (FR-011)', () => {
  it('parent deleteExpired removes child logs when foreign_keys=ON', async () => {
    const db = await setupDb();
    try {
      const runRepo = new JobRunRepository();
      const logRepo = new JobRunLogRepository();

      const old = new Date(Date.now() - 91 * DAY_MS).toISOString();
      const recent = new Date(Date.now() - 10 * DAY_MS).toISOString();

      const oldRun = runRepo.append(db, {
        job_name: 'cleanup',
        trigger: 'schedule',
        started_at: old,
        ended_at: old,
        success: true,
        duration_ms: 100,
      });
      const recentRun = runRepo.append(db, {
        job_name: 'cleanup',
        trigger: 'schedule',
        started_at: recent,
        ended_at: recent,
        success: true,
        duration_ms: 100,
      });

      logRepo.append(db, {
        run_id: oldRun.id,
        ts: old,
        level: 'info',
        message: 'old log',
      });
      logRepo.append(db, {
        run_id: recentRun.id,
        ts: recent,
        level: 'info',
        message: 'recent log',
      });

      const deleted = runRepo.deleteExpired(db, 90);
      expect(deleted).toBe(1);
      expect(logRepo.listByRunId(db, oldRun.id)).toEqual([]);
      expect(logRepo.listByRunId(db, recentRun.id)).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});

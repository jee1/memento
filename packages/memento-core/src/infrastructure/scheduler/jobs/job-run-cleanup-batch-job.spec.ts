import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { JobRunCleanupBatchJob } from './job-run-cleanup-batch-job.js';
import { JobRunRepository } from '../repositories/job-run-repository.js';
import { JobRunMigration } from '../../database/sqlite/migration/migrations/044-job-run.js';
import { DAY_MS } from '../../../shared/utils/date.js';

describe('JobRunCleanupBatchJob', () => {
  let db: Database.Database;
  let repo: JobRunRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    await new JobRunMigration().up(db);
    repo = new JobRunRepository();
    vi.stubEnv('JOB_RUN_RETENTION_DAYS', '90');
  });

  afterEach(() => {
    db.close();
    vi.unstubAllEnvs();
  });

  it('deleteExpired를 retention 일로 호출하고 삭제 건수를 반영한다', async () => {
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

    const job = new JobRunCleanupBatchJob({ db, repository: repo });
    const r = await job.execute();

    expect(r.success).toBe(true);
    expect(r.processed).toBe(1);
    expect(r.details).toMatchObject({ retentionDays: 90, deleted: 1 });
    expect(repo.list(db, {})).toHaveLength(1);
  });
});

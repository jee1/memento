import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ForgettingEventCleanupBatchJob } from './forgetting-event-cleanup-batch-job.js';
import { ForgettingEventRepository } from '../../../domains/forgetting/repositories/forgetting-event-repository.js';
import { MemoryForgettingEventMigration } from '../../../infrastructure/database/sqlite/migration/migrations/037-memory-forgetting-event.js';
import { DAY_MS } from '../../../shared/utils/date.js';

describe('ForgettingEventCleanupBatchJob', () => {
  let db: Database.Database;
  let repo: ForgettingEventRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    await new MemoryForgettingEventMigration().up(db);
    repo = new ForgettingEventRepository();
    vi.stubEnv('FORGETTING_EVENT_RETENTION_DAYS', '90');
  });

  afterEach(() => {
    db.close();
    vi.unstubAllEnvs();
  });

  it('deleteExpiredEvents를 retention 일로 호출하고 삭제 건수를 반영한다', async () => {
    const old = new Date(Date.now() - 91 * DAY_MS).toISOString();
    const recent = new Date(Date.now() - 10 * DAY_MS).toISOString();
    repo.insert(db, {
      memory_id: 'mem_old',
      action: 'soft',
      reason: 'old',
      policy: 'test',
      created_at: old,
    });
    repo.insert(db, {
      memory_id: 'mem_recent',
      action: 'soft',
      reason: 'recent',
      policy: 'test',
      created_at: recent,
    });

    const job = new ForgettingEventCleanupBatchJob({ db, repository: repo });
    const r = await job.execute();

    expect(r.success).toBe(true);
    expect(r.processed).toBe(1);
    expect(r.details).toMatchObject({ retentionDays: 90, deleted: 1 });
    expect(repo.list(db, { memory_id: 'mem_recent' })).toHaveLength(1);
    expect(repo.list(db, { memory_id: 'mem_old' })).toHaveLength(0);
  });
});

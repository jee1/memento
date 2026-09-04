import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ForgettingEventRepository } from '../repositories/forgetting-event-repository.js';
import { MemoryForgettingEventMigration } from '../../../infrastructure/database/sqlite/migration/migrations/037-memory-forgetting-event.js';
import { DAY_MS } from '../../../shared/utils/date.js';

describe('ForgettingEventRepository.deleteExpiredEvents', () => {
  let db: Database.Database;
  let repo: ForgettingEventRepository;

  beforeEach(async () => {
    db = new Database(':memory:');
    await new MemoryForgettingEventMigration().up(db);
    repo = new ForgettingEventRepository();
  });

  afterEach(() => {
    db.close();
  });

  it('retention 일보다 오래된 행만 삭제한다', () => {
    const cutoffBoundary = new Date(Date.now() - 90 * DAY_MS).toISOString();
    repo.insert(db, {
      memory_id: 'mem_expired',
      action: 'hard',
      reason: 'expired',
      policy: 'test',
      created_at: new Date(Date.now() - 91 * DAY_MS).toISOString(),
    });
    repo.insert(db, {
      memory_id: 'mem_kept',
      action: 'soft',
      reason: 'kept',
      policy: 'test',
      created_at: new Date(Date.now() - 89 * DAY_MS).toISOString(),
    });

    const deleted = repo.deleteExpiredEvents(db, 90);

    expect(deleted).toBe(1);
    expect(repo.list(db, { memory_id: 'mem_kept' })).toHaveLength(1);
    expect(repo.list(db, { memory_id: 'mem_expired' })).toHaveLength(0);

    const kept = repo.getById(db, repo.list(db)[0]!.id);
    expect(kept!.created_at >= cutoffBoundary || kept!.memory_id === 'mem_kept').toBe(true);
  });

  it('빈 테이블이면 0을 반환한다', () => {
    expect(repo.deleteExpiredEvents(db, 90)).toBe(0);
  });
});

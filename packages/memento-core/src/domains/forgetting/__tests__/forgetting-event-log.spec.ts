/**
 * Forgetting event audit log (Issue #669)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ForgettingPolicyService } from '../services/forgetting-policy-service.js';
import { MemoryForgettingEventMigration } from '../../../infrastructure/database/database/migration/migrations/037-memory-forgetting-event.js';
import {
  DEFAULT_FORGETTING_POLICY_NAME,
  ForgettingEventRepository,
} from '../repositories/forgetting-event-repository.js';
import {
  cleanupTestDatabase,
  createTestMemory,
  setupTestDatabase,
} from '../../../test/helpers/test-database.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';

describe('forgetting event log', () => {
  let db: Database.Database;
  let service: ForgettingPolicyService;
  let eventRepo: ForgettingEventRepository;

  beforeEach(async () => {
    db = await setupTestDatabase();
    await new MemoryForgettingEventMigration().up(db);
    service = new ForgettingPolicyService({
      softDeleteThreshold: 0.1,
      hardDeleteThreshold: 0.5,
      ttlSoft: { working: 1, episodic: 1, semantic: 999, procedural: 999 },
      ttlHard: { working: 1, episodic: 1, semantic: 999, procedural: 999 },
    });
    eventRepo = new ForgettingEventRepository();
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  it('persists structured rows via ForgettingEventRepository', () => {
    const row = eventRepo.insert(db, {
      memory_id: 'mem_test_event',
      action: 'soft',
      reason: '오래된 기억',
      policy: DEFAULT_FORGETTING_POLICY_NAME,
      forget_score: 0.72,
      ttl_days: 30,
      metadata_json: JSON.stringify({ source: 'test' }),
    });

    expect(row.id).toMatch(/^mfe_/);
    expect(row.action).toBe('soft');
    expect(eventRepo.list(db, { memory_id: 'mem_test_event' })).toHaveLength(1);
  });

  it('records soft and hard delete events during batch cleanup', async () => {
    const softId = createTestMemory(db, {
      content: 'Soft candidate',
      type: 'episodic',
      importance: 0.05,
    });
    const hardId = createTestMemory(db, {
      content: 'Hard candidate',
      type: 'episodic',
      importance: 0.01,
    });

    const oldSoft = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const oldHard = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    DatabaseUtils.run(db, 'UPDATE memory_item SET created_at = ? WHERE id = ?', [oldSoft, softId]);
    DatabaseUtils.run(db, 'UPDATE memory_item SET created_at = ? WHERE id = ?', [oldHard, hardId]);

    const analyzeSpy = vi.spyOn(service['forgettingAlgorithm'], 'analyzeForgetCandidates');
    analyzeSpy.mockReturnValue([
      {
        memory_id: softId,
        forget_score: 0.35,
        should_forget: true,
        reason: '오래된 기억',
        features: {
          recency: 0.1,
          usage: 0.1,
          duplication_ratio: 0,
          importance: 0.05,
          pinned: false,
        },
      },
      {
        memory_id: hardId,
        forget_score: 0.95,
        should_forget: true,
        reason: '사용되지 않음',
        features: {
          recency: 0.05,
          usage: 0.05,
          duplication_ratio: 0,
          importance: 0.01,
          pinned: false,
        },
      },
    ]);

    vi.spyOn(service['spacedRepetition'], 'createReviewSchedule').mockReturnValue({
      memory_id: softId,
      current_interval: 7,
      next_review: new Date(),
      recall_probability: 0.4,
      needs_review: false,
      multiplier: 1,
    });

    const insertSpy = vi.spyOn(ForgettingEventRepository.prototype, 'insert');

    const result = await service.executeMemoryCleanup(db);
    expect(result.summary.actualSoftDeletes).toBe(2);
    expect(result.summary.actualHardDeletes).toBe(1);

    expect(insertSpy).toHaveBeenCalled();
    const softEvents = eventRepo.list(db, { memory_id: softId, action: 'soft' });
    const hardEvents = eventRepo.list(db, { memory_id: hardId, action: 'hard' });
    expect(softEvents[0]?.policy).toBe(DEFAULT_FORGETTING_POLICY_NAME);
    expect(softEvents[0]?.ttl_days).toBe(1);
    expect(hardEvents[0]?.reason).toBe('사용되지 않음');
    expect(DatabaseUtils.get(db, 'SELECT id FROM memory_item WHERE id = ?', [hardId])).toBeUndefined();

    insertSpy.mockRestore();
    analyzeSpy.mockRestore();
  });
});

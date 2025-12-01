import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrationHistoryService } from '../migration-history-service.js';
import type { EmbeddingMigrationPlan, MigrationResult } from '../../shared/types/migration.types.js';

function createMigrationHistoryTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_provider_from TEXT NOT NULL,
      plan_provider_to TEXT NOT NULL,
      plan_target_dimensions INTEGER NOT NULL,
      plan_projection_type TEXT NOT NULL,
      plan_normalization TEXT NOT NULL,
      plan_batch_size INTEGER NOT NULL,
      plan_dry_run INTEGER NOT NULL DEFAULT 0,
      plan_resume_from_id TEXT,
      plan_target_model TEXT,
      plan_created_by TEXT,
      start_time TIMESTAMP NOT NULL,
      end_time TIMESTAMP NOT NULL,
      processed INTEGER NOT NULL,
      succeeded INTEGER NOT NULL,
      failed INTEGER NOT NULL,
      success INTEGER NOT NULL,
      next_resume_from_id TEXT,
      error_count INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT,
      rollback_entries_json TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

describe('migrationHistoryService', () => {
  let db: Database.Database;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = new Database(':memory:');
    createMigrationHistoryTable(db);
    consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    db.close();
  });

  function createPlan(overrides: Partial<EmbeddingMigrationPlan> = {}): EmbeddingMigrationPlan {
    return {
      sourceProvider: 'minilm',
      targetProvider: 'openai',
      targetDimensions: 1536,
      projectionType: 'zero_pad',
      normalization: 'none',
      batchSize: 10,
      dryRun: false,
      resumeFromId: undefined,
      autoRollbackOnFailure: true,
      ...overrides
    };
  }

  function createResult(overrides: Partial<MigrationResult> = {}): MigrationResult {
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + 1000);
    return {
      success: true,
      processed: 5,
      succeeded: 5,
      failed: 0,
      startTime,
      endTime,
      nextResumeFromId: undefined,
      errors: undefined,
      rollbackEntries: [],
      rolledBack: false,
      ...overrides
    };
  }

  it('records history and retrieves it with default listing', () => {
    const plan = createPlan();
    const result = createResult();
    const id = migrationHistoryService.recordHistory(db, plan, result);

    expect(id).toBeDefined();

    const records = migrationHistoryService.listHistory(db);
    expect(records).toHaveLength(1);

    const record = records[0];
    expect(record.result.success).toBe(true);
    expect(record.result.rolledBack).toBe(false);
    expect(record.plan.sourceProvider).toBe('minilm');
    expect(record.plan.targetProvider).toBe('openai');
  });

  it('filters history by success and rolledBack flags', () => {
    const successPlan = createPlan({ sourceProvider: 'minilm' });
    migrationHistoryService.recordHistory(db, successPlan, createResult());

    const failurePlan = createPlan({ sourceProvider: 'openai', targetProvider: 'gemini' });
    migrationHistoryService.recordHistory(
      db,
      failurePlan,
      createResult({
        success: false,
        failed: 3,
        succeeded: 2,
        errors: [{ memoryId: 'm1', provider: 'gemini', message: 'failed' }],
        rollbackEntries: [
          { memoryId: 'm1', provider: 'gemini', projectionType: 'zero_pad', operation: 'delete' }
        ],
        rolledBack: true
      })
    );

    const failed = migrationHistoryService.listHistory(db, { success: false });
    expect(failed).toHaveLength(1);
    expect(failed[0].result.rolledBack).toBe(true);

    const rolledBackOnly = migrationHistoryService.listHistory(db, { rolledBack: true });
    expect(rolledBackOnly).toHaveLength(1);
    expect(rolledBackOnly[0].plan.targetProvider).toBe('gemini');
  });

  it('provides summaries and detail lookup', () => {
    const plan = createPlan();
    const result = createResult({ success: false, failed: 1, succeeded: 4, rolledBack: true });
    const id = migrationHistoryService.recordHistory(db, plan, result)!;

    const summary = migrationHistoryService.getSummary(db);
    expect(summary.totalRuns).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.rolledBack).toBe(1);
    expect(summary.lastRunStatus).toBe('failure');

    const detail = migrationHistoryService.getHistoryById(db, id);
    expect(detail).toBeDefined();
    expect(detail?.result.failed).toBe(1);
    expect(detail?.result.rolledBack).toBe(true);
  });

  it('prunes history by age and keeps latest entries', () => {
    const plan = createPlan();
    const result = createResult();

    for (let i = 0; i < 3; i += 1) {
      migrationHistoryService.recordHistory(db, plan, result);
    }

    // 오래된 항목으로 표시
    db.prepare(`UPDATE migration_history SET created_at = DATETIME('now', '-10 day') WHERE id = 1`).run();

    const deletedByAge = migrationHistoryService.pruneHistory(db, { olderThanDays: 7 });
    expect(deletedByAge).toBeGreaterThanOrEqual(1);

    const deletedByKeep = migrationHistoryService.pruneHistory(db, { keepLatest: 1 });
    expect(deletedByKeep).toBeGreaterThanOrEqual(1);

    const remaining = migrationHistoryService.listHistory(db);
    expect(remaining.length).toBeLessThanOrEqual(1);
  });
});

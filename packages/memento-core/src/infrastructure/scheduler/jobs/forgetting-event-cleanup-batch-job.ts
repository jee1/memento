/**
 * memory_forgetting_event retention cleanup (Issue #810)
 */

import type Database from 'better-sqlite3';
import type { ForgettingEventRepository } from '../../../domains/forgetting/repositories/forgetting-event-repository.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import { resolveValidatedNumber } from '../../../shared/config/environment.js';
import { logger } from '../../../shared/utils/logger.js';

export interface ForgettingEventCleanupBatchJobDeps {
  db: Database.Database;
  repository: ForgettingEventRepository;
}

export class ForgettingEventCleanupBatchJob {
  constructor(private readonly deps: ForgettingEventCleanupBatchJobDeps) {}

  async execute(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'forgetting_event_cleanup_batch',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: [],
      details: undefined,
    };

    try {
      const retentionDays = resolveValidatedNumber(
        'FORGETTING_EVENT_RETENTION_DAYS',
        90,
        n => n >= 1,
        '최솟값 1',
      );
      const deleted = this.deps.repository.deleteExpiredEvents(this.deps.db, retentionDays);
      result.success = true;
      result.processed = deleted;
      result.details = { retentionDays, deleted };
      logger.info('forgetting_event_cleanup_batch completed', { retentionDays, deleted });
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
      logger.warn('forgetting_event_cleanup_batch failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - startTime.getTime();
    }

    return result;
  }
}

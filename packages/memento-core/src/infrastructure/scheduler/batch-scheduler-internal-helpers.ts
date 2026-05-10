/**
 * BatchScheduler helpers: empty job result shell, timing finalization, DB open assert.
 * Extracted to shrink class methods (Issue 315).
 */

import Database from 'better-sqlite3';
import type { BatchJobResult } from './batch-scheduler-types.js';
import { DatabaseUtils } from '../../shared/utils/database.js';

export function createEmptyBatchJobResult(jobType: string): BatchJobResult {
  const startTime = new Date();
  return {
    jobType,
    startTime,
    endTime: new Date(),
    duration: 0,
    success: false,
    processed: 0,
    errors: [],
    warnings: []
  };
}

export function finalizeBatchJobTiming(result: BatchJobResult): void {
  result.endTime = new Date();
  result.duration = result.endTime.getTime() - result.startTime.getTime();
}

export function assertSchedulerDbOpen(db: Database.Database | null): asserts db is Database.Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  if (!DatabaseUtils.isOpen(db)) {
    throw new Error('Database connection is not open. The database may have been closed.');
  }
}

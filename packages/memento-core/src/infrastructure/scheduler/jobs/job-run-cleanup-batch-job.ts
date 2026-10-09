/**
 * job_run retention cleanup (Issue #833)
 */

import type Database from 'better-sqlite3';
import type { JobRunRepository } from '../repositories/job-run-repository.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import { resolveValidatedNumber } from '../../../shared/config/environment.js';
import { logger } from '../../../shared/utils/logger.js';

/**
 * Issue #1199: successful runs kept per job. 3000 covers more than 24 h of a 30 s heartbeat.
 */
export const JOB_RUN_SUCCESS_KEEP_PER_JOB = 3000;

interface JobRunCleanupBatchJobDeps {
  db: Database.Database;
  repository: JobRunRepository;
}

export class JobRunCleanupBatchJob {
  constructor(private readonly deps: JobRunCleanupBatchJobDeps) {}

  async execute(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'job_run_cleanup_batch',
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
        'JOB_RUN_RETENTION_DAYS',
        90,
        n => n >= 1,
        '최솟값 1',
      );
      const expired = this.deps.repository.deleteExpired(this.deps.db, retentionDays);
      const excessSuccess = this.deps.repository.deleteExcessSuccessRuns(
        this.deps.db,
        JOB_RUN_SUCCESS_KEEP_PER_JOB,
      );
      const deleted = expired + excessSuccess;
      const details = {
        retentionDays,
        successKeepPerJob: JOB_RUN_SUCCESS_KEEP_PER_JOB,
        expired,
        excessSuccess,
        deleted,
      };
      result.success = true;
      result.processed = deleted;
      result.details = details;
      logger.info('job_run_cleanup_batch completed', details);
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
      logger.warn('job_run_cleanup_batch failed', {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - startTime.getTime();
    }

    return result;
  }
}

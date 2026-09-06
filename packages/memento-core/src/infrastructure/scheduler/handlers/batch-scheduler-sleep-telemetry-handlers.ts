import { SleepConsolidationBatchJob } from '../jobs/sleep-consolidation-batch-job.js';
import { TelemetryCleanupBatchJob } from '../jobs/telemetry-cleanup-batch-job.js';
import { ForgettingEventCleanupBatchJob } from '../jobs/forgetting-event-cleanup-batch-job.js';
import { ForgettingEventRepository } from '../../../domains/forgetting/repositories/forgetting-event-repository.js';
import { JobRunCleanupBatchJob } from '../jobs/job-run-cleanup-batch-job.js';
import { JobRunRepository } from '../repositories/job-run-repository.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

export async function runTelemetryCleanupBatch(ctx: BatchSchedulerRunContext): Promise<void> {
  if (!ctx.telemetryCleanupRepository) {
    return;
  }
  if (!ctx.telemetryCleanupBatchJob.current) {
    ctx.telemetryCleanupBatchJob.current = new TelemetryCleanupBatchJob({
      repository: ctx.telemetryCleanupRepository
    });
  }
  await ctx.telemetryCleanupBatchJob.current.execute();
}

export async function runForgettingEventCleanupBatch(ctx: BatchSchedulerRunContext): Promise<void> {
  if (!ctx.db) {
    return;
  }
  if (!ctx.forgettingEventCleanupBatchJob.current) {
    ctx.forgettingEventCleanupBatchJob.current = new ForgettingEventCleanupBatchJob({
      db: ctx.db,
      repository: new ForgettingEventRepository(),
    });
  }
  await ctx.forgettingEventCleanupBatchJob.current.execute();
}

export async function runJobRunCleanupBatch(ctx: BatchSchedulerRunContext): Promise<void> {
  if (!ctx.db) {
    return;
  }
  if (!ctx.jobRunCleanupBatchJob.current) {
    ctx.jobRunCleanupBatchJob.current = new JobRunCleanupBatchJob({
      db: ctx.db,
      repository: new JobRunRepository(),
    });
  }
  await ctx.jobRunCleanupBatchJob.current.execute();
}

export async function runSleepConsolidationBatch(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  try {
    if (!ctx.sleepConsolidationService) {
      throw new Error('SleepConsolidationService not configured');
    }
    if (!ctx.sleepConsolidationBatchJob.current) {
      ctx.sleepConsolidationBatchJob.current = new SleepConsolidationBatchJob({
        sleepConsolidationService: ctx.sleepConsolidationService,
        fileLogger: ctx.fileLogger
      });
    }
    const batchResult = await ctx.sleepConsolidationBatchJob.current.execute();

    ctx.lastExecution.set('sleep_consolidation_batch', new Date());
    ctx.totalExecutions.set(
      'sleep_consolidation_batch',
      (ctx.totalExecutions.get('sleep_consolidation_batch') || 0) + 1
    );

    return batchResult;
  } catch (error) {
    const startTime = new Date();
    const endTime = new Date();
    const message = error instanceof Error ? error.message : String(error);
    ctx.log('Sleep consolidation batch failed', { error: message }, 'error');
    return {
      jobType: 'sleep_consolidation_batch',
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      success: false,
      processed: 0,
      errors: [message],
      warnings: []
    };
  }
}

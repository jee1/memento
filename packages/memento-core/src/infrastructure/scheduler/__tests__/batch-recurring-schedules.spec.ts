import { describe, expect, it, vi } from 'vitest';
import type { BatchJobConfig, BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import type { BatchRecurringScheduleContext } from '../batch-scheduler/batch-recurring-schedules.js';
import { scheduleCleanupJob, scheduleEmbeddingReconciliation, scheduleSleepConsolidation } from '../batch-scheduler/batch-recurring-schedules.js';

function createFakeContext(
  overrides: Partial<BatchRecurringScheduleContext> = {}
): { ctx: BatchRecurringScheduleContext; cleanupJob: () => Promise<unknown> } {
  let cleanupJob!: () => Promise<unknown>;
  const config: BatchJobConfig = {
    cleanupInterval: 60_000,
    walCheckpointInterval: 60_000,
    lockMonitorInterval: 60_000,
    reflexionCleanupInterval: 60_000,
    reflexionHealthCheckInterval: 30_000,
    monitoringInterval: 10_000,
    healthCheckInterval: 10_000,
    logRotationInterval: 86_400_000,
    qualityMeasurementInterval: 86_400_000,
    metaMemoryIntrospectionInterval: 21_600_000,
    sleepConsolidationInterval: 3_600_000,
    telemetryCleanupInterval: 86_400_000,
    forgettingEventCleanupInterval: 86_400_000,
    memoryReviewCandidatesInterval: 86_400_000,
    memoryReviewCandidatesSchedulerEnabled: true,
    anchorAutoRefreshInterval: 21_600_000,
    anchorAutoRefreshEnabled: true,
    embeddingReconciliationInterval: 86_400_000,
    maxBatchSize: 1000,
    enableLogging: true,
    enableNotifications: false,
    enableMetrics: true,
    maxConcurrentJobs: 3,
    jobTimeout: 100,
    retryAttempts: 3,
    retryDelay: 10,
  };

  const ctx: BatchRecurringScheduleContext = {
    config,
    hasSleepConsolidation: false,
    hasTelemetryCleanup: false,
    hasForgettingEventCleanup: false,
    hasJobRunCleanup: false,
    hasAnchorManager: false,
    scheduleJob: (name, _interval, job, _priority) => {
      if (name === 'cleanup') {
        cleanupJob = job;
      }
    },
    lastExecution: new Map(),
    intervals: new Map(),
    jobExecutionCoordinator: {
      addJobToQueue: vi.fn(),
    } as unknown as BatchRecurringScheduleContext['jobExecutionCoordinator'],
    log: vi.fn(),
    runMemoryCleanup: vi.fn().mockResolvedValue({ success: true, processed: 0, errors: [], warnings: [] }),
    runMonitoring: vi.fn(),
    runHealthCheck: vi.fn(),
    runLogRotation: vi.fn(),
    runQualityMeasurementBatch: vi.fn(),
    runMetaMemoryIntrospection: vi.fn(),
    runMemoryReviewCandidatesJob: vi.fn(),
    runSleepConsolidationBatch: vi.fn(),
    runTelemetryCleanupBatch: vi.fn(),
    runForgettingEventCleanupBatch: vi.fn(),
    runJobRunCleanupBatch: vi.fn(),
    runAnchorAutoRefresh: vi.fn(),
    runEmbeddingReconciliation: vi.fn(),
    ...overrides,
  };

  return { ctx, cleanupJob: () => cleanupJob() };
}

describe('batch-recurring-schedules wrappers (#1264)', () => {
  it('cleanup wrapper returns what runMemoryCleanup resolves', async () => {
    const failedResult: BatchJobResult = { success: false, processed: 0, errors: ['cleanup failed'], warnings: [] };
    const runMemoryCleanup = vi.fn().mockResolvedValue(failedResult);
    const { ctx, cleanupJob } = createFakeContext({ runMemoryCleanup });

    scheduleCleanupJob(ctx);

    await expect(cleanupJob()).resolves.toEqual(failedResult);
    expect(runMemoryCleanup).toHaveBeenCalledOnce();
  });

  it('registers embedding reconciliation on its configured recurring interval', async () => {
    const scheduleJob = vi.fn();
    const runEmbeddingReconciliation = vi.fn().mockResolvedValue({ success: true });
    const { ctx } = createFakeContext({ scheduleJob, runEmbeddingReconciliation });

    scheduleEmbeddingReconciliation(ctx);

    expect(scheduleJob).toHaveBeenCalledWith(
      'embedding_reconciliation',
      ctx.config.embeddingReconciliationInterval,
      expect.any(Function),
      8
    );
    const job = scheduleJob.mock.calls[0]?.[2] as () => Promise<unknown>;
    await job();
    expect(runEmbeddingReconciliation).toHaveBeenCalledOnce();
  });

  it('sleep consolidation wrapper returns batch result to coordinator (#1559)', async () => {
    const batchResult: BatchJobResult = {
      jobType: 'sleep_consolidation_batch',
      startTime: new Date(),
      endTime: new Date(),
      duration: 1,
      success: true,
      processed: 2,
      errors: [],
      warnings: [],
      details: { clustersProcessed: 2 },
    };
    let scheduledJob!: () => Promise<unknown>;
    const scheduleJob = vi.fn((_name, _interval, job) => {
      scheduledJob = job;
    });
    const runSleepConsolidationBatch = vi.fn().mockResolvedValue(batchResult);
    const { ctx } = createFakeContext({ scheduleJob, runSleepConsolidationBatch });

    scheduleSleepConsolidation(ctx);

    await expect(scheduledJob()).resolves.toEqual(batchResult);
    expect(runSleepConsolidationBatch).toHaveBeenCalledOnce();
  });
});

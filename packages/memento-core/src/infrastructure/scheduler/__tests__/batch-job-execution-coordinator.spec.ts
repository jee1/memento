import { describe, expect, it, vi } from 'vitest';
import { BatchJobExecutionCoordinator } from '../batch-scheduler/batch-job-execution-coordinator.js';
import type { BatchJobConfig } from '../batch-scheduler/batch-scheduler-types.js';
import { JobQueue } from '../job-queue.js';
import { RetryManager } from '../retry-manager.js';

function createCoordinator(config: Partial<BatchJobConfig>, log = vi.fn()) {
  const jobQueue = new JobQueue(10);
  const retryManager = new RetryManager({ maxAttempts: 3, baseDelay: 10, maxErrorCount: 10 });
  const mergedConfig: BatchJobConfig = {
    cleanupInterval: 60_000,
    monitoringInterval: 10_000,
    healthCheckInterval: 10_000,
    consolidationScoreIncrementalInterval: 60_000,
    consolidationScoreFullSweepInterval: 86_400_000,
    consolidationScoreFullSweepHour: 3,
    relationValidationInterval: 604_800_000,
    relationValidationDayOfWeek: 0,
    relationValidationHour: 2,
    logRotationInterval: 86_400_000,
    tripleExtractionInterval: 3_600_000,
    tripleExtractionBatchSize: 10,
    tripleExtractionTimeout: 30_000,
    qualityMeasurementInterval: 86_400_000,
    metaMemoryIntrospectionInterval: 21_600_000,
    sleepConsolidationInterval: 3_600_000,
    telemetryCleanupInterval: 86_400_000,
    memoryReviewCandidatesInterval: 86_400_000,
    memoryReviewCandidatesSchedulerEnabled: true,
    maxBatchSize: 1000,
    enableLogging: true,
    enableNotifications: false,
    enableMetrics: true,
    maxConcurrentJobs: 3,
    jobTimeout: 100,
    retryAttempts: 3,
    retryDelay: 10,
    tripleExtractionJobTimeout: 500,
    ...config,
  };

  const coordinator = new BatchJobExecutionCoordinator({
    jobQueue,
    retryManager,
    getConfig: () => mergedConfig,
    getIsRunning: () => true,
    lastExecution: new Map(),
    totalExecutions: new Map(),
    lastJobRunMeta: new Map(),
    writeDiagnosticsEvent: vi.fn().mockResolvedValue(undefined),
    log,
    checkSchedulerHealth: vi.fn().mockResolvedValue(undefined),
  });

  return { coordinator, jobQueue, log };
}

describe('BatchJobExecutionCoordinator timeout policy', () => {
  it('allows triple_extraction_* jobs to use the longer dedicated timeout', async () => {
    const { coordinator, log } = createCoordinator({});

    await coordinator.executeJobWithRetry(
      'triple_extraction_mem_test',
      async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      },
      5,
      0
    );

    expect(log).toHaveBeenCalledWith(
      'Job triple_extraction_mem_test completed successfully',
      expect.objectContaining({ retryCount: 0 })
    );
  });

  it('logs warn and skips retry when triple_extraction_* job times out', async () => {
    const { coordinator, log, jobQueue } = createCoordinator({});

    await coordinator.executeJobWithRetry(
      'triple_extraction_mem_slow',
      async () => {
        await new Promise(resolve => setTimeout(resolve, 700));
      },
      5,
      0
    );

    expect(log).toHaveBeenCalledWith(
      'Job triple_extraction_mem_slow timed out',
      expect.objectContaining({ error: 'Job timeout after 500ms' }),
      'warn'
    );
    expect(log).toHaveBeenCalledWith(
      'Skipping immediate retry for triple_extraction_mem_slow; batch triple extraction will handle backlog',
      expect.objectContaining({ jobName: 'triple_extraction_mem_slow' }),
      'warn'
    );
    expect(jobQueue.isEmpty).toBe(true);
  });

  it('still errors and schedules retry for generic jobs on timeout', async () => {
    vi.useFakeTimers();
    const { coordinator, log } = createCoordinator({});
    const addSpy = vi.spyOn(coordinator, 'addJobToQueue');

    const runPromise = coordinator.executeJobWithRetry(
      'custom_slow_job',
      async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
      },
      5,
      0
    );

    await vi.advanceTimersByTimeAsync(200);
    await runPromise;

    expect(log).toHaveBeenCalledWith(
      'Job custom_slow_job failed',
      expect.objectContaining({ error: 'Job timeout after 100ms' }),
      'error'
    );

    await vi.advanceTimersByTimeAsync(20);
    expect(addSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SleepConsolidationBatchJob } from './sleep-consolidation-batch-job.js';
import type { SleepConsolidationService } from '../../../domains/consolidation/services/sleep-consolidation-service.js';
import { FileLogger } from '../file-logger.js';
import { jobRunSummaryFieldsFromBatchJobResult } from '../batch-scheduler/batch-job-result-job-run-summary.js';

describe('SleepConsolidationBatchJob', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes SleepConsolidationService.run and logs via FileLogger', async () => {
    const run = vi.fn().mockResolvedValue({
      runAt: 't',
      durationMs: 1,
      clustersFound: 2,
      clustersProcessed: 2,
      clustersSkipped: 0,
      semanticsCreated: 2,
      episodicsConsolidated: 8,
      errors: []
    });
    const svc = { run } as unknown as SleepConsolidationService;
    const logSpy = vi.spyOn(FileLogger.prototype, 'log').mockResolvedValue();

    const job = new SleepConsolidationBatchJob({
      sleepConsolidationService: svc,
      fileLogger: new FileLogger({ enabled: true })
    });
    const result = await job.execute();
    expect(run).toHaveBeenCalledWith({});
    expect(result.success).toBe(true);
    expect(result.processed).toBe(2);
    expect(logSpy).toHaveBeenCalled();
  });

  it('surfaces quota deferrals as deferred_count on job_run without bumping error_count (#1652)', async () => {
    const run = vi.fn().mockResolvedValue({
      runAt: 't',
      durationMs: 12,
      clustersFound: 3,
      clustersProcessed: 1,
      clustersSkipped: 2,
      semanticsCreated: 1,
      semanticsMerged: 0,
      episodicsConsolidated: 4,
      stoppedDueToQuota: true,
      errors: [
        { clusterId: 'cluster-a', error: 'deferred:quota_exceeded' },
        { clusterId: 'cluster-b', error: 'deferred:run_stopped_after_quota' },
      ],
    });
    const job = new SleepConsolidationBatchJob({
      sleepConsolidationService: { run } as unknown as SleepConsolidationService,
    });

    const result = await job.execute();
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);

    const summary = jobRunSummaryFieldsFromBatchJobResult(result);
    expect(summary.error_count).toBe(0);
    const details = JSON.parse(summary.details_json!) as {
      deferred_count: number;
      errors: Array<{ error: string }>;
    };
    expect(details.deferred_count).toBe(2);
    expect(details.errors).toHaveLength(2);
  });

  it('counts hard cluster failures in error_count, not deferred_count (#1652)', async () => {
    const run = vi.fn().mockResolvedValue({
      runAt: 't',
      durationMs: 5,
      clustersFound: 2,
      clustersProcessed: 0,
      clustersSkipped: 2,
      semanticsCreated: 0,
      semanticsMerged: 0,
      episodicsConsolidated: 0,
      errors: [
        { clusterId: 'cluster-a', error: 'deferred:quota_exceeded' },
        { clusterId: 'cluster-b', error: 'boom' },
      ],
    });
    const job = new SleepConsolidationBatchJob({
      sleepConsolidationService: { run } as unknown as SleepConsolidationService,
    });

    const result = await job.execute();
    expect(result.success).toBe(true);
    expect(result.errors).toEqual(['cluster-b: boom']);

    const summary = jobRunSummaryFieldsFromBatchJobResult(result);
    expect(summary.error_count).toBe(1);
    const details = JSON.parse(summary.details_json!) as { deferred_count: number };
    expect(details.deferred_count).toBe(1);
  });
});

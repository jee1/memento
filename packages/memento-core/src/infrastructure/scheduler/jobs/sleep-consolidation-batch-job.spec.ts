import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SleepConsolidationBatchJob } from './sleep-consolidation-batch-job.js';
import type { SleepConsolidationService } from '../../../domains/consolidation/services/sleep-consolidation-service.js';
import { FileLogger } from '../file-logger.js';

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
});

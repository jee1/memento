/**
 * Sleep consolidation 배치 — 오프라인 에피소딕→시맨틱 증류
 */

import type { SleepConsolidationService } from '../../../domains/consolidation/services/sleep-consolidation-service.js';
import type { BatchJobResult } from '../batch-scheduler/batch-scheduler-types.js';
import { FileLogger } from '../file-logger.js';

interface SleepConsolidationBatchJobDeps {
  sleepConsolidationService: SleepConsolidationService;
  fileLogger?: FileLogger;
}

export class SleepConsolidationBatchJob {
  constructor(private readonly deps: SleepConsolidationBatchJobDeps) {}

  async execute(): Promise<BatchJobResult> {
    const startTime = new Date();
    const result: BatchJobResult = {
      jobType: 'sleep_consolidation_batch',
      startTime,
      endTime: new Date(),
      duration: 0,
      success: false,
      processed: 0,
      errors: [],
      warnings: [],
      details: undefined
    };

    try {
      const runResult = await this.deps.sleepConsolidationService.run({});
      const deferredErrors = runResult.errors.filter(e => e.error.startsWith('deferred:'));
      const hardErrors = runResult.errors.filter(e => !e.error.startsWith('deferred:'));
      result.success = true;
      result.processed = runResult.clustersProcessed;
      // Quota deferrals stay out of BatchJobResult.errors so job_run.error_count
      // counts exceptions only; deferred_count rides details_json via #1559 mapping (#1652).
      result.errors = hardErrors.map(e => `${e.clusterId}: ${e.error}`);
      result.details = {
        ...runResult,
        deferred_count: deferredErrors.length,
      };

      const fl = this.deps.fileLogger;
      if (fl) {
        await fl.log({
          timestamp: new Date(),
          service: 'SleepConsolidationBatchJob',
          level: 'info',
          message: 'sleep_consolidation_batch completed',
          data: {
            clustersFound: runResult.clustersFound,
            clustersProcessed: runResult.clustersProcessed,
            clustersSkipped: runResult.clustersSkipped,
            semanticsCreated: runResult.semanticsCreated,
            episodicsConsolidated: runResult.episodicsConsolidated,
            durationMs: runResult.durationMs,
            errorCount: runResult.errors.length
          }
        });
      }
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e));
      const fl = this.deps.fileLogger;
      if (fl) {
        await fl.logError('sleep_consolidation_batch failed', {
          error: e instanceof Error ? e.message : String(e)
        });
      }
    } finally {
      result.endTime = new Date();
      result.duration = result.endTime.getTime() - result.startTime.getTime();
    }

    return result;
  }
}

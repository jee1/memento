import { BatchScheduler } from '../batch-scheduler.js';
import type { BatchJobConfig } from '../batch-scheduler-types.js';

let schedulerInstance: BatchScheduler | null = null;

export function getBatchScheduler(): BatchScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new BatchScheduler();
  }
  return schedulerInstance;
}

export function createBatchScheduler(config?: Partial<BatchJobConfig>): BatchScheduler {
  return new BatchScheduler(config);
}

export function resetBatchScheduler(): void {
  schedulerInstance = null;
}

/**
 * Re-export singleton helpers from the orchestrator.
 * Implementation lives in `batch-scheduler.ts` to avoid a runtime cycle
 * (singleton → BatchScheduler class ← re-export singleton).
 */
export {
  getBatchScheduler,
  createBatchScheduler,
  resetBatchScheduler,
} from './batch-scheduler.js';

import type { BatchJobConfig, SchedulerStatus } from './batch-scheduler-types.js';
import { validateBatchJobConfig } from './batch-scheduler-validate-config.js';
import type { JobQueue } from '../job-queue.js';
import type { RetryManager } from '../retry-manager.js';
import type { HealthChecker } from '../health-checker.js';
import type Database from 'better-sqlite3';
import type { BatchSchedulerLogMethod } from '../handlers/batch-scheduler-run-context.js';
import { getBatchSchedulerDetailedStats } from './batch-scheduler-stats.js';
import { checkBatchSchedulerHealth } from './batch-scheduler-health.js';

export interface BatchSchedulerStatusState {
  isRunning: boolean;
  intervals: Map<string, ReturnType<typeof setInterval>>;
  lastExecution: Map<string, Date>;
  totalExecutions: Map<string, number>;
  startTime: Date | null;
  config: BatchJobConfig;
  /** Issue #834 */
  pausedJobs?: Set<string>;
}

export function getBatchSchedulerStatus(
  state: BatchSchedulerStatusState,
  retryManager: RetryManager
): SchedulerStatus {
  const errorCountMap = new Map<string, number>();
  for (const jobName of state.intervals.keys()) {
    const errorCount = retryManager.getErrorCount(jobName);
    if (errorCount > 0) {
      errorCountMap.set(jobName, errorCount);
    }
  }

  return {
    isRunning: state.isRunning,
    activeJobs: Array.from(state.intervals.keys()),
    lastExecution: new Map(state.lastExecution),
    totalExecutions: new Map(state.totalExecutions),
    errorCount: errorCountMap,
    uptime: state.startTime ? Date.now() - state.startTime.getTime() : 0,
    config: { ...state.config }
  };
}

export function updateBatchSchedulerConfig(
  config: BatchJobConfig,
  newConfig: Partial<BatchJobConfig>,
  log: BatchSchedulerLogMethod
): BatchJobConfig {
  const updated = { ...config, ...newConfig };
  validateBatchJobConfig(updated);
  log('Configuration updated', { config: updated });
  return updated;
}

export function getBatchSchedulerDetailedStatsReport(
  state: BatchSchedulerStatusState,
  retryManager: RetryManager,
  jobQueue: JobQueue
) {
  return getBatchSchedulerDetailedStats({
    getStatus: () => getBatchSchedulerStatus(state, retryManager),
    intervals: state.intervals,
    lastExecution: state.lastExecution,
    totalExecutions: state.totalExecutions,
    retryManager,
    jobQueue,
    startTime: state.startTime,
    pausedJobs: state.pausedJobs,
  });
}

export function getBatchSchedulerLastJobRunMeta(
  lastJobRunMeta: Map<string, { at: Date; success: boolean; durationMs: number }>,
  name: string
): { at: Date; success: boolean; durationMs: number } | undefined {
  return lastJobRunMeta.get(name);
}

export async function checkBatchSchedulerSchedulerHealth(
  db: Database.Database | null,
  healthChecker: HealthChecker,
  jobQueue: JobQueue,
  maxConcurrentJobs: number,
  log: BatchSchedulerLogMethod
): Promise<void> {
  await checkBatchSchedulerHealth({
    db,
    healthChecker,
    jobQueue,
    maxConcurrentJobs,
    log
  });
}

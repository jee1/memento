import type { SchedulerStatus } from './batch-scheduler-types.js';
import type { JobQueue } from '../job-queue.js';
import type { RetryManager } from '../retry-manager.js';

export interface BatchSchedulerStatsDeps {
  getStatus: () => SchedulerStatus;
  intervals: Map<string, ReturnType<typeof setInterval>>;
  lastExecution: Map<string, Date>;
  totalExecutions: Map<string, number>;
  retryManager: RetryManager;
  jobQueue: JobQueue;
  startTime: Date | null;
  /** Issue #834: paused schedule jobs (interval cleared but still listed in stats). */
  pausedJobs?: Set<string>;
}

/**
 * 스케줄러 통계 조회
 */
export function getBatchSchedulerDetailedStats(deps: BatchSchedulerStatsDeps): {
  status: SchedulerStatus;
  health: {
    memoryUsage: number;
    runningJobs: number;
    queueSize: number;
    errorRate: number;
    uptime: number;
  };
  jobs: Array<{
    name: string;
    lastExecution: Date | null;
    totalExecutions: number;
    errorCount: number;
    errorRate: number;
    isRunning: boolean;
    paused: boolean;
  }>;
} {
  const memUsage = process.memoryUsage();
  const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  const totalExecutions = Array.from(deps.totalExecutions.values()).reduce((sum, count) => sum + count, 0);
  const jobNames = new Set<string>([
    ...deps.intervals.keys(),
    ...(deps.pausedJobs ?? []),
  ]);
  const totalErrors = Array.from(jobNames).reduce((sum, name) => {
    return sum + deps.retryManager.getErrorCount(name);
  }, 0);
  const errorRate = totalExecutions > 0 ? totalErrors / totalExecutions : 0;

  const jobs = Array.from(jobNames).map(name => ({
    name,
    lastExecution: deps.lastExecution.get(name) || null,
    totalExecutions: deps.totalExecutions.get(name) || 0,
    errorCount: deps.retryManager.getErrorCount(name),
    errorRate: (deps.totalExecutions.get(name) || 0) > 0
      ? deps.retryManager.getErrorCount(name) / (deps.totalExecutions.get(name) || 1)
      : 0,
    isRunning: deps.jobQueue.isRunning(name),
    paused: deps.pausedJobs?.has(name) ?? false,
  }));

  return {
    status: deps.getStatus(),
    health: {
      memoryUsage: memUsagePercent,
      runningJobs: deps.jobQueue.runningCount,
      queueSize: deps.jobQueue.size,
      errorRate,
      uptime: deps.startTime ? Date.now() - deps.startTime.getTime() : 0
    },
    jobs
  };
}

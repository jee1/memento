import type Database from 'better-sqlite3';
import type { IReflexionWorker } from '../../../shared/interfaces/reflexion-worker.interface.js';
import { validateBatchJobConfig } from './batch-scheduler-validate-config.js';
import type { BatchJobConfig } from './batch-scheduler-types.js';
import type { HealthChecker } from '../health-checker.js';
import type { JobQueue } from '../job-queue.js';
import type { PerformanceMonitor } from '../../../domains/monitoring/services/performance-monitor.js';
import { registerAllRecurringJobs } from './batch-recurring-schedules.js';
import type { BatchSchedulerLogMethod } from '../handlers/batch-scheduler-run-context.js';
import type { BatchSchedulerRecurringContextSource } from './batch-scheduler-context.js';
import { buildBatchRecurringScheduleContext } from './batch-scheduler-context.js';

export interface BatchSchedulerStartDeps {
  config: BatchJobConfig;
  jobQueue: JobQueue;
  healthChecker: HealthChecker;
  performanceMonitor: PerformanceMonitor;
  log: BatchSchedulerLogMethod;
  writeDiagnosticsEvent: (event: Record<string, unknown>) => Promise<void>;
  getRecurringContextSource: () => BatchSchedulerRecurringContextSource;
  startJobProcessor: () => void;
  setState: (state: {
    db: Database.Database;
    isRunning: boolean;
    startTime: Date;
    reflexionWorker?: IReflexionWorker;
  }) => void;
}

export async function startBatchScheduler(
  deps: BatchSchedulerStartDeps,
  db: Database.Database,
  reflexionWorker?: IReflexionWorker,
  registerBatchJobs = true
): Promise<void> {
  validateBatchJobConfig(deps.config);
  const startTime = new Date();

  if (deps.jobQueue.size > 0) {
    deps.log(`Clearing ${deps.jobQueue.size} leftover jobs from previous session`, {
      leftoverJobs: deps.jobQueue.size
    });
    deps.jobQueue.clear();
  }

  deps.setState({ db, isRunning: true, startTime, reflexionWorker });
  deps.healthChecker.setStartTime(startTime);
  deps.performanceMonitor.initialize(db);

  if (reflexionWorker) {
    deps.log('Reflexion Worker 통합됨', {
      worker_running: reflexionWorker.getStatus().isRunning
    });
  }

  if (registerBatchJobs) {
    registerAllRecurringJobs(buildBatchRecurringScheduleContext(deps.getRecurringContextSource()));
  }
  deps.startJobProcessor();

  deps.log('BatchScheduler started', {
    config: deps.config,
    startTime: startTime.toISOString()
  });
  await deps.writeDiagnosticsEvent({
    type: 'batch_scheduler_start',
    config: deps.config,
    startTime: startTime.toISOString()
  });
}

export interface BatchSchedulerStopDeps {
  intervals: Map<string, ReturnType<typeof setInterval>>;
  jobQueue: JobQueue;
  startTime: Date | null;
  log: BatchSchedulerLogMethod;
  writeDiagnosticsEvent: (event: Record<string, unknown>) => Promise<void>;
  waitForRunningJobs: () => Promise<void>;
  clearJobProcessorInterval: () => void;
  setIsRunning: (isRunning: boolean) => void;
}

export async function stopBatchScheduler(deps: BatchSchedulerStopDeps): Promise<void> {
  deps.log('Stopping BatchScheduler...');
  deps.setIsRunning(false);

  for (const [name, interval] of deps.intervals) {
    clearInterval(interval);
    deps.log(`Stopped job: ${name}`);
  }
  deps.intervals.clear();
  deps.clearJobProcessorInterval();

  await deps.waitForRunningJobs();

  const queuedJobsCount = deps.jobQueue.size;
  if (queuedJobsCount > 0) {
    deps.log(`Clearing ${queuedJobsCount} queued jobs to prevent unintended execution on restart`, {
      queuedJobs: queuedJobsCount
    });
    deps.jobQueue.clear();
  }

  deps.log('BatchScheduler stopped', {
    uptime: deps.startTime ? Date.now() - deps.startTime.getTime() : 0,
    clearedQueuedJobs: queuedJobsCount
  });
  await deps.writeDiagnosticsEvent({
    type: 'batch_scheduler_stop',
    uptime: deps.startTime ? Date.now() - deps.startTime.getTime() : 0,
    clearedQueuedJobs: queuedJobsCount
  });
}

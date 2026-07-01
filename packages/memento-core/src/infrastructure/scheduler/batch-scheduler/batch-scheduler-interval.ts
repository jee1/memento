import type { BatchJobExecutionCoordinator } from '../batch-job-execution-coordinator.js';
import type { JobQueue } from '../job-queue.js';
import type { BatchSchedulerLogMethod } from '../handlers/batch-scheduler-run-context.js';

export interface BatchSchedulerIntervalDeps {
  jobExecutionCoordinator: BatchJobExecutionCoordinator;
  intervals: Map<string, ReturnType<typeof setInterval>>;
  jobQueue: JobQueue;
  log: BatchSchedulerLogMethod;
}

/**
 * 작업 스케줄링
 * 시작 시 maxConcurrentJobs를 보장하기 위해 무조건 큐를 통해 실행
 */
export function scheduleBatchJob(
  deps: BatchSchedulerIntervalDeps,
  name: string,
  interval: number,
  job: () => Promise<void>,
  priority: number
): void {
  const wrappedJob = async () => {
    deps.jobExecutionCoordinator.addJobToQueue(name, job, priority, 0);
  };

  deps.jobExecutionCoordinator.addJobToQueue(name, job, priority, 0);

  const intervalId = setInterval(wrappedJob, interval);
  deps.intervals.set(name, intervalId);
}

/**
 * 실행 중인 작업 완료 대기
 */
export async function waitForRunningBatchJobs(deps: BatchSchedulerIntervalDeps): Promise<void> {
  const maxWaitTime = 30000;
  const startTime = Date.now();

  while (deps.jobQueue.runningCount > 0 && (Date.now() - startTime) < maxWaitTime) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (deps.jobQueue.runningCount > 0) {
    deps.log(`Warning: ${deps.jobQueue.runningCount} jobs still running after timeout`, { level: 'warn' });
  }
}

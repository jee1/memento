import type Database from 'better-sqlite3';
import type { HealthChecker } from '../health-checker.js';
import type { JobQueue } from '../job-queue.js';
import type { BatchSchedulerLogMethod } from '../handlers/batch-scheduler-run-context.js';

export interface BatchSchedulerHealthDeps {
  db: Database.Database | null;
  healthChecker: HealthChecker;
  jobQueue: JobQueue;
  maxConcurrentJobs: number;
  log: BatchSchedulerLogMethod;
}

/**
 * 스케줄러 헬스체크
 */
export async function checkBatchSchedulerHealth(deps: BatchSchedulerHealthDeps): Promise<void> {
  try {
    deps.log('Performing scheduler health check...');

    const healthResult = await deps.healthChecker.check(
      deps.db,
      deps.jobQueue.runningCount,
      deps.jobQueue.size,
      deps.maxConcurrentJobs
    );

    if (healthResult.warnings.length > 0) {
      healthResult.warnings.forEach(warning => {
        deps.log(warning, { level: 'warn' });
      });
    }

    if (healthResult.memoryUsage > 90) {
      if (deps.healthChecker.triggerGarbageCollection()) {
        deps.log('Garbage collection triggered');
      }
    }

    deps.log('Scheduler health check completed', {
      memoryUsage: healthResult.memoryUsage,
      runningJobs: healthResult.runningJobs,
      queueSize: healthResult.queueSize,
      uptime: healthResult.uptime,
      warnings: healthResult.warnings.length,
      errors: healthResult.errors.length
    });

  } catch (error) {
    deps.log('Scheduler health check failed', { error: error instanceof Error ? error.message : String(error) }, 'error');
  }
}

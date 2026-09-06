import type Database from 'better-sqlite3';
import type { BatchJobConfig } from './batch-scheduler-types.js';
import { JobQueue } from '../job-queue.js';
import { RetryManager } from '../retry-manager.js';
import { resolveValidatedNumber } from '../../../shared/config/environment.js';
import type { JobRunRepository } from '../repositories/job-run-repository.js';
import { JobRunLogBuffer, flushJobRunLogBufferSafe } from '../job-run-log-buffer.js';
import {
  isJobTimeoutError,
  isTripleExtractionQueueJob,
  resolveBatchJobTimeout
} from './batch-job-timeout-resolver.js';

export interface BatchJobExecutionCoordinatorDeps {
  jobQueue: JobQueue;
  retryManager: RetryManager;
  getConfig: () => BatchJobConfig;
  getIsRunning: () => boolean;
  lastExecution: Map<string, Date>;
  totalExecutions: Map<string, number>;
  lastJobRunMeta: Map<string, { at: Date; success: boolean; durationMs: number }>;
  writeDiagnosticsEvent: (event: Record<string, unknown>) => Promise<void>;
  log: (message: string, data?: unknown, level?: 'info' | 'warn' | 'error') => void;
  checkSchedulerHealth: () => Promise<void>;
  /** Issue #833: durable job_run append (schedule trigger). Optional — soft-fail if unavailable. */
  getDb?: () => Database.Database | null;
  jobRunRepository?: JobRunRepository;
}

/**
 * 큐·재시도·타임아웃·진단 이벤트를 한 곳에서 처리해 BatchScheduler 본문을 얇게 유지한다.
 */
export class BatchJobExecutionCoordinator {
  constructor(private readonly deps: BatchJobExecutionCoordinatorDeps) {}

  addJobToQueue(name: string, job: () => Promise<void>, priority: number, retryCount = 0): boolean {
    return this.deps.jobQueue.add(name, job, priority, retryCount);
  }

  /**
   * `addJob` 직후 큐 선두가 해당 작업이면 즉시 한 번 실행을 시도한다.
   */
  afterEnqueueAttempt(
    name: string,
    added: boolean,
    jobProcessorInterval: ReturnType<typeof setInterval> | null
  ): void {
    if (!added || !this.deps.getIsRunning() || !jobProcessorInterval) {
      return;
    }

    setImmediate(() => {
      if (this.deps.jobQueue.isEmpty || this.deps.jobQueue.runningCount >= this.deps.getConfig().maxConcurrentJobs) {
        return;
      }

      const nextJob = this.deps.jobQueue.peekNext();
      if (!nextJob || nextJob.name !== name) {
        return;
      }

      const immediateJob = this.deps.jobQueue.getNext();
      if (!immediateJob) {
        return;
      }

      this.executeJobWithRetry(
        immediateJob.name,
        immediateJob.job,
        immediateJob.priority,
        immediateJob.retryCount ?? 0
      ).catch(err => {
        this.deps.log(`Failed to execute job ${name} immediately`, { error: err }, 'error');
      });
    });
  }

  startJobProcessor(): ReturnType<typeof setInterval> {
    const processQueue = async () => {
      if (
        this.deps.jobQueue.isEmpty ||
        this.deps.jobQueue.runningCount >= this.deps.getConfig().maxConcurrentJobs
      ) {
        return;
      }

      const nextJob = this.deps.jobQueue.getNext();
      if (nextJob) {
        const retryCount = nextJob.retryCount ?? 0;
        await this.executeJobWithRetry(nextJob.name, nextJob.job, nextJob.priority, retryCount);
      }
    };

    return setInterval(
      processQueue,
      resolveValidatedNumber('BATCH_JOB_PROCESSOR_INTERVAL_MS', 1000, n => n >= 100, '최솟값 100')
    );
  }

  async executeJobWithRetry(
    name: string,
    job: () => Promise<void>,
    priority: number,
    initialRetryCount = 0
  ): Promise<void> {
    if (this.deps.jobQueue.isRunning(name)) {
      const added = this.addJobToQueue(name, job, priority, initialRetryCount);
      if (!added) {
        return;
      }
      this.deps.log(`Job ${name} is already running, will retry after completion`, { level: 'debug' });
      return;
    }

    this.deps.jobQueue.markRunning(name);
    const startTime = Date.now();
    let retryCount = initialRetryCount;
    let jobOk = false;
    /** Issue #834: MVP boundary lines; flushed after job_run append. */
    const logBuffer = new JobRunLogBuffer();
    logBuffer.append({
      level: 'info',
      message: `${name} started`,
      context: { phase: 'start', priority, retryCount },
      ts: new Date(startTime).toISOString(),
    });
    await this.deps.writeDiagnosticsEvent({
      type: 'batch_job_start',
      jobName: name,
      priority,
      retryCount
    });

    try {
      const jobTimeoutMs = resolveBatchJobTimeout(name, this.deps.getConfig());
      await this.executeWithTimeout(job, jobTimeoutMs);
      jobOk = true;
      this.deps.lastExecution.set(name, new Date());
      this.deps.totalExecutions.set(name, (this.deps.totalExecutions.get(name) || 0) + 1);

      this.deps.retryManager.resetErrorCount(name);

      this.deps.log(`Job ${name} completed successfully`, {
        duration: Date.now() - startTime,
        totalExecutions: this.deps.totalExecutions.get(name),
        retryCount
      });
      await this.deps.writeDiagnosticsEvent({
        type: 'batch_job_finish',
        jobName: name,
        durationMs: Date.now() - startTime,
        totalExecutions: this.deps.totalExecutions.get(name) ?? 0,
        retryCount
      });
    } catch (error) {
      retryCount++;
      const totalErrorCount = this.deps.retryManager.incrementErrorCount(name);

      const errorInfo = {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorCount: totalErrorCount,
        retryCount,
        duration: Date.now() - startTime
      };

      const isTripleExtractionTimeout =
        isTripleExtractionQueueJob(name) && isJobTimeoutError(error);

      logBuffer.append({
        level: isTripleExtractionTimeout ? 'warn' : 'error',
        message: isTripleExtractionTimeout
          ? `${name} timed out`
          : `${name} failed: ${errorInfo.error}`,
        context: { phase: 'error', retryCount, errorCount: totalErrorCount },
      });

      this.deps.log(
        isTripleExtractionTimeout ? `Job ${name} timed out` : `Job ${name} failed`,
        errorInfo,
        isTripleExtractionTimeout ? 'warn' : 'error'
      );
      await this.deps.writeDiagnosticsEvent({
        type: 'batch_job_failure',
        jobName: name,
        ...errorInfo,
        severity: isTripleExtractionTimeout ? 'warn' : 'error'
      });

      if (isTripleExtractionTimeout) {
        this.deps.log(
          `Skipping immediate retry for ${name}; batch triple extraction will handle backlog`,
          { jobName: name, duration: errorInfo.duration },
          'warn'
        );
        return;
      }

      const retryResult = this.deps.retryManager.shouldRetry(name, retryCount, totalErrorCount);

      if (retryResult.exceededMaxErrors) {
        this.deps.log(
          `Job ${name} exceeded maximum error count (${totalErrorCount}), stopping retries`,
          {
            totalErrorCount,
            finalError: errorInfo
          },
          'error'
        );

        this.deps.log(`Job ${name} has too many consecutive failures, checking scheduler health`, {
          level: 'warn'
        });
        await this.deps.checkSchedulerHealth();
        return;
      }

      if (retryResult.shouldRetry) {
        this.deps.log(`Retrying job ${name} in ${retryResult.nextRetryDelay}ms`, {
          attempt: retryResult.retryCount,
          totalAttempts: this.deps.getConfig().retryAttempts,
          nextRetryDelay: retryResult.nextRetryDelay,
          totalErrorCount
        });

        setTimeout(() => {
          if (this.deps.getIsRunning()) {
            this.addJobToQueue(name, job, priority, retryResult.retryCount);
          }
        }, retryResult.nextRetryDelay);
      } else {
        this.deps.log(
          `Job ${name} failed permanently after ${retryCount} attempts`,
          {
            totalErrorCount,
            finalError: errorInfo
          },
          'error'
        );

        if (totalErrorCount > this.deps.getConfig().retryAttempts * 2) {
          this.deps.log(`Job ${name} has too many consecutive failures, checking scheduler health`, {
            level: 'warn'
          });
          await this.deps.checkSchedulerHealth();
        }
      }
    } finally {
      const durationMs = Date.now() - startTime;
      logBuffer.append({
        level: jobOk ? 'info' : 'error',
        message: jobOk ? `${name} finished` : `${name} ended with failure`,
        context: { phase: 'end', success: jobOk, durationMs },
      });
      this.deps.lastJobRunMeta.set(name, {
        at: new Date(),
        success: jobOk,
        durationMs
      });
      this.appendScheduleJobRun(name, startTime, durationMs, jobOk, logBuffer);
      this.deps.jobQueue.markCompleted(name);
    }
  }

  /** Issue #833/#834: durable job_run append + log buffer flush. Never throws — soft-fail only. */
  private appendScheduleJobRun(
    name: string,
    startTime: number,
    durationMs: number,
    success: boolean,
    logBuffer?: JobRunLogBuffer
  ): void {
    const db = this.deps.getDb?.();
    const repository = this.deps.jobRunRepository;
    if (!db || !repository) {
      logBuffer?.drain();
      return;
    }
    try {
      const row = repository.append(db, {
        job_name: name,
        trigger: 'schedule',
        started_at: new Date(startTime).toISOString(),
        ended_at: new Date(startTime + durationMs).toISOString(),
        success,
        duration_ms: durationMs
      });
      if (logBuffer && logBuffer.size > 0) {
        flushJobRunLogBufferSafe(db, row.id, logBuffer, (message, data) => {
          this.deps.log(message, data, 'warn');
        });
      }
    } catch (error) {
      logBuffer?.drain();
      this.deps.log(
        'job_run append failed (soft-fail)',
        { jobName: name, error: error instanceof Error ? error.message : String(error) },
        'warn'
      );
    }
  }

  private async executeWithTimeout<T>(promise: () => Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Job timeout after ${timeout}ms`)), timeout);
      })
    ]);
  }
}

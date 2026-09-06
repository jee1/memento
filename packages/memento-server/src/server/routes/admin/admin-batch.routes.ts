/**
 * Admin: 배치 스케줄러, 수동 실행 이력, 공고화(sleep consolidation) 수동 실행
 * Issue #834: run logs, pause/resume, Run now widen, dual-run 409, read-only.
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  appendJobRunSafe,
  BatchJobAlreadyRunningError,
  flushJobRunLogBufferSafe,
  getBatchScheduler,
  isRegisteredManualBatchJobType,
  JobRunLogBuffer,
  JobRunLogRepository,
  JobRunRepository,
  logger,
  mementoConfig,
} from '@memento/core';
import type { JobRunLogRow, JobRunRow } from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';
import {
  BATCH_RUN_HISTORY_DEFAULT_LIMIT,
  BATCH_RUN_HISTORY_MAX_STORED,
  getManualBatchRunHistory,
  recordManualBatchRunFailure,
  recordManualBatchRunSuccess,
} from '../../batch-run-history.js';
import { broadcastReviewCandidatesChanged } from '../../review-candidates-changed-fanout.js';

/** Issue #833: JobRunRow (snake_case, DB shape) → wire response shape (camelCase). */
function toJobRunResponse(row: JobRunRow): Record<string, unknown> {
  let details: unknown = null;
  if (row.details_json) {
    try {
      details = JSON.parse(row.details_json);
    } catch {
      details = null;
    }
  }
  return {
    id: row.id,
    jobName: row.job_name,
    trigger: row.trigger,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    success: row.success === 1,
    durationMs: row.duration_ms,
    processed: row.processed,
    errorCount: row.error_count,
    details,
  };
}

/** Issue #834: JobRunLogRow → wire response. */
function toJobRunLogResponse(row: JobRunLogRow): Record<string, unknown> {
  let context: unknown = null;
  if (row.context_json) {
    try {
      context = JSON.parse(row.context_json);
    } catch {
      context = null;
    }
  }
  return {
    id: row.id,
    ts: row.ts,
    level: row.level,
    message: row.message,
    context,
  };
}

/** Issue #833: clamp query `limit` to 1..100, default 50 (matches JobRunRepository.list). */
function resolveJobRunsLimit(raw: unknown): number {
  const parsed = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : 50;
  const floored = Number.isFinite(parsed) ? Math.floor(parsed) : 50;
  return Math.min(Math.max(floored, 1), 100);
}

/** Issue #834: clamp log list limit to 1..500, default 200. */
function resolveJobRunLogsLimit(raw: unknown): number {
  const parsed = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : 200;
  const floored = Number.isFinite(parsed) ? Math.floor(parsed) : 200;
  return Math.min(Math.max(floored, 1), 500);
}

function resolveJobTypeFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const jobType = record.jobType ?? record.job;
  return typeof jobType === 'string' ? jobType : undefined;
}

function isJobsReadOnly(): boolean {
  return Boolean(mementoConfig.adminJobsReadOnly);
}

function rejectIfReadOnly(res: import('express').Response): boolean {
  if (!isJobsReadOnly()) {
    return false;
  }
  res.status(403).json({
    error: 'Jobs dashboard is in read-only mode',
    code: 'ADMIN_JOBS_READ_ONLY',
  });
  return true;
}

/** Best-effort job name → config interval field (#832). Unknown → null. */
const JOB_INTERVAL_CONFIG_KEY: Record<string, string> = {
  cleanup: 'cleanupInterval',
  monitoring: 'monitoringInterval',
  healthcheck: 'healthCheckInterval',
  wal_checkpoint: 'walCheckpointInterval',
  lock_monitor: 'lockMonitorInterval',
  reflexion_cleanup: 'reflexionCleanupInterval',
  reflexion_healthcheck: 'reflexionHealthCheckInterval',
  consolidation_score_incremental: 'consolidationScoreIncrementalInterval',
  consolidation_score_full_sweep: 'consolidationScoreFullSweepInterval',
  weekly_relation_validation: 'relationValidationInterval',
  log_rotation: 'logRotationInterval',
  triple_extraction_batch: 'tripleExtractionInterval',
  quality_measurement_batch: 'qualityMeasurementInterval',
  meta_memory_introspection: 'metaMemoryIntrospectionInterval',
  memory_review_candidates: 'memoryReviewCandidatesInterval',
  sleep_consolidation_batch: 'sleepConsolidationInterval',
  telemetry_cleanup_batch: 'telemetryCleanupInterval',
  forgetting_event_cleanup_batch: 'forgettingEventCleanupInterval',
  job_run_cleanup_batch: 'jobRunCleanupInterval',
  anchor_auto_refresh: 'anchorAutoRefreshInterval',
};

function resolveJobIntervalMs(name: string, config: Record<string, unknown>): number | null {
  const key = JOB_INTERVAL_CONFIG_KEY[name];
  if (!key) {
    return null;
  }
  const value = config[key];
  return typeof value === 'number' ? value : null;
}

export function registerAdminBatchRoutes(
  router: Router,
  db: Database.Database | null,
  serverServices: ServerServices | null
): void {
  router.get('/batch/status', async (req, res) => {
    try {
      const batchScheduler = getBatchScheduler();
      const status = batchScheduler.getStatus();

      res.json({
        message: '배치 스케줄러 상태 조회 완료',
        status,
        pausedJobs: typeof batchScheduler.getPausedJobNames === 'function'
          ? batchScheduler.getPausedJobNames()
          : [],
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Batch scheduler status retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: '배치 스케줄러 상태 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/batch/stats', async (_req, res) => {
    try {
      const batchScheduler = getBatchScheduler();
      const detailed = batchScheduler.getDetailedStats();
      const config = detailed.status.config as unknown as Record<string, unknown>;

      const jobs = detailed.jobs.map(job => {
        const paused = Boolean(
          (job as { paused?: boolean }).paused ??
            (typeof batchScheduler.isJobPaused === 'function' && batchScheduler.isJobPaused(job.name))
        );
        return {
          name: job.name,
          intervalMs: resolveJobIntervalMs(job.name, config),
          enabled: !paused,
          paused,
          lastExecution: job.lastExecution ? job.lastExecution.toISOString() : null,
          totalExecutions: job.totalExecutions,
          errorCount: job.errorCount,
          errorRate: job.errorRate,
          isRunning: job.isRunning,
        };
      });

      res.json({
        message: '배치 스케줄러 상세 통계 조회 완료',
        schedulerRunning: detailed.status.isRunning,
        health: {
          memoryUsage: detailed.health.memoryUsage,
          runningJobs: detailed.health.runningJobs,
          queueSize: detailed.health.queueSize,
          errorRate: detailed.health.errorRate,
          uptime: detailed.health.uptime,
        },
        jobs,
        queue: {
          size: detailed.health.queueSize,
          runningCount: detailed.health.runningJobs,
          runningNames: batchScheduler.getRunningNames(),
          queuedNames: batchScheduler.getQueuedNames(),
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Batch scheduler detailed stats retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: '배치 스케줄러 상세 통계 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/batch/run-history', (req, res) => {
    try {
      const raw = req.query['limit'];
      const parsed =
        typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : BATCH_RUN_HISTORY_DEFAULT_LIMIT;
      const floored = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : BATCH_RUN_HISTORY_DEFAULT_LIMIT;
      const limit = Math.min(Math.max(1, floored), BATCH_RUN_HISTORY_MAX_STORED);
      const slice = getManualBatchRunHistory(limit);

      res.json({
        message: 'Manual batch run history (POST /admin/batch/run)',
        entries: slice,
        limit,
        maxStored: BATCH_RUN_HISTORY_MAX_STORED,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Batch run history retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: '배치 실행 이력 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/batch/runs', (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const jobRaw = req.query['job'];
      const jobName = typeof jobRaw === 'string' && jobRaw.trim() !== '' ? jobRaw : undefined;
      const limit = resolveJobRunsLimit(req.query['limit']);

      const rows = new JobRunRepository().list(db, { jobName, limit });

      return res.json({
        runs: rows.map(toJobRunResponse),
        limit,
      });
    } catch (error) {
      logger.error('Job run history retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '작업 실행 이력 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /** Issue #834: GET structured logs for a durable job_run. */
  router.get('/batch/runs/:runId/logs', (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const runId = req.params.runId;
      if (!runId || typeof runId !== 'string') {
        return res.status(400).json({ error: 'runId is required' });
      }

      const run = new JobRunRepository().getById(db, runId);
      if (!run) {
        return res.status(404).json({ error: 'run not found' });
      }

      const limit = resolveJobRunLogsLimit(req.query['limit']);
      const logs = new JobRunLogRepository().listByRunId(db, runId, { limit });

      return res.json({
        runId,
        logs: logs.map(toJobRunLogResponse),
        limit,
      });
    } catch (error) {
      logger.error('Job run logs retrieval failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '작업 실행 로그 조회 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /** Issue #834: pause schedule job (stop interval; in-flight not killed). */
  router.post('/batch/pause', (req, res) => {
    try {
      if (rejectIfReadOnly(res)) {
        return;
      }
      const jobType = resolveJobTypeFromBody(req.body);
      if (!jobType || !isRegisteredManualBatchJobType(jobType)) {
        return res.status(400).json({
          error: 'Invalid or unknown jobType',
        });
      }

      const batchScheduler = getBatchScheduler();
      const result = batchScheduler.pauseJob(jobType);
      if (!result.ok) {
        return res.status(400).json({
          error: result.reason === 'unknown_job' ? 'Unknown jobType' : 'Failed to pause job',
          jobType,
        });
      }

      return res.json({
        message: `배치 작업 ${jobType} 일시정지`,
        jobType,
        paused: true,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Batch job pause failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '배치 작업 일시정지 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /** Issue #834: resume schedule job via expanded restart registry. */
  router.post('/batch/resume', (req, res) => {
    try {
      if (rejectIfReadOnly(res)) {
        return;
      }
      const jobType = resolveJobTypeFromBody(req.body);
      if (!jobType || !isRegisteredManualBatchJobType(jobType)) {
        return res.status(400).json({
          error: 'Invalid or unknown jobType',
        });
      }

      const batchScheduler = getBatchScheduler();
      const result = batchScheduler.resumeJob(jobType);
      if (!result.ok) {
        const status = result.reason === 'config_disabled' ? 400 : 400;
        return res.status(status).json({
          error:
            result.reason === 'config_disabled'
              ? `Job ${jobType} cannot be resumed (config disabled or dependency missing)`
              : 'Unknown jobType',
          jobType,
        });
      }

      return res.json({
        message: `배치 작업 ${jobType} 재개`,
        jobType,
        paused: false,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Batch job resume failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '배치 작업 재개 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/batch/run', async (req, res) => {
    const requestedAt = new Date();
    try {
      if (rejectIfReadOnly(res)) {
        return;
      }

      const jobType = resolveJobTypeFromBody(req.body);

      // Issue #834: intentional allowlist widen — all registered schedule job names.
      if (!jobType || !isRegisteredManualBatchJobType(jobType)) {
        return res.status(400).json({
          error: 'Invalid or unregistered jobType'
        });
      }

      const batchScheduler = getBatchScheduler();

      // Issue #834 SC-003: dual-run guard → 409 before invoke.
      if (batchScheduler.isJobRunning(jobType)) {
        return res.status(409).json({
          error: 'job already running',
          jobType,
        });
      }

      const logBuffer = new JobRunLogBuffer();
      logBuffer.append({
        level: 'info',
        message: `${jobType} started (manual)`,
        context: { phase: 'start', trigger: 'manual' },
        ts: requestedAt.toISOString(),
      });

      const result = await batchScheduler.runJob(jobType);
      recordManualBatchRunSuccess(jobType, requestedAt, result);

      logBuffer.append({
        level: result.success ? 'info' : 'error',
        message: result.success
          ? `${jobType} finished (manual)`
          : `${jobType} ended with failure (manual)`,
        context: {
          phase: 'end',
          success: result.success,
          durationMs: result.duration,
          errorCount: result.errors.length,
        },
      });

      const runId = appendJobRunSafe(
        db,
        {
          job_name: jobType,
          trigger: 'manual',
          started_at: result.startTime.toISOString(),
          ended_at: result.endTime.toISOString(),
          success: result.success,
          duration_ms: result.duration,
          processed: result.processed,
          error_count: result.errors.length,
          details_json: result.details != null ? JSON.stringify(result.details) : null,
        },
        (message, data) => logger.warn(message, data as Record<string, unknown> | undefined)
      );

      if (runId) {
        flushJobRunLogBufferSafe(
          db,
          runId,
          logBuffer,
          (message, data) => logger.warn(message, data as Record<string, unknown> | undefined)
        );
      } else {
        logBuffer.drain();
      }

      if (jobType === 'memory_review_candidates') {
        broadcastReviewCandidatesChanged({ reason: 'batch_memory_review_candidates' });
      }

      return res.json({
        message: `배치 작업 ${jobType} 실행 완료`,
        result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      if (error instanceof BatchJobAlreadyRunningError) {
        return res.status(409).json({
          error: 'job already running',
          jobType: error.jobType,
        });
      }
      const body = req.body as { jobType?: string; job?: string };
      const jt = resolveJobTypeFromBody(body);
      if (jt && isRegisteredManualBatchJobType(jt)) {
        const failedAt = new Date();
        const errorMessage = error instanceof Error ? error.message : String(error);
        recordManualBatchRunFailure(jt, requestedAt, failedAt, errorMessage);
        const failBuffer = new JobRunLogBuffer();
        failBuffer.append({
          level: 'error',
          message: `${jt} failed (manual): ${errorMessage}`,
          context: { phase: 'error', trigger: 'manual' },
        });
        const runId = appendJobRunSafe(
          db,
          {
            job_name: jt,
            trigger: 'manual',
            started_at: requestedAt.toISOString(),
            ended_at: failedAt.toISOString(),
            success: false,
            duration_ms: failedAt.getTime() - requestedAt.getTime(),
            error_count: 1,
            details_json: JSON.stringify({ error: errorMessage }),
          },
          (message, data) => logger.warn(message, data as Record<string, unknown> | undefined)
        );
        if (runId) {
          flushJobRunLogBufferSafe(
            db,
            runId,
            failBuffer,
            (message, data) => logger.warn(message, data as Record<string, unknown> | undefined)
          );
        }
      }
      logger.error('Batch job execution failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: '배치 작업 실행 실패',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/consolidation/run', async (req, res) => {
    try {
      const svc = serverServices?.sleepConsolidationService;
      if (!db || !svc) {
        return res.status(503).json({
          success: false,
          error: 'Sleep consolidation not available'
        });
      }

      const dryRun = Boolean(req.body?.dryRun);
      const ownerIdFilter =
        typeof req.body?.ownerIdFilter === 'string' ? req.body.ownerIdFilter : null;

      const result = await svc.run({ dryRun, ownerIdFilter });
      return res.json({ success: true, result });
    } catch (error) {
      logger.error('Sleep consolidation run failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        success: false,
        error: `Consolidation failed: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  });
}

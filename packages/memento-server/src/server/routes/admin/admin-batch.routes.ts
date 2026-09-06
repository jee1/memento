/**
 * Admin: 배치 스케줄러, 수동 실행 이력, 공고화(sleep consolidation) 수동 실행
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import { getBatchScheduler, logger } from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';
import {
  BATCH_RUN_HISTORY_DEFAULT_LIMIT,
  BATCH_RUN_HISTORY_MAX_STORED,
  getManualBatchRunHistory,
  recordManualBatchRunFailure,
  recordManualBatchRunSuccess,
} from '../../batch-run-history.js';
import { broadcastReviewCandidatesChanged } from '../../review-candidates-changed-fanout.js';

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

      const jobs = detailed.jobs.map(job => ({
        name: job.name,
        intervalMs: resolveJobIntervalMs(job.name, config),
        enabled: true,
        lastExecution: job.lastExecution ? job.lastExecution.toISOString() : null,
        totalExecutions: job.totalExecutions,
        errorCount: job.errorCount,
        errorRate: job.errorRate,
        isRunning: job.isRunning,
      }));

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

  router.post('/batch/run', async (req, res) => {
    const requestedAt = new Date();
    try {
      const { jobType } = req.body;

      if (!jobType || !['cleanup', 'monitoring', 'memory_review_candidates'].includes(jobType)) {
        return res.status(400).json({
          error: 'Invalid job type. Must be "cleanup", "monitoring", or "memory_review_candidates"'
        });
      }

      const batchScheduler = getBatchScheduler();
      const result = await batchScheduler.runJob(jobType);
      recordManualBatchRunSuccess(jobType, requestedAt, result);

      if (jobType === 'memory_review_candidates') {
        broadcastReviewCandidatesChanged({ reason: 'batch_memory_review_candidates' });
      }

      return res.json({
        message: `배치 작업 ${jobType} 실행 완료`,
        result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      const body = req.body as { jobType?: string };
      const jt = body?.jobType;
      if (jt && ['cleanup', 'monitoring', 'memory_review_candidates'].includes(jt)) {
        recordManualBatchRunFailure(jt, requestedAt, new Date(), error instanceof Error ? error.message : String(error));
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

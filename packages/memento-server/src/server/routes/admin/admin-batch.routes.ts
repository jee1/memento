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

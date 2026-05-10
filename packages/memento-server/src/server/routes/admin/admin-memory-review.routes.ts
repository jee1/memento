/**
 * Admin: 메모리 미리보기, 리뷰 큐·SSE·후보 처리
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import { validate as uuidValidate } from 'uuid';
import {
  listMemoryReviewCandidates,
  markMemoryReviewCandidateReviewed,
  markMemoryReviewCandidateDismissed,
  computeMemoryReviewQueueHealthLive,
  maybeRecordMemoryReviewQueueHealthSnapshot,
  listMemoryReviewQueueHealthSnapshots,
  parseAdminMemoryItemIdParam,
  getAdminMemoryItemPreviewById,
  MemoryReviewCandidateError,
  type MemoryReviewCandidateStatus,
  logger,
} from '@memento/core';
import { attachReviewCandidatesSse } from '../../review-candidates-sse-hub.js';
import { broadcastReviewCandidatesChanged } from '../../review-candidates-changed-fanout.js';

const MEMORY_REVIEW_STATUSES: MemoryReviewCandidateStatus[] = [
  'pending',
  'reviewed',
  'dismissed',
  'expired'
];

function parseReviewCandidateStatusQuery(
  raw: unknown
): { status?: MemoryReviewCandidateStatus } | { error: string; status: number } {
  if (raw === undefined || raw === '') {
    return {};
  }
  if (typeof raw !== 'string' || !MEMORY_REVIEW_STATUSES.includes(raw as MemoryReviewCandidateStatus)) {
    return { error: 'Invalid status query', status: 400 };
  }
  return { status: raw as MemoryReviewCandidateStatus };
}

export function registerAdminMemoryReviewRoutes(router: Router, db: Database.Database | null): void {
  router.get('/memory/items/:memory_id', (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const parsedId = parseAdminMemoryItemIdParam(req.params.memory_id ?? '');
      if ('error' in parsedId) {
        return res.status(parsedId.status).json({ error: parsedId.error });
      }
      const item = getAdminMemoryItemPreviewById(db, parsedId.memoryId);
      if (!item) {
        return res.status(404).json({ error: 'Memory not found' });
      }
      logger.info('Admin memory item preview served', { memory_id: item.id });
      return res.json({
        message: 'Memory item',
        memory: item,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Admin memory item preview failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: 'Failed to load memory item',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  router.get('/memory/review-candidates', (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const parsed = parseReviewCandidateStatusQuery(req.query['status']);
      if ('error' in parsed) {
        return res.status(parsed.status).json({ error: parsed.error });
      }
      const rows = listMemoryReviewCandidates(db, parsed.status ? { status: parsed.status } : {});
      return res.json({
        message: 'Memory review candidates',
        candidates: rows,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('List review candidates failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to list review candidates',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/memory/review-candidates/metrics', (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const raw = req.query['history_limit'];
      const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
      const historyLimit = Number.isFinite(parsed) ? parsed : 48;
      maybeRecordMemoryReviewQueueHealthSnapshot(db, 50 * 60 * 1000);
      const live = computeMemoryReviewQueueHealthLive(db);
      const snapshots = listMemoryReviewQueueHealthSnapshots(db, historyLimit);
      logger.info('review_queue_health', {
        pending_total: live.pendingTotal,
        net_flow_1h: live.window1h.netFlow,
        created_1h: live.window1h.candidatesCreated,
        processed_1h: live.window1h.processedTotal,
        snapshots_returned: snapshots.length,
      });
      return res.json({
        message: 'Pending review queue health',
        live,
        snapshots,
        snapshotNote:
          'Snapshots append after each memory_review_candidates batch job and may append here when stale (≥50min since last sample).',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Review queue metrics failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: 'Failed to load review queue metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  router.get('/memory/review-candidates/stream', (_req, res) => {
    try {
      attachReviewCandidatesSse(res);
    } catch (error) {
      logger.error('Review candidates SSE attach failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      if (!res.headersSent) {
        return res.status(500).json({
          error: 'Failed to open review candidates stream',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  });

  router.post('/memory/review-candidates/:id/review', (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const { id } = req.params;
      if (!uuidValidate(id)) {
        return res.status(400).json({ error: 'Invalid candidate id' });
      }
      const nowIso = new Date().toISOString();
      markMemoryReviewCandidateReviewed(db, id, nowIso);
      const row = listMemoryReviewCandidates(db, {}).find(r => r.id === id);
      broadcastReviewCandidatesChanged({ reason: 'review' });
      return res.json({ ok: true, candidate: row ?? null, timestamp: nowIso });
    } catch (error) {
      if (error instanceof MemoryReviewCandidateError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      logger.error('Review candidate review failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to mark reviewed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/memory/review-candidates/:id/dismiss', (req, res) => {
    try {
      if (!db) {
        return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      }
      const { id } = req.params;
      if (!uuidValidate(id)) {
        return res.status(400).json({ error: 'Invalid candidate id' });
      }
      const nowIso = new Date().toISOString();
      markMemoryReviewCandidateDismissed(db, id, nowIso);
      const row = listMemoryReviewCandidates(db, {}).find(r => r.id === id);
      broadcastReviewCandidatesChanged({ reason: 'dismiss' });
      return res.json({ ok: true, candidate: row ?? null, timestamp: nowIso });
    } catch (error) {
      if (error instanceof MemoryReviewCandidateError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      logger.error('Review candidate dismiss failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to mark dismissed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}

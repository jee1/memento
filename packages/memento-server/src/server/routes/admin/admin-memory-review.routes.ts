/**
 * Admin: 메모리 미리보기, 리뷰 큐·SSE·후보 처리
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import { validate as uuidValidate } from 'uuid';
import {
  listMemoryReviewCandidates,
  queryMemoryReviewCandidates,
  markMemoryReviewCandidateReviewed,
  markMemoryReviewCandidateDismissed,
  bulkUpdatePendingMemoryReviewCandidates,
  type BulkMemoryReviewCandidateSelector,
  type QueryMemoryReviewCandidatesInput,
  computeMemoryReviewQueueHealthLive,
  maybeRecordMemoryReviewQueueHealthSnapshot,
  listMemoryReviewQueueHealthSnapshots,
  parseAdminMemoryItemIdParam,
  getAdminMemoryItemPreviewById,
  MemoryReviewCandidateError,
  MEMORY_REVIEW_MEMORY_TYPES,
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
  if (
    Array.isArray(raw) ||
    typeof raw !== 'string' ||
    !MEMORY_REVIEW_STATUSES.includes(raw as MemoryReviewCandidateStatus)
  ) {
    return { error: 'Invalid status query', status: 400 };
  }
  return { status: raw as MemoryReviewCandidateStatus };
}

function parseQueryString(
  raw: unknown,
  field: string,
): string | undefined | { error: string; status: number } {
  if (raw === undefined || raw === '') {
    return undefined;
  }
  if (Array.isArray(raw) || typeof raw !== 'string') {
    return { error: `Invalid ${field} query`, status: 400 };
  }
  return raw;
}

function parseBoundedUnitInterval(raw: unknown, field: string): number | { error: string; status: number } {
  const str = parseQueryString(raw, field);
  if (str === undefined) {
    return Number.NaN;
  }
  if (typeof str === 'object') {
    return str;
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(str)) {
    return { error: `Invalid ${field} query`, status: 400 };
  }
  const parsed = Number(str);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return { error: `Invalid ${field} query`, status: 400 };
  }
  return parsed;
}

function parseNonNegativeInt(raw: unknown, field: string): number | { error: string; status: number } {
  const str = parseQueryString(raw, field);
  if (str === undefined) {
    return Number.NaN;
  }
  if (typeof str === 'object') {
    return str;
  }
  if (!/^\d+$/.test(str)) {
    return { error: `Invalid ${field} query`, status: 400 };
  }
  const parsed = Number.parseInt(str, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 36500) {
    return { error: `Invalid ${field} query`, status: 400 };
  }
  return parsed;
}

function parsePositiveInt(
  raw: unknown,
  field: string,
  max = 100_000,
): number | { error: string; status: number } {
  const str = parseQueryString(raw, field);
  if (str === undefined) {
    return Number.NaN;
  }
  if (typeof str === 'object') {
    return str;
  }
  if (!/^\d+$/.test(str)) {
    return { error: `Invalid ${field} query`, status: 400 };
  }
  const parsed = Number.parseInt(str, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    return { error: `Invalid ${field} query`, status: 400 };
  }
  return parsed;
}

function parseReviewCandidateListQuery(
  query: Record<string, unknown>,
): QueryMemoryReviewCandidatesInput | { error: string; status: number } {
  const statusParsed = parseReviewCandidateStatusQuery(query['status']);
  if ('error' in statusParsed) {
    return statusParsed;
  }

  const input: QueryMemoryReviewCandidatesInput = {};
  if (statusParsed.status) {
    input.status = statusParsed.status;
  }

  const importanceMin = parseBoundedUnitInterval(query['importance_min'], 'importance_min');
  if (typeof importanceMin === 'object') return importanceMin;
  if (Number.isFinite(importanceMin)) input.importance_min = importanceMin;

  const importanceMax = parseBoundedUnitInterval(query['importance_max'], 'importance_max');
  if (typeof importanceMax === 'object') return importanceMax;
  if (Number.isFinite(importanceMax)) input.importance_max = importanceMax;

  if (
    input.importance_min !== undefined &&
    input.importance_max !== undefined &&
    input.importance_min > input.importance_max
  ) {
    return { error: 'importance_min must be <= importance_max', status: 400 };
  }

  const unusedDaysMin = parseNonNegativeInt(query['unused_days_min'], 'unused_days_min');
  if (typeof unusedDaysMin === 'object') return unusedDaysMin;
  if (Number.isFinite(unusedDaysMin)) input.unused_days_min = unusedDaysMin;

  const unusedDaysMax = parseNonNegativeInt(query['unused_days_max'], 'unused_days_max');
  if (typeof unusedDaysMax === 'object') return unusedDaysMax;
  if (Number.isFinite(unusedDaysMax)) input.unused_days_max = unusedDaysMax;

  if (
    input.unused_days_min !== undefined &&
    input.unused_days_max !== undefined &&
    input.unused_days_min > input.unused_days_max
  ) {
    return { error: 'unused_days_min must be <= unused_days_max', status: 400 };
  }

  const memoryType = parseQueryString(query['memory_type'], 'memory_type');
  if (typeof memoryType === 'object') {
    return memoryType;
  }
  if (memoryType !== undefined) {
    if (!MEMORY_REVIEW_MEMORY_TYPES.includes(memoryType as never)) {
      return { error: 'Invalid memory_type query', status: 400 };
    }
    input.memory_type = memoryType;
  }

  const reasonContains = parseQueryString(query['reason_contains'], 'reason_contains');
  if (typeof reasonContains === 'object') {
    return reasonContains;
  }
  if (reasonContains !== undefined) {
    if (reasonContains.length > 200) {
      return { error: 'Invalid reason_contains query', status: 400 };
    }
    input.reason_contains = reasonContains;
  }

  const hasPageSize = query['page_size'] !== undefined && query['page_size'] !== '';
  const hasPage = query['page'] !== undefined && query['page'] !== '';
  if (hasPage && !hasPageSize) {
    return { error: 'page requires page_size', status: 400 };
  }

  if (hasPageSize) {
    const pageSizeRaw = parseQueryString(query['page_size'], 'page_size');
    if (typeof pageSizeRaw === 'object') {
      return pageSizeRaw;
    }
    if (pageSizeRaw !== '25' && pageSizeRaw !== '50') {
      return { error: 'Invalid page_size query', status: 400 };
    }
    input.page_size = pageSizeRaw === '50' ? 50 : 25;

    const pageParsed = hasPage ? parsePositiveInt(query['page'], 'page') : 1;
    if (typeof pageParsed === 'object') {
      return pageParsed;
    }
    input.page = Number.isFinite(pageParsed) ? pageParsed : 1;
  }

  const hasFilters =
    input.importance_min !== undefined ||
    input.importance_max !== undefined ||
    input.unused_days_min !== undefined ||
    input.unused_days_max !== undefined ||
    input.memory_type !== undefined ||
    input.reason_contains !== undefined ||
    input.page_size !== undefined;

  if (hasFilters || input.status) {
    return input;
  }

  return input;
}

function usesReviewCandidateListExtensions(query: Record<string, unknown>): boolean {
  return [
    'importance_min',
    'importance_max',
    'unused_days_min',
    'unused_days_max',
    'memory_type',
    'reason_contains',
    'page',
    'page_size',
  ].some((key) => query[key] !== undefined && query[key] !== '');
}

function parseBulkSelector(body: unknown): BulkMemoryReviewCandidateSelector | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must contain exactly one bulk selector' };
  }
  const input = body as Record<string, unknown>;
  const hasIds = Object.prototype.hasOwnProperty.call(input, 'ids');
  const hasOlderThanDays = Object.prototype.hasOwnProperty.call(input, 'older_than_days');
  const hasAllPending = Object.prototype.hasOwnProperty.call(input, 'all_pending');
  if ([hasIds, hasOlderThanDays, hasAllPending].filter(Boolean).length !== 1) {
    return { error: 'Exactly one of ids, older_than_days, or all_pending is required' };
  }
  if (hasIds) {
    if (
      !Array.isArray(input.ids) ||
      input.ids.length === 0 ||
      !input.ids.every(id => typeof id === 'string' && uuidValidate(id))
    ) {
      return { error: 'ids must be a non-empty array of UUIDs' };
    }
    return { ids: [...new Set(input.ids as string[])] };
  }
  if (hasOlderThanDays) {
    if (
      typeof input.older_than_days !== 'number' ||
      !Number.isInteger(input.older_than_days) ||
      input.older_than_days < 1 ||
      input.older_than_days > 3650
    ) {
      return { error: 'older_than_days must be an integer between 1 and 3650' };
    }
    return { older_than_days: input.older_than_days };
  }
  if (input.all_pending !== true) {
    return { error: 'all_pending must be true' };
  }
  return { all_pending: true };
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
      const queryRecord = req.query as Record<string, unknown>;
      if (usesReviewCandidateListExtensions(queryRecord)) {
        const parsed = parseReviewCandidateListQuery(queryRecord);
        if ('error' in parsed) {
          return res.status(parsed.status).json({ error: parsed.error });
        }
        const result = queryMemoryReviewCandidates(db, parsed);
        return res.json({
          message: 'Memory review candidates',
          candidates: result.candidates,
          filters_applied: result.filters_applied,
          pagination: result.pagination,
          timestamp: new Date().toISOString(),
        });
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
      return;
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
      return;
    }
  });

  router.post('/memory/review-candidates/bulk-dismiss', (req, res) => {
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    const selector = parseBulkSelector(req.body);
    if ('error' in selector) {
      return res.status(400).json({ error: selector.error });
    }
    try {
      const nowIso = new Date().toISOString();
      const result = bulkUpdatePendingMemoryReviewCandidates(db, 'dismiss', selector, nowIso);
      if (result.updated > 0) {
        broadcastReviewCandidatesChanged({ reason: 'bulk_dismiss' });
      }
      return res.json({ ok: true, action: 'dismiss', ...result, timestamp: nowIso });
    } catch (error) {
      logger.error('Bulk dismiss review candidates failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: 'Failed to bulk dismiss review candidates',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  router.post('/memory/review-candidates/bulk-expire', (req, res) => {
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    const selector = parseBulkSelector(req.body);
    if ('error' in selector) {
      return res.status(400).json({ error: selector.error });
    }
    try {
      const nowIso = new Date().toISOString();
      const result = bulkUpdatePendingMemoryReviewCandidates(db, 'expire', selector, nowIso);
      if (result.updated > 0) {
        broadcastReviewCandidatesChanged({ reason: 'bulk_expire' });
      }
      return res.json({ ok: true, action: 'expire', ...result, timestamp: nowIso });
    } catch (error) {
      logger.error('Bulk expire review candidates failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: 'Failed to bulk expire review candidates',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
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

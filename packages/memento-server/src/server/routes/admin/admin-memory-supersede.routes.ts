/**
 * Admin: 대체 후보 목록, 승인, 거절, 복원 (#1551, #1618)
 */

import type { Request, Response, Router } from 'express';
import type Database from 'better-sqlite3';
import { validate as uuidValidate } from 'uuid';
import {
  applySupersedeCandidate,
  restoreSupersededMemory,
  dismissSupersedeCandidate,
  querySupersedeCandidates,
  parseAdminMemoryItemIdParam,
  mementoConfig,
  logger,
  SUPERSEDE_CANDIDATE_LIFECYCLE_STATUSES,
  type QuerySupersedeCandidatesInput,
  type SupersedeCandidateLifecycleStatus,
} from '@memento/core';
import { dashboardSessionIdentity } from '../../middleware/session-auth.middleware.js';

const MAX_REASON_CHARS = 1000;
const NOT_FOUND_REASONS = new Set(['candidate_not_found', 'memory_not_found']);
const SUPERSEDE_VERDICTS = ['confirmed', 'pending', 'compatible'] as const;

function parseReason(body: unknown): { reason: string | null } | { error: string } {
  const reason = ((body ?? {}) as Record<string, unknown>).reason;
  if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > MAX_REASON_CHARS)) {
    return { error: `reason must be a string up to ${MAX_REASON_CHARS} chars` };
  }
  return { reason: typeof reason === 'string' ? reason : null };
}

function parseDismissReason(body: unknown): { reason: string } | { error: string } {
  const parsed = parseReason(body);
  if ('error' in parsed) {
    return parsed;
  }
  const trimmed = parsed.reason?.trim() ?? '';
  if (!trimmed) {
    return { error: 'reason is required' };
  }
  return { reason: trimmed };
}

function rejectIfDisabled(res: Response): boolean {
  if (mementoConfig.supersedeApplyEnabled) {
    return false;
  }
  res.status(403).json({ error: 'Supersede approval is disabled', code: 'SUPERSEDE_APPLY_DISABLED' });
  return true;
}

function sendOutcome(res: Response, outcome: { kind: string; reason?: string }) {
  if (outcome.kind !== 'rejected') {
    return res.json({ ok: true, outcome });
  }
  const status = NOT_FOUND_REASONS.has(outcome.reason ?? '') ? 404 : 409;
  return res.status(status).json({ error: 'Supersede request rejected', code: outcome.reason });
}

function requireSession(_req: Request, res: Response): string | null {
  const actor = dashboardSessionIdentity(res);
  if (!actor) {
    res.status(401).json({ error: 'Dashboard session required', code: 'SESSION_REQUIRED' });
    return null;
  }
  return actor;
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

function parsePositiveInt(raw: unknown, field: string): number | { error: string; status: number } {
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
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) {
    return { error: `Invalid ${field} query`, status: 400 };
  }
  return parsed;
}

export function parseSupersedeCandidateListQuery(
  query: Record<string, unknown>,
): QuerySupersedeCandidatesInput | { error: string; status: number } {
  const input: QuerySupersedeCandidatesInput = {};

  const verdict = parseQueryString(query.verdict, 'verdict');
  if (typeof verdict === 'object') {
    return verdict;
  }
  if (verdict !== undefined) {
    if (!SUPERSEDE_VERDICTS.includes(verdict as (typeof SUPERSEDE_VERDICTS)[number])) {
      return { error: 'Invalid verdict query', status: 400 };
    }
    input.verdict = verdict as QuerySupersedeCandidatesInput['verdict'];
  }

  const projectRaw = parseQueryString(query.project_id, 'project_id');
  if (typeof projectRaw === 'object') {
    return projectRaw;
  }
  if (projectRaw !== undefined) {
    if (projectRaw === 'null') {
      input.project_id = null;
    } else if (projectRaw.length > 200) {
      return { error: 'Invalid project_id query', status: 400 };
    } else {
      input.project_id = projectRaw;
    }
  }

  const lifecycle = parseQueryString(query.lifecycle_status, 'lifecycle_status');
  if (typeof lifecycle === 'object') {
    return lifecycle;
  }
  if (lifecycle !== undefined) {
    if (!SUPERSEDE_CANDIDATE_LIFECYCLE_STATUSES.includes(lifecycle as SupersedeCandidateLifecycleStatus)) {
      return { error: 'Invalid lifecycle_status query', status: 400 };
    }
    input.lifecycle_status = lifecycle as SupersedeCandidateLifecycleStatus;
  }

  const pageSizeRaw = parseQueryString(query.page_size, 'page_size');
  if (typeof pageSizeRaw === 'object') {
    return pageSizeRaw;
  }
  const hasPage = query.page !== undefined && query.page !== '';
  if (hasPage && pageSizeRaw === undefined) {
    return { error: 'page requires page_size', status: 400 };
  }
  if (pageSizeRaw !== undefined) {
    if (pageSizeRaw !== '25' && pageSizeRaw !== '50') {
      return { error: 'Invalid page_size query', status: 400 };
    }
    input.page_size = pageSizeRaw === '50' ? 50 : 25;
    const pageParsed = hasPage ? parsePositiveInt(query.page, 'page') : 1;
    if (typeof pageParsed === 'object') {
      return pageParsed;
    }
    input.page = Number.isFinite(pageParsed) ? pageParsed : 1;
  }

  return input;
}

function handleApply(
  db: Database.Database | null,
  run: (db: Database.Database, req: Request, res: Response, actor: string) => unknown,
) {
  return (req: Request, res: Response) => {
    if (rejectIfDisabled(res)) {
      return;
    }
    const actor = requireSession(req, res);
    if (!actor) {
      return;
    }
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    try {
      return run(db, req, res, actor);
    } catch (error) {
      logger.error('Supersede approval failed', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Supersede approval failed' });
    }
  };
}

function handleSessionMutation(
  db: Database.Database | null,
  run: (db: Database.Database, req: Request, res: Response, actor: string) => unknown,
) {
  return (req: Request, res: Response) => {
    const actor = requireSession(req, res);
    if (!actor) {
      return;
    }
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    try {
      return run(db, req, res, actor);
    } catch (error) {
      logger.error('Supersede admin mutation failed', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Supersede admin mutation failed' });
    }
  };
}

export function registerAdminMemorySupersedeRoutes(router: Router, db: Database.Database | null): void {
  router.get('/memory/supersede-candidates', (req, res) => {
    const actor = requireSession(req, res);
    if (!actor) {
      return;
    }
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    const parsed = parseSupersedeCandidateListQuery(req.query as Record<string, unknown>);
    if ('error' in parsed) {
      return res.status(parsed.status).json({ error: parsed.error });
    }
    try {
      return res.json(querySupersedeCandidates(db, parsed));
    } catch (error) {
      logger.error('Supersede candidate list failed', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Supersede candidate list failed' });
    }
  });

  router.post(
    '/memory/supersede-candidates/:id/dismiss',
    handleSessionMutation(db, (database, req, res, actor) => {
      const candidateId = req.params.id ?? '';
      if (!uuidValidate(candidateId)) {
        return res.status(400).json({ error: 'Invalid candidate id' });
      }
      const body = parseDismissReason(req.body);
      if ('error' in body) {
        return res.status(400).json(body);
      }
      return sendOutcome(res, dismissSupersedeCandidate(database, { candidateId, actor, ...body }));
    }),
  );

  router.post(
    '/memory/supersede-candidates/:id/apply',
    handleApply(db, (database, req, res, actor) => {
      const candidateId = req.params.id ?? '';
      if (!uuidValidate(candidateId)) {
        return res.status(400).json({ error: 'Invalid candidate id' });
      }
      const body = parseReason(req.body);
      if ('error' in body) {
        return res.status(400).json(body);
      }
      return sendOutcome(res, applySupersedeCandidate(database, { candidateId, actor, ...body }));
    }),
  );

  router.post(
    '/memory/items/:memory_id/supersede/restore',
    handleApply(db, (database, req, res, actor) => {
      const parsedId = parseAdminMemoryItemIdParam(req.params.memory_id ?? '');
      if ('error' in parsedId) {
        return res.status(parsedId.status).json({ error: parsedId.error });
      }
      const body = parseReason(req.body);
      if ('error' in body) {
        return res.status(400).json(body);
      }
      const expected = (req.body as Record<string, unknown> | undefined)?.expected_new_memory_id;
      const parsedExpected = typeof expected === 'string' ? parseAdminMemoryItemIdParam(expected) : null;
      if (!parsedExpected || 'error' in parsedExpected) {
        return res.status(400).json({ error: 'expected_new_memory_id must be a memory id' });
      }
      return sendOutcome(
        res,
        restoreSupersededMemory(database, {
          oldMemoryId: parsedId.memoryId,
          expectedNewMemoryId: parsedExpected.memoryId,
          actor,
          ...body,
        }),
      );
    }),
  );
}

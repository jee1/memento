/**
 * Admin: 대체 후보 승인과 복원 (#1551)
 *
 * 사람이 후보 하나를 승인할 때만 포인터를 건다. SUPERSEDE_APPLY_ENABLED 가 꺼져 있으면 403 이다.
 * 모든 읽기 경로가 대체된 기억을 거르기(#1552) 전에는 켜지 않는다.
 */

import type { Request, Response, Router } from 'express';
import type Database from 'better-sqlite3';
import { validate as uuidValidate } from 'uuid';
import {
  applySupersedeCandidate,
  restoreSupersededMemory,
  parseAdminMemoryItemIdParam,
  mementoConfig,
  logger,
} from '@memento/core';

const MAX_ACTOR_CHARS = 200;
const MAX_REASON_CHARS = 1000;
const NOT_FOUND_REASONS = new Set(['candidate_not_found', 'memory_not_found']);

type ApprovalBody = { actor: string; reason: string | null };

function parseApprovalBody(body: unknown): ApprovalBody | { error: string } {
  const record = (body ?? {}) as Record<string, unknown>;
  const { actor, reason } = record;
  if (typeof actor !== 'string' || actor.trim() === '' || actor.length > MAX_ACTOR_CHARS) {
    return { error: `actor must be a non-empty string up to ${MAX_ACTOR_CHARS} chars` };
  }
  if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > MAX_REASON_CHARS)) {
    return { error: `reason must be a string up to ${MAX_REASON_CHARS} chars` };
  }
  return { actor: actor.trim(), reason: typeof reason === 'string' ? reason : null };
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

function handle(db: Database.Database | null, run: (db: Database.Database, req: Request, res: Response) => unknown) {
  return (req: Request, res: Response) => {
    if (rejectIfDisabled(res)) {
      return;
    }
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    try {
      return run(db, req, res);
    } catch (error) {
      logger.error('Supersede approval failed', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Supersede approval failed' });
    }
  };
}

export function registerAdminMemorySupersedeRoutes(router: Router, db: Database.Database | null): void {
  router.post(
    '/memory/supersede-candidates/:id/apply',
    handle(db, (database, req, res) => {
      const candidateId = req.params.id ?? '';
      if (!uuidValidate(candidateId)) {
        return res.status(400).json({ error: 'Invalid candidate id' });
      }
      const body = parseApprovalBody(req.body);
      if ('error' in body) {
        return res.status(400).json(body);
      }
      return sendOutcome(res, applySupersedeCandidate(database, { candidateId, ...body }));
    }),
  );

  router.post(
    '/memory/items/:memory_id/supersede/restore',
    handle(db, (database, req, res) => {
      const parsedId = parseAdminMemoryItemIdParam(req.params.memory_id ?? '');
      if ('error' in parsedId) {
        return res.status(parsedId.status).json({ error: parsedId.error });
      }
      const body = parseApprovalBody(req.body);
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
          ...body,
        }),
      );
    }),
  );
}

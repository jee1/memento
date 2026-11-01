/**
 * Admin: 런타임 설정 override 조회, 변경, 되돌리기 (#1582)
 *
 * 인증은 /admin 공통 미들웨어를 그대로 쓴다. 감사 actor 는 요청 본문이 아니라 인증된 대시보드 세션에서 정한다.
 * 레지스트리 밖 키와 읽기 전용 키는 UNKNOWN_SETTING 으로 같이 거절한다.
 * 변경과 되돌리기는 사유가 필수다(#1583). 공백뿐인 사유는 REASON_REQUIRED 이다.
 */

import type { Request, Response, Router } from 'express';
import type Database from 'better-sqlite3';
import {
  listRuntimeSettings,
  listSettingEvents,
  logger,
  revertRuntimeSettingOverride,
  setRuntimeSettingOverride,
  type SettingChangeResult,
} from '@memento/core';
import { dashboardSessionIdentity } from '../../middleware/session-auth.middleware.js';

const MAX_REASON_CHARS = 1000;
const DEFAULT_EVENTS_LIMIT = 50;
const MAX_EVENTS_LIMIT = 200;
const STATUS_BY_CODE = { UNKNOWN_SETTING: 404, INVALID_VALUE: 400, NO_OVERRIDE: 404 } as const;

function parseReason(body: unknown): { reason: string } | { error: string; code: string } {
  const reason = ((body ?? {}) as Record<string, unknown>).reason;
  if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > MAX_REASON_CHARS)) {
    return { error: `reason must be a string up to ${MAX_REASON_CHARS} chars`, code: 'INVALID_REASON' };
  }
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  return trimmed === '' ? { error: 'reason is required', code: 'REASON_REQUIRED' } : { reason: trimmed };
}

/** 문자열 전체가 1..200 정수일 때만 받는다. 없으면 기본값. */
function parseEventsLimit(raw: unknown): number | null {
  if (raw === undefined) {
    return DEFAULT_EVENTS_LIMIT;
  }
  const limit = typeof raw === 'string' && /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
  return limit >= 1 && limit <= MAX_EVENTS_LIMIT ? limit : null;
}

function sendResult(res: Response, result: SettingChangeResult) {
  if (result.ok) {
    return res.json(result.setting);
  }
  return res.status(STATUS_BY_CODE[result.code]).json({ error: result.message, code: result.code });
}

function change(
  db: Database.Database | null,
  run: (database: Database.Database, req: Request, actor: string, reason: string) => SettingChangeResult,
) {
  return (req: Request, res: Response) => {
    const actor = dashboardSessionIdentity(res);
    if (!actor) {
      return res.status(401).json({ error: 'Dashboard session required', code: 'SESSION_REQUIRED' });
    }
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    const parsed = parseReason(req.body);
    if ('error' in parsed) {
      return res.status(400).json(parsed);
    }
    try {
      return sendResult(res, run(db, req, actor, parsed.reason));
    } catch (error) {
      logger.error('Setting override failed', { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: 'Setting override failed' });
    }
  };
}

export function registerAdminSettingsRoutes(router: Router, db: Database.Database | null): void {
  router.get('/settings', (_req, res) => {
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    return res.json(listRuntimeSettings(db));
  });

  router.get('/settings/events', (req, res) => {
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    const limit = parseEventsLimit(req.query.limit);
    if (limit === null) {
      return res
        .status(400)
        .json({ error: `limit must be an integer from 1 to ${MAX_EVENTS_LIMIT}`, code: 'INVALID_LIMIT' });
    }
    const { key } = req.query;
    if (key !== undefined && typeof key !== 'string') {
      return res.status(400).json({ error: 'key must be a single value', code: 'INVALID_KEY' });
    }
    const result = listSettingEvents(db, { key: key || undefined, limit });
    return result.ok
      ? res.json({ events: result.events })
      : res.status(404).json({ error: result.message, code: result.code });
  });

  router.put(
    '/settings/:key',
    change(db, (database, req, actor, reason) =>
      setRuntimeSettingOverride(database, {
        key: req.params.key ?? '',
        value: (req.body as Record<string, unknown> | undefined)?.value,
        actor,
        reason,
      }),
    ),
  );

  router.post(
    '/settings/:key/revert',
    change(db, (database, req, actor, reason) =>
      revertRuntimeSettingOverride(database, { key: req.params.key ?? '', actor, reason }),
    ),
  );
}

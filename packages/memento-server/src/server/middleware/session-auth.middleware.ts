import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { SessionStore } from '../auth/session-store.js';

/**
 * 대시보드 세션 쿠키 이름. rate limit 키 생성(#1161)·감사 로그도 같은 쿠키를 읽으므로
 * 리터럴을 흩뿌리지 않고 여기서 내보낸다.
 */
export const DASHBOARD_SESSION_COOKIE_NAME = 'memento_admin_session';

type SessionAuthMiddlewareConfig = {
  store: SessionStore;
  cookieName: string;
};

export function readCookie(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const cookiePair of cookieHeader.split(';')) {
    const [name, ...valueParts] = cookiePair.trim().split('=');
    if (name === cookieName && valueParts.length > 0) {
      return valueParts.join('=').trim();
    }
  }

  return null;
}

function writeUnauthorized(res: Response): void {
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Admin dashboard session is missing or expired.',
    timestamp: new Date().toISOString()
  });
}

/**
 * 인증된 대시보드 세션의 신원. 세션 id 는 쿠키 비밀이라 rate limit 키와 감사 기록에는 해시만 남긴다.
 */
export function dashboardSessionIdentity(res: Response): string | null {
  const sessionId: unknown = res.locals.dashboardSessionId;
  if (typeof sessionId !== 'string' || !sessionId) {
    return null;
  }
  return `session:${createHash('sha256').update(sessionId).digest('hex').slice(0, 16)}`;
}

export function createSessionAuthMiddleware(config: SessionAuthMiddlewareConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const sessionId = readCookie(req.headers.cookie, config.cookieName);
    if (!sessionId) {
      writeUnauthorized(res);
      return;
    }

    const session = config.store.touch(sessionId);
    if (!session) {
      writeUnauthorized(res);
      return;
    }

    res.locals.dashboardSessionId = sessionId;
    next();
  };
}

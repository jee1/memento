import type { NextFunction, Request, Response } from 'express';

export type SessionRecordLike = {
  sessionId: string;
};

export type SessionStoreLike = {
  touch(sessionId: string): SessionRecordLike | null;
};

export type SessionAuthMiddlewareConfig = {
  store: SessionStoreLike;
  cookieName: string;
};

function readCookie(cookieHeader: string | undefined, cookieName: string): string | null {
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

    next();
  };
}

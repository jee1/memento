import { Router } from 'express';

import type { SessionStore } from '../auth/session-store.js';

type AuthRouterConfig = {
  expectedKey: string | null | undefined;
  store: SessionStore;
  cookieName: string;
  secureCookie: boolean;
};

function readBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return undefined;
  }

  const token = authorizationHeader.slice(7).trim();
  return token === '' ? undefined : token;
}

function readApiKeyHeader(headerValue: string | string[] | undefined): string | undefined {
  if (typeof headerValue !== 'string') {
    return undefined;
  }

  const token = headerValue.trim();
  return token === '' ? undefined : token;
}

function readCookie(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const cookiePair of cookieHeader.split(';')) {
    const [name, ...valueParts] = cookiePair.trim().split('=');
    if (name === cookieName && valueParts.length > 0) {
      return valueParts.join('=');
    }
  }

  return null;
}

export function createAuthRouter(config: AuthRouterConfig): Router {
  const router = Router();

  router.post('/session', (req, res) => {
    const expectedKey = config.expectedKey?.trim();
    const bearerToken = readBearerToken(req.headers.authorization);
    const apiKeyHeader = readApiKeyHeader(req.headers['x-api-key']);
    const providedKey = bearerToken ?? apiKeyHeader;

    if (!expectedKey || providedKey !== expectedKey) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Valid admin credentials are required to create a dashboard session.'
      });
      return;
    }

    const session = config.store.create();
    res.cookie(config.cookieName, session.sessionId, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookie,
      path: '/'
    });
    res.status(204).end();
  });

  router.delete('/session', (req, res) => {
    const sessionId = readCookie(req.headers.cookie, config.cookieName);
    if (sessionId) {
      config.store.delete(sessionId);
    }

    res.clearCookie(config.cookieName, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookie,
      path: '/'
    });
    res.status(204).end();
  });

  return router;
}

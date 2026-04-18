import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionAuthMiddleware } from './session-auth.middleware.js';

function createMockResponse() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.statusCode = 200;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  });
  return res as Response & { statusCode: number; body?: unknown };
}

describe('createSessionAuthMiddleware', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('accepts a valid session cookie for browser routes', () => {
    const session = { sessionId: 'session-123' };
    const store = {
      touch: vi.fn((sessionId: string) => {
        return sessionId === session.sessionId ? session : null;
      })
    };
    const middleware = createSessionAuthMiddleware({
      store,
      cookieName: 'memento_admin_session'
    });

    const req = {
      headers: {
        cookie: `memento_admin_session=${session.sessionId}`
      }
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when the browser session cookie is missing', () => {
    const store = {
      touch: vi.fn(() => null)
    };
    const middleware = createSessionAuthMiddleware({
      store,
      cookieName: 'memento_admin_session'
    });

    const req = { headers: {} } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'Unauthorized',
        message: 'Admin dashboard session is missing or expired.'
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the browser session cookie has expired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T00:00:00.000Z'));

    const store = {
      touch: vi.fn(() => null)
    };
    const session = { sessionId: 'session-expired' };

    const middleware = createSessionAuthMiddleware({
      store,
      cookieName: 'memento_admin_session'
    });

    const req = {
      headers: {
        cookie: `memento_admin_session=${session.sessionId}`
      }
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'Unauthorized',
        message: 'Admin dashboard session is missing or expired.'
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});

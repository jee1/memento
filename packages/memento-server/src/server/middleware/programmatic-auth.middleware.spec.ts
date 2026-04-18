import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProgrammaticAuthMiddleware } from './programmatic-auth.middleware.js';

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

describe('createProgrammaticAuthMiddleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects cookie-only requests', () => {
    const middleware = createProgrammaticAuthMiddleware({
      expectedKey: 'test-admin-key'
    });
    const req = {
      headers: {
        cookie: 'memento_admin_session=session-123'
      }
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'Unauthorized'
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows requests with a valid Authorization Bearer token', () => {
    const middleware = createProgrammaticAuthMiddleware({
      expectedKey: 'test-admin-key'
    });
    const req = {
      headers: {
        authorization: 'Bearer test-admin-key'
      }
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows requests with a valid X-API-Key header', () => {
    const middleware = createProgrammaticAuthMiddleware({
      expectedKey: 'test-admin-key'
    });
    const req = {
      headers: {
        'x-api-key': 'test-admin-key'
      }
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts a valid X-API-Key even when Authorization is invalid', () => {
    const middleware = createProgrammaticAuthMiddleware({
      expectedKey: 'test-admin-key'
    });
    const req = {
      headers: {
        authorization: 'Bearer wrong-key',
        'x-api-key': 'test-admin-key'
      }
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when ADMIN_API_KEY is missing', () => {
    const middleware = createProgrammaticAuthMiddleware({
      expectedKey: undefined
    });
    const req = {
      headers: {
        authorization: 'Bearer test-admin-key'
      }
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'Unauthorized',
        message: 'Programmatic API is disabled: ADMIN_API_KEY is not configured.'
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});

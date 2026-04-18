/**
 * admin-auth.middleware.ts 테스트
 *
 * US2: fail-closed 동작 — ADMIN_API_KEY 미설정 시 모든 요청에 401 반환
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// mementoConfig mock
vi.mock('@memento/core', () => ({
  mementoConfig: {
    adminApiKey: undefined as string | undefined
  }
}));

import { mementoConfig } from '@memento/core';
import { createAdminAuthMiddleware } from './admin-auth.middleware.js';

// Helper: mock Express request/response/next
function makeMocks() {
  const req = {} as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe('createAdminAuthMiddleware — fail-closed behavior', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // T008: ADMIN_API_KEY absent → 401
  it('returns 401 when ADMIN_API_KEY is absent (undefined)', () => {
    (mementoConfig as { adminApiKey: string | undefined }).adminApiKey = undefined;
    const middleware = createAdminAuthMiddleware();
    const { req, res, next } = makeMocks();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Unauthorized',
        message: expect.stringContaining('ADMIN_API_KEY')
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  // T009: ADMIN_API_KEY empty string → 401
  it('returns 401 when ADMIN_API_KEY is empty string', () => {
    (mementoConfig as { adminApiKey: string | undefined }).adminApiKey = '';
    const middleware = createAdminAuthMiddleware();
    const { req, res, next } = makeMocks();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Unauthorized',
        message: expect.stringContaining('ADMIN_API_KEY')
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  // T010: ADMIN_API_KEY whitespace only → 401
  it('returns 401 when ADMIN_API_KEY is whitespace only', () => {
    (mementoConfig as { adminApiKey: string | undefined }).adminApiKey = '   ';
    const middleware = createAdminAuthMiddleware();
    const { req, res, next } = makeMocks();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Unauthorized',
        message: expect.stringContaining('ADMIN_API_KEY')
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  // T011: ADMIN_API_KEY set and correct key provided → allow (next called)
  it('allows request when correct ADMIN_API_KEY is provided via Authorization header', () => {
    (mementoConfig as { adminApiKey: string | undefined }).adminApiKey = 'secret-key-123';
    const middleware = createAdminAuthMiddleware();
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {
      authorization: 'Bearer secret-key-123'
    };

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows request when correct ADMIN_API_KEY is provided via X-API-Key header', () => {
    (mementoConfig as { adminApiKey: string | undefined }).adminApiKey = 'secret-key-123';
    const middleware = createAdminAuthMiddleware();
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {
      'x-api-key': 'secret-key-123'
    };

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when ADMIN_API_KEY is set but wrong key is provided', () => {
    (mementoConfig as { adminApiKey: string | undefined }).adminApiKey = 'secret-key-123';
    const middleware = createAdminAuthMiddleware();
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {
      authorization: 'Bearer wrong-key'
    };

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('/api/v1/quality')
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when ADMIN_API_KEY is set but no key is provided', () => {
    (mementoConfig as { adminApiKey: string | undefined }).adminApiKey = 'secret-key-123';
    const middleware = createAdminAuthMiddleware();
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {};

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

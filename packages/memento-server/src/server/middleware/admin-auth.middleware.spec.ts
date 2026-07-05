/**
 * admin-auth.middleware.ts 테스트
 *
 * US2: fail-closed 동작 — API 토큰 미설정 시 모든 요청에 401 반환
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { createApiTokenRegistry } from '../auth/api-token-registry.js';
import { createAdminAuthMiddleware } from './admin-auth.middleware.js';

function makeMocks() {
  const req = {} as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

function createMiddleware(secret: string | undefined) {
  const registry = secret
    ? createApiTokenRegistry([
        {
          id: 'legacy-admin',
          secret,
          scopes: ['tools:invoke', 'admin:destructive'],
        },
      ])
    : createApiTokenRegistry([]);
  return createAdminAuthMiddleware(registry);
}

describe('createAdminAuthMiddleware — fail-closed behavior', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no API tokens are configured', () => {
    const middleware = createMiddleware(undefined);
    const { req, res, next } = makeMocks();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Unauthorized',
        message: expect.stringContaining('MEMENTO_API_TOKENS'),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when API token secret is empty', () => {
    const middleware = createMiddleware('   ');
    const { req, res, next } = makeMocks();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows request when correct admin token is provided via Authorization header', () => {
    const middleware = createMiddleware('secret-key-123');
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {
      authorization: 'Bearer secret-key-123',
    };

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows request when correct admin token is provided via X-API-Key header', () => {
    const middleware = createMiddleware('secret-key-123');
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {
      'x-api-key': 'secret-key-123',
    };

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when token lacks admin:destructive scope', () => {
    const registry = createApiTokenRegistry([
      { id: 'tools-only', secret: 'tools-key', scopes: ['tools:invoke'] },
    ]);
    const middleware = createAdminAuthMiddleware(registry);
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {
      authorization: 'Bearer tools-key',
    };

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is set but wrong key is provided', () => {
    const middleware = createMiddleware('secret-key-123');
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {
      authorization: 'Bearer wrong-key',
    };

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is set but no key is provided', () => {
    const middleware = createMiddleware('secret-key-123');
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {};

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

/**
 * ADMIN_API_KEY 설정 시 관리 라우트 미들웨어 동작 검증.
 * mementoConfig는 모듈 로드 시점에 고정되므로 env 설정 후 resetModules + 동적 import 사용.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

type MockResponse = Pick<Response, 'status' | 'json'> & {
  statusCode?: number;
  body?: unknown;
};

function createMockResponse(): MockResponse {
  const response: MockResponse = {
    statusCode: 200,
    status(code: number) {
      response.statusCode = code;
      return response as Response;
    },
    json(body: unknown) {
      response.body = body;
      return response as Response;
    }
  };

  return response;
}

async function runAdminAuthProbe(headers: Record<string, string> = {}) {
  const { createAdminAuthMiddleware } = await import('./middleware/admin-auth.middleware.js');
  const middleware = createAdminAuthMiddleware();
  const request = {
    headers
  } as Request;
  const response = createMockResponse();
  const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

  middleware(request, response as Response, next);

  return {
    next,
    response
  };
}

describe('admin auth security (integration)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns 401 when ADMIN_API_KEY is set and request has no credentials', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'integration-test-admin-key');
    vi.resetModules();

    const { response, next } = await runAdminAuthProbe();

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(401);
    expect(response.body).toMatchObject({
      error: 'Unauthorized'
    });
  });

  it('returns 200 when Authorization Bearer matches ADMIN_API_KEY', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'valid-bearer-key-abc');
    vi.resetModules();

    const { response, next } = await runAdminAuthProbe({
      authorization: 'Bearer valid-bearer-key-abc'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 200 when X-API-Key matches ADMIN_API_KEY', async () => {
    vi.stubEnv('ADMIN_API_KEY', 'x-api-key-value');
    vi.resetModules();

    const { response, next } = await runAdminAuthProbe({
      'x-api-key': 'x-api-key-value'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });
});

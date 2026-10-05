import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiTokenRegistry } from '../auth/api-token-registry.js';
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

function createRegistry(secret = 'test-admin-key') {
  return createApiTokenRegistry([
    {
      id: 'legacy-admin',
      secret,
      scopes: ['tools:invoke', 'admin:destructive'],
    },
  ]);
}

describe('createProgrammaticAuthMiddleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects cookie-only requests', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createRegistry(),
      requiredScope: 'tools:invoke',
    });
    const req = {
      headers: {
        cookie: 'memento_admin_session=session-123',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'Unauthorized',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows requests with a valid Authorization Bearer token', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createRegistry(),
      requiredScope: 'tools:invoke',
    });
    const req = {
      headers: {
        authorization: 'Bearer test-admin-key',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.programmaticAuth).toEqual({
      keyId: 'legacy-admin',
      scopes: ['tools:invoke', 'admin:destructive'],
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows requests with a valid X-API-Key header', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createRegistry(),
      requiredScope: 'tools:invoke',
    });
    const req = {
      headers: {
        'x-api-key': 'test-admin-key',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts a valid X-API-Key even when Authorization is invalid', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createRegistry(),
      requiredScope: 'tools:invoke',
    });
    const req = {
      headers: {
        authorization: 'Bearer wrong-key',
        'x-api-key': 'test-admin-key',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when no API tokens are configured', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createApiTokenRegistry([]),
      requiredScope: 'tools:invoke',
    });
    const req = {
      headers: {
        authorization: 'Bearer test-admin-key',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'Unauthorized',
        message: 'Programmatic API is disabled: configure MEMENTO_API_TOKENS.',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when token lacks required scope', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createApiTokenRegistry([
        { id: 'tools-only', secret: 'tools-key', scopes: ['tools:invoke'] },
      ]),
      requiredScope: 'admin:destructive',
    });
    const req = {
      headers: {
        authorization: 'Bearer tools-key',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: 'Forbidden',
        message: expect.stringContaining('admin:destructive'),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('bound token: no agent header sets programmaticAuth.agentId', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createApiTokenRegistry([
        { id: 'codex', secret: 's1', scopes: ['tools:invoke'], agentId: 'codex-agent' },
      ]),
      requiredScope: 'tools:invoke',
    });
    const req = {
      headers: {
        authorization: 'Bearer s1',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.programmaticAuth).toEqual({
      keyId: 'codex',
      scopes: ['tools:invoke'],
      agentId: 'codex-agent',
    });
  });

  it('bound token: matching X-Memento-Agent-Id is allowed', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createApiTokenRegistry([
        { id: 'codex', secret: 's1', scopes: ['tools:invoke'], agentId: 'codex-agent' },
      ]),
      requiredScope: 'tools:invoke',
    });
    const req = {
      headers: {
        authorization: 'Bearer s1',
        'x-memento-agent-id': 'codex-agent',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('bound token: mismatched X-Memento-Agent-Id returns 403 without echoing agent ids', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createApiTokenRegistry([
        { id: 'codex', secret: 's1', scopes: ['tools:invoke'], agentId: 'codex-agent' },
      ]),
      requiredScope: 'tools:invoke',
    });
    const req = {
      headers: {
        authorization: 'Bearer s1',
        'x-memento-agent-id': 'claude-agent',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain('codex-agent');
    expect(JSON.stringify(res.body)).not.toContain('claude-agent');
  });

  it('bound token: mismatched X-Agent-Id returns 403 without echoing agent ids', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createApiTokenRegistry([
        { id: 'codex', secret: 's1', scopes: ['tools:invoke'], agentId: 'codex-agent' },
      ]),
      requiredScope: 'tools:invoke',
    });
    const req = {
      headers: {
        authorization: 'Bearer s1',
        'x-agent-id': 'claude-agent',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain('codex-agent');
    expect(JSON.stringify(res.body)).not.toContain('claude-agent');
  });

  it('bound token: agent format returns AGENT_ID_MISMATCH on header mismatch', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createApiTokenRegistry([
        { id: 'codex', secret: 's1', scopes: ['tools:invoke'], agentId: 'codex-agent' },
      ]),
      requiredScope: 'tools:invoke',
      errorFormat: 'agent',
    });
    const req = {
      headers: {
        authorization: 'Bearer s1',
        'x-memento-agent-id': 'claude-agent',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(res.body).toEqual({
      status: 403,
      reason_code: 'AGENT_ID_MISMATCH',
      message: 'X-Memento-Agent-Id does not match the agent bound to this API token.',
      retryable: false,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('unbound token: any agent header is allowed and programmaticAuth.agentId is undefined', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createApiTokenRegistry([
        { id: 'unbound', secret: 's1', scopes: ['tools:invoke'] },
      ]),
      requiredScope: 'tools:invoke',
    });
    const req = {
      headers: {
        authorization: 'Bearer s1',
        'x-memento-agent-id': 'any-agent',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.programmaticAuth).toEqual({
      keyId: 'unbound',
      scopes: ['tools:invoke'],
    });
    expect(req.programmaticAuth?.agentId).toBeUndefined();
  });

  it('returns the stable agent API error envelope when requested', () => {
    const middleware = createProgrammaticAuthMiddleware({
      registry: createRegistry(),
      requiredScope: 'tools:invoke',
      errorFormat: 'agent',
    });
    const req = { headers: {} } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);

    expect(res.body).toEqual({
      status: 401,
      reason_code: 'AUTH_FAILED',
      message: 'Programmatic routes require Authorization: Bearer <key> or X-API-Key.',
      retryable: false,
    });
  });
});

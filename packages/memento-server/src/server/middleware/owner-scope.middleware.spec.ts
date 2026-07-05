import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mementoConfigMock, loggerWarnMock } = vi.hoisted(() => ({
  mementoConfigMock: {
    ownerScopeMode: 'strict' as 'strict' | 'warn' | 'off'
  },
  loggerWarnMock: vi.fn()
}));

vi.mock('@memento/core', () => ({
  mementoConfig: mementoConfigMock,
  logger: { warn: loggerWarnMock }
}));

import { createOwnerScopeMiddleware } from './owner-scope.middleware.js';

function runMiddleware(
  req: Partial<Request> & { body?: Record<string, unknown>; toolContext?: { agentId?: string } },
  mode: 'strict' | 'warn' | 'off' = 'strict'
) {
  mementoConfigMock.ownerScopeMode = mode;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  const middleware = createOwnerScopeMiddleware();
  middleware(
    {
      method: 'POST',
      path: '/recall',
      body: req.body ?? {},
      toolContext: req.toolContext
    } as Request,
    res,
    next
  );
  return { res, next };
}

describe('createOwnerScopeMiddleware', () => {
  beforeEach(() => {
    loggerWarnMock.mockClear();
    mementoConfigMock.ownerScopeMode = 'strict';
  });

  it('injects owner_id from toolContext.agentId in strict mode', () => {
    const body = { query: 'test', type: 'semantic' };
    const { next } = runMiddleware({ body, toolContext: { agentId: 'agent-a' } });
    expect(body.owner_id).toBe('agent-a');
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 400 in strict mode without agentId or owner_id', () => {
    const { res, next } = runMiddleware({ body: { query: 'test', type: 'semantic' } });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('warn mode proceeds without injection', () => {
    const body = { query: 'test', type: 'semantic' };
    const { next } = runMiddleware({ body }, 'warn');
    expect(body.owner_id).toBeUndefined();
    expect(loggerWarnMock).toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('off mode skips enforcement', () => {
    const body = { query: 'test', type: 'semantic' };
    const { next } = runMiddleware({ body }, 'off');
    expect(body.owner_id).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not override explicit owner_id', () => {
    const body = { query: 'test', type: 'semantic', owner_id: 'explicit' };
    const { next } = runMiddleware({ body, toolContext: { agentId: 'agent-a' } });
    expect(body.owner_id).toBe('explicit');
    expect(next).toHaveBeenCalledOnce();
  });
});

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mementoConfigMock } = vi.hoisted(() => ({
  mementoConfigMock: {
    httpDefaultAgentId: undefined as string | undefined,
  },
}));

vi.mock('@memento/core', () => ({
  mementoConfig: mementoConfigMock,
}));

import { resolveCallerMiddleware } from './resolve-caller.middleware.js';

function createMockRequest(options: {
  headers?: Record<string, string>;
  programmaticAuth?: { keyId?: string; agentId?: string; scopes?: string[] };
} = {}): Request {
  const headers = options.headers ?? {};
  return {
    get: vi.fn((name: string) => {
      const lower = name.toLowerCase();
      return headers[lower];
    }),
    headers,
    programmaticAuth: options.programmaticAuth,
  } as unknown as Request;
}

describe('resolveCallerMiddleware', () => {
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    mementoConfigMock.httpDefaultAgentId = undefined;
    res = {} as Response;
    next = vi.fn();
  });

  it('prefers programmaticAuth.agentId over header and default', () => {
    mementoConfigMock.httpDefaultAgentId = 'default-agent';
    const req = createMockRequest({
      headers: { 'x-memento-agent-id': 'header-agent' },
      programmaticAuth: { agentId: 'auth-agent' },
    });

    resolveCallerMiddleware(req, res, next);

    expect(req.callerAgentId).toBe('auth-agent');
    expect(next).toHaveBeenCalledOnce();
  });

  it('uses header when programmaticAuth.agentId is absent', () => {
    mementoConfigMock.httpDefaultAgentId = 'default-agent';
    const req = createMockRequest({
      headers: { 'x-memento-agent-id': 'header-agent' },
    });

    resolveCallerMiddleware(req, res, next);

    expect(req.callerAgentId).toBe('header-agent');
    expect(next).toHaveBeenCalledOnce();
  });

  it('falls back to defaultAgentId when header is absent', () => {
    mementoConfigMock.httpDefaultAgentId = 'default-agent';
    const req = createMockRequest();

    resolveCallerMiddleware(req, res, next);

    expect(req.callerAgentId).toBe('default-agent');
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets callerAgentId to undefined when no agent source exists', () => {
    const req = createMockRequest();

    resolveCallerMiddleware(req, res, next);

    expect(req.callerAgentId).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('extracts projectId from x-memento-project-id header', () => {
    const req = createMockRequest({
      headers: { 'x-memento-project-id': 'project-123' },
    });

    resolveCallerMiddleware(req, res, next);

    expect(req.projectId).toBe('project-123');
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets projectId to undefined when header is absent', () => {
    const req = createMockRequest();

    resolveCallerMiddleware(req, res, next);

    expect(req.projectId).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('prefers programmaticAuth.projectId over header', () => {
    const req = createMockRequest({
      headers: { 'x-memento-project-id': 'header-proj' },
      programmaticAuth: { projectId: 'auth-proj' } as any,
    });

    resolveCallerMiddleware(req, res, next);

    expect(req.projectId).toBe('auth-proj');
    expect(next).toHaveBeenCalledOnce();
  });

  it('extracts projectId from x-project-id header when x-memento-project-id is absent', () => {
    const req = createMockRequest({
      headers: { 'x-project-id': 'custom-proj' },
    });

    resolveCallerMiddleware(req, res, next);

    expect(req.projectId).toBe('custom-proj');
    expect(next).toHaveBeenCalledOnce();
  });
});

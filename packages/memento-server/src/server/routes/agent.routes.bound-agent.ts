import { AgentIntegrationError } from '@memento/core';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AgentRouterCtx } from './agent.routes.types.js';
import { writeError } from './agent.routes.utils.js';

/**
 * 토큰에 묶인 agent 는 /api/v1/agent 에서 자기 owner 의 세션·기억만 다룬다.
 * MCP 도구의 scopeArgsToBoundAgent·caller-scope 와 같은 경계이며, 바인딩 없는 토큰은 영향이 없다.
 */
function boundAgentOf(req: Request): string | undefined {
  return req.programmaticAuth?.agentId;
}

function forbidden(message: string): AgentIntegrationError {
  return new AgentIntegrationError(message, 'AUTH_FAILED', 403);
}

/** 남의 세션은 없는 세션과 같은 응답을 준다. */
function sessionNotFound(): AgentIntegrationError {
  return new AgentIntegrationError('Agent session not found', 'SESSION_NOT_STARTED', 404);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** owner 필드가 있으면 바인딩 agent 와 같아야 하고, 없으면 바인딩 agent 로 채운다. */
function pinOwner(target: Record<string, unknown>, keys: readonly [string, ...string[]], boundAgentId: string): void {
  let present = false;
  for (const key of keys) {
    const value = target[key];
    if (value === undefined || value === null) continue;
    present = true;
    const values: unknown[] = Array.isArray(value) ? value : [value];
    if (values.some((v) => v !== boundAgentId)) {
      throw forbidden(`${keys[0]} must match the agent bound to this API token.`);
    }
  }
  if (!present) target[keys[0]] = boundAgentId;
}

function pinEventScope(event: unknown, boundAgentId: string): void {
  if (!isRecord(event)) return;
  const scope = isRecord(event.scope) ? event.scope : {};
  pinOwner(scope, ['owner_id'], boundAgentId);
  event.scope = scope;
}

function assertSessionOwned(ctx: AgentRouterCtx, sessionId: unknown, boundAgentId: string): void {
  if (typeof sessionId !== 'string' || !ctx.service) return;
  const session = ctx.service.getSession(sessionId);
  if (session && session.ownerId !== boundAgentId) throw sessionNotFound();
}

/** 요청의 owner 인자와 본문이 가리키는 세션을 바인딩 agent 로 묶는다. */
export function createBoundAgentScope(ctx: AgentRouterCtx): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const boundAgentId = boundAgentOf(req);
    if (!boundAgentId) return next();
    try {
      if (isRecord(req.query)) {
        const query = { ...req.query } as Record<string, unknown>;
        pinOwner(query, ['owner_id'], boundAgentId);
        // Express 5 의 req.query 는 getter 라 재정의해야 핸들러가 고정된 owner 를 읽는다.
        Object.defineProperty(req, 'query', { value: query, configurable: true, writable: true });
      }
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        const body: Record<string, unknown> = isRecord(req.body) ? req.body : {};
        req.body = body;
        // 이벤트 envelope 는 owner 를 scope 에만 둔다(최상위 키를 더하면 스키마 검증에 걸린다).
        if ('event_type' in body) pinEventScope(body, boundAgentId);
        else pinOwner(body, ['owner_id', 'ownerId'], boundAgentId);
        assertSessionOwned(ctx, body.session_id ?? body.sessionId, boundAgentId);
        if (Array.isArray(body.events)) {
          for (const event of body.events) {
            pinEventScope(event, boundAgentId);
            if (isRecord(event)) assertSessionOwned(ctx, event.session_id, boundAgentId);
          }
        }
      }
      next();
    } catch (error) {
      writeError(res, error);
    }
  };
}

/** `/sessions/:id…` 경로의 세션이 바인딩 agent 소유인지 확인한다 (router.param). */
export function createBoundSessionParam(ctx: AgentRouterCtx) {
  return (req: Request, res: Response, next: NextFunction, sessionId: string): void => {
    const boundAgentId = boundAgentOf(req);
    if (!boundAgentId) return next();
    try {
      assertSessionOwned(ctx, sessionId, boundAgentId);
      next();
    } catch (error) {
      writeError(res, error);
    }
  };
}

/** 모든 owner 의 데이터를 집계·변경하는 운영 경로. 바인딩 토큰은 쓸 수 없다. */
export const operatorOnly: RequestHandler = (req, res, next) => {
  if (!boundAgentOf(req)) return next();
  writeError(res, forbidden('This endpoint spans all agents and is not available to an agent-bound API token.'));
};

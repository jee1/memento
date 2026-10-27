import { AgentIntegrationError } from '@memento/core';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AgentRouterCtx } from './agent.routes.types.js';
import { writeError } from './agent.routes.utils.js';

/**
 * 토큰에 묶인 agent·project 는 /api/v1/agent 에서 자기 owner·project 의 세션·기억만 다룬다.
 * MCP 도구의 scopeArgsToBoundAgent·caller-scope 와 같은 경계이며, 바인딩 없는 토큰은 영향이 없다.
 * projectId 는 projectScopeEnabled 일 때만 programmatic-auth 가 채운다.
 */
type TokenBinding = { agentId?: string; projectId?: string };

function bindingOf(req: Request): TokenBinding | undefined {
  const agentId = req.programmaticAuth?.agentId;
  const projectId = req.programmaticAuth?.projectId;
  if (!agentId && !projectId) return undefined;
  return { ...(agentId ? { agentId } : {}), ...(projectId ? { projectId } : {}) };
}

export function isBoundToken(req: Request): boolean {
  return bindingOf(req) !== undefined;
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

/** 필드가 있으면 바인딩 값과 같아야 하고, 없으면 바인딩 값으로 채운다. */
function pinField(target: Record<string, unknown>, keys: readonly [string, ...string[]], bound: string, what: string): void {
  let present = false;
  for (const key of keys) {
    const value = target[key];
    if (value === undefined || value === null) continue;
    present = true;
    const values: unknown[] = Array.isArray(value) ? value : [value];
    if (values.some((v) => v !== bound)) {
      throw forbidden(`${keys[0]} must match the ${what} bound to this API token.`);
    }
  }
  if (!present) target[keys[0]] = bound;
}

function pinBinding(
  target: Record<string, unknown>,
  binding: TokenBinding,
  keys: { owner: readonly [string, ...string[]]; project: readonly [string, ...string[]] },
): void {
  if (binding.agentId) pinField(target, keys.owner, binding.agentId, 'agent');
  if (binding.projectId) pinField(target, keys.project, binding.projectId, 'project');
}

function pinEventScope(event: unknown, binding: TokenBinding): void {
  if (!isRecord(event)) return;
  const scope = isRecord(event.scope) ? event.scope : {};
  pinBinding(scope, binding, { owner: ['owner_id'], project: ['project_id'] });
  event.scope = scope;
}

function assertSessionOwned(ctx: AgentRouterCtx, sessionId: unknown, binding: TokenBinding): void {
  if (typeof sessionId !== 'string' || !ctx.service) return;
  const session = ctx.service.getSession(sessionId);
  if (!session) return;
  if (binding.agentId && session.ownerId !== binding.agentId) throw sessionNotFound();
  if (binding.projectId && session.projectId !== binding.projectId) throw sessionNotFound();
}

/** 요청의 owner·project 인자와 본문이 가리키는 세션을 토큰 바인딩으로 묶는다. */
export function createBoundAgentScope(ctx: AgentRouterCtx): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const binding = bindingOf(req);
    if (!binding) return next();
    try {
      if (isRecord(req.query)) {
        const query = { ...req.query } as Record<string, unknown>;
        pinBinding(query, binding, { owner: ['owner_id'], project: ['project_id'] });
        // Express 5 의 req.query 는 getter 라 재정의해야 핸들러가 고정된 owner 를 읽는다.
        Object.defineProperty(req, 'query', { value: query, configurable: true, writable: true });
      }
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        const body: Record<string, unknown> = isRecord(req.body) ? req.body : {};
        req.body = body;
        // 이벤트 envelope 는 owner 를 scope 에만 둔다(최상위 키를 더하면 스키마 검증에 걸린다).
        if ('event_type' in body) pinEventScope(body, binding);
        else pinBinding(body, binding, { owner: ['owner_id', 'ownerId'], project: ['project_id', 'projectId'] });
        assertSessionOwned(ctx, body.session_id ?? body.sessionId, binding);
        if (Array.isArray(body.events)) {
          for (const event of body.events) {
            pinEventScope(event, binding);
            if (isRecord(event)) assertSessionOwned(ctx, event.session_id, binding);
          }
        }
      }
      next();
    } catch (error) {
      writeError(res, error);
    }
  };
}

/** `/sessions/:id…` 경로의 세션이 토큰 바인딩 소유인지 확인한다 (router.param). */
export function createBoundSessionParam(ctx: AgentRouterCtx) {
  return (req: Request, res: Response, next: NextFunction, sessionId: string): void => {
    const binding = bindingOf(req);
    if (!binding) return next();
    try {
      assertSessionOwned(ctx, sessionId, binding);
      next();
    } catch (error) {
      writeError(res, error);
    }
  };
}

/** 모든 owner·project 의 데이터를 집계·변경하는 운영 경로. 바인딩 토큰은 쓸 수 없다. */
export const operatorOnly: RequestHandler = (req, res, next) => {
  if (!isBoundToken(req)) return next();
  writeError(res, forbidden('This endpoint spans all agents and projects and is not available to a bound API token.'));
};

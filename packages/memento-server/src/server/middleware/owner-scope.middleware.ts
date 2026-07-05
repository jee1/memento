/**
 * HTTP owner scope enforcement for /tools/recall and /tools/memory_injection (Issue #664)
 */

import type { Request, Response, NextFunction } from 'express';
import { logger, mementoConfig } from '@memento/core';

const OWNER_SCOPED_TOOL_PATHS = new Set(['/recall', '/memory_injection']);

function hasOwnerIdInBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const ownerId = (body as Record<string, unknown>).owner_id;
  if (ownerId === undefined || ownerId === null) {
    return false;
  }
  if (typeof ownerId === 'string') {
    return ownerId.trim() !== '';
  }
  if (Array.isArray(ownerId)) {
    return ownerId.some(value => typeof value === 'string' && value.trim() !== '');
  }
  return false;
}

function isOwnerScopedToolRequest(req: Request): boolean {
  return req.method === 'POST' && OWNER_SCOPED_TOOL_PATHS.has(req.path);
}

/**
 * strict: owner_id 미지정 시 agentId로 자동 필터; agentId 없으면 400
 * warn: 경고 로그 후 레거시(전체) 조회 허용
 * off: 강제 없음
 */
export function createOwnerScopeMiddleware() {
  return function ownerScopeMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!isOwnerScopedToolRequest(req)) {
      next();
      return;
    }

    const mode = mementoConfig.ownerScopeMode;
    if (mode === 'off') {
      next();
      return;
    }

    if (hasOwnerIdInBody(req.body)) {
      next();
      return;
    }

    const agentId = req.toolContext?.agentId;
    if (agentId) {
      if (!req.body || typeof req.body !== 'object') {
        req.body = { owner_id: agentId };
      } else {
        (req.body as Record<string, unknown>).owner_id = agentId;
      }
      next();
      return;
    }

    if (mode === 'strict') {
      res.status(400).json({
        error: 'Owner scope required',
        message:
          'MEMENTO_OWNER_SCOPE_MODE=strict: recall/memory_injection requires X-Memento-Agent-Id header, ' +
          'MEMENTO_HTTP_DEFAULT_AGENT_ID, or explicit owner_id in the request body.'
      });
      return;
    }

    logger.warn('HTTP owner scope: recall/memory_injection without owner_id or agentId (legacy behavior)', {
      path: req.path,
      mode
    });
    next();
  };
}

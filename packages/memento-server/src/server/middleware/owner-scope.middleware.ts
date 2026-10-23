/**
 * HTTP owner scope enforcement for tools in OWNER_FILTER_TOOLS (Issue #664, #1452)
 */

import type { Request, Response, NextFunction } from 'express';
import { logger, mementoConfig } from '@memento/core';
import { OWNER_FILTER_TOOLS } from '../owner-filter-tools.js';

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
  if (req.method !== 'POST') {
    return false;
  }
  const toolName = req.path.replace(/^\/+|\/+$/g, '');
  return OWNER_FILTER_TOOLS.has(toolName);
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

    const agentId = req.callerAgentId;
    if (agentId) {
      if (!req.body || typeof req.body !== 'object') {
        req.body = { owner_id: agentId };
      } else {
        (req.body as Record<string, unknown>).owner_id = agentId;
      }
      next();
      return;
    }

    const targetTools = Array.from(OWNER_FILTER_TOOLS).join('/');
    if (mode === 'strict') {
      res.status(400).json({
        error: 'Owner scope required',
        message:
          `MEMENTO_OWNER_SCOPE_MODE=strict: ${targetTools} requires X-Memento-Agent-Id header, ` +
          'MEMENTO_HTTP_DEFAULT_AGENT_ID, or explicit owner_id in the request body.'
      });
      return;
    }

    logger.warn(`HTTP owner scope: ${targetTools} without owner_id or agentId (legacy behavior)`, {
      path: req.path,
      mode
    });
    next();
  };
}

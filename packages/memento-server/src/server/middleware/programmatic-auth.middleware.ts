import type { ApiScope } from '@memento/core';
import type { NextFunction, Request, Response } from 'express';

import {
  hasScope,
  type ApiTokenRegistry,
} from '../auth/api-token-registry.js';

declare global {
  namespace Express {
    interface Request {
      programmaticAuth?: {
        keyId: string;
        scopes: ApiScope[];
      };
    }
  }
}

export type ProgrammaticAuthMiddlewareConfig = {
  registry: ApiTokenRegistry;
  requiredScope: ApiScope | ApiScope[];
  errorFormat?: 'legacy' | 'agent';
};

function writeDisabledResponse(
  res: Response,
  format: ProgrammaticAuthMiddlewareConfig['errorFormat'],
): void {
  if (format === 'agent') {
    res.status(401).json({
      status: 401,
      reason_code: 'AUTH_FAILED',
      message: 'Programmatic API is disabled: no API tokens are configured.',
      retryable: false,
    });
    return;
  }
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Programmatic API is disabled: configure MEMENTO_API_TOKENS or ADMIN_API_KEY.',
    timestamp: new Date().toISOString(),
  });
}

function writeUnauthorized(
  res: Response,
  format: ProgrammaticAuthMiddlewareConfig['errorFormat'],
): void {
  if (format === 'agent') {
    res.status(401).json({
      status: 401,
      reason_code: 'AUTH_FAILED',
      message: 'Programmatic routes require Authorization: Bearer <key> or X-API-Key.',
      retryable: false,
    });
    return;
  }
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Programmatic routes require Authorization: Bearer <key> or X-API-Key.',
    timestamp: new Date().toISOString(),
  });
}

function writeForbidden(
  res: Response,
  requiredScope: ApiScope | ApiScope[],
  format: ProgrammaticAuthMiddlewareConfig['errorFormat'],
): void {
  const required = Array.isArray(requiredScope) ? requiredScope.join(', ') : requiredScope;
  if (format === 'agent') {
    res.status(403).json({
      status: 403,
      reason_code: 'FORBIDDEN',
      message: `Insufficient API token scope. Required: ${required}.`,
      retryable: false,
    });
    return;
  }
  res.status(403).json({
    error: 'Forbidden',
    message: `Insufficient API token scope. Required: ${required}.`,
    timestamp: new Date().toISOString(),
  });
}

function readBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token === '' ? null : token;
}

function readApiKeyHeader(req: Request): string | null {
  const apiKeyHeader = req.headers['x-api-key'];
  if (typeof apiKeyHeader !== 'string') {
    return null;
  }

  const value = apiKeyHeader.trim();
  return value === '' ? null : value;
}

function resolveAuthenticatedToken(
  req: Request,
  registry: ApiTokenRegistry,
): ReturnType<ApiTokenRegistry['resolveToken']> {
  const bearerToken = readBearerToken(req);
  if (bearerToken) {
    const resolved = registry.resolveToken(bearerToken);
    if (resolved) {
      return resolved;
    }
  }

  const apiKeyHeader = readApiKeyHeader(req);
  if (apiKeyHeader) {
    return registry.resolveToken(apiKeyHeader);
  }

  return null;
}

export function createProgrammaticAuthMiddleware(config: ProgrammaticAuthMiddlewareConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.registry.hasConfiguredTokens()) {
      writeDisabledResponse(res, config.errorFormat);
      return;
    }

    const hasCredential = readBearerToken(req) !== null || readApiKeyHeader(req) !== null;
    if (!hasCredential) {
      writeUnauthorized(res, config.errorFormat);
      return;
    }

    const resolved = resolveAuthenticatedToken(req, config.registry);
    if (!resolved) {
      writeUnauthorized(res, config.errorFormat);
      return;
    }

    if (!hasScope(resolved.scopes, config.requiredScope)) {
      writeForbidden(res, config.requiredScope, config.errorFormat);
      return;
    }

    req.programmaticAuth = {
      keyId: resolved.id,
      scopes: [...resolved.scopes],
    };
    next();
  };
}

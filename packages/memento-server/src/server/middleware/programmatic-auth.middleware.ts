import type { NextFunction, Request, Response } from 'express';

export type ProgrammaticAuthMiddlewareConfig = {
  expectedKey: string | undefined | null;
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
      message: 'Programmatic API is disabled: ADMIN_API_KEY is not configured.',
      retryable: false,
    });
    return;
  }
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Programmatic API is disabled: ADMIN_API_KEY is not configured.',
    timestamp: new Date().toISOString()
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
    timestamp: new Date().toISOString()
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

export function createProgrammaticAuthMiddleware(config: ProgrammaticAuthMiddlewareConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const expectedKey = config.expectedKey?.trim();
    if (!expectedKey) {
      writeDisabledResponse(res, config.errorFormat);
      return;
    }

    const bearerToken = readBearerToken(req);
    if (bearerToken === expectedKey) {
      next();
      return;
    }

    const apiKeyHeader = readApiKeyHeader(req);
    if (apiKeyHeader === expectedKey) {
      next();
      return;
    }

    writeUnauthorized(res, config.errorFormat);
  };
}

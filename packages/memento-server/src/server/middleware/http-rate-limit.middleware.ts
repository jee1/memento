import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { type Options as RateLimitOptions } from 'express-rate-limit';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export function isHttpRateLimitDisabled(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.MEMENTO_HTTP_RATE_LIMIT_DISABLED === '1';
}

function parseRateLimitMax(envValue: string | undefined, defaultMax: number): number {
  if (!envValue?.trim()) {
    return defaultMax;
  }

  const parsed = Number.parseInt(envValue.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMax;
}

function createRateLimitHandler(bucket: 'tools' | 'admin'): NonNullable<RateLimitOptions['handler']> {
  return (_req, res, _next, options) => {
    const retryAfterSeconds = Math.max(1, Math.ceil(options.windowMs / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded for ${bucket} routes. Retry after ${retryAfterSeconds} seconds.`,
      retry_after_seconds: retryAfterSeconds,
      timestamp: new Date().toISOString(),
    });
  };
}

function createBucketRateLimitMiddleware(
  bucket: 'tools' | 'admin',
  defaultMax: number,
  envKey: 'MEMENTO_HTTP_RATE_LIMIT_TOOLS' | 'MEMENTO_HTTP_RATE_LIMIT_ADMIN',
): RequestHandler {
  if (isHttpRateLimitDisabled()) {
    return (_req: Request, _res: Response, next: NextFunction) => {
      next();
    };
  }

  const max = parseRateLimitMax(process.env[envKey], defaultMax);

  return rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: createRateLimitHandler(bucket),
  });
}

export function createToolsRateLimitMiddleware(): RequestHandler {
  return createBucketRateLimitMiddleware('tools', 100, 'MEMENTO_HTTP_RATE_LIMIT_TOOLS');
}

export function createAdminRateLimitMiddleware(): RequestHandler {
  return createBucketRateLimitMiddleware('admin', 30, 'MEMENTO_HTTP_RATE_LIMIT_ADMIN');
}

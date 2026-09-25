import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { type Options as RateLimitOptions } from 'express-rate-limit';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Issue #1158: the dashboard fans a single page view out over many GET /admin/*
 * calls (status, batch stats/runs/logs, review candidates, graph, embedding map…),
 * so reads and writes cannot share one budget — otherwise browsing exhausts it and
 * the operator can no longer trigger a job.
 */
const ADMIN_READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type RateLimitBucket = 'tools' | 'admin' | 'admin_read';

type RateLimitEnvKey =
  | 'MEMENTO_HTTP_RATE_LIMIT_TOOLS'
  | 'MEMENTO_HTTP_RATE_LIMIT_ADMIN'
  | 'MEMENTO_HTTP_RATE_LIMIT_ADMIN_READ';

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

function createRateLimitHandler(bucket: RateLimitBucket): NonNullable<RateLimitOptions['handler']> {
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
  bucket: RateLimitBucket,
  defaultMax: number,
  envKey: RateLimitEnvKey,
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

/**
 * Admin routes use two independent buckets keyed by HTTP method (#1158):
 * reads get a dashboard-sized budget, writes keep the tighter one.
 */
export function createAdminRateLimitMiddleware(): RequestHandler {
  if (isHttpRateLimitDisabled()) {
    return (_req: Request, _res: Response, next: NextFunction) => {
      next();
    };
  }

  const readLimit = createBucketRateLimitMiddleware(
    'admin_read',
    300,
    'MEMENTO_HTTP_RATE_LIMIT_ADMIN_READ',
  );
  const writeLimit = createBucketRateLimitMiddleware('admin', 30, 'MEMENTO_HTTP_RATE_LIMIT_ADMIN');

  return (req: Request, res: Response, next: NextFunction) => {
    const limiter = ADMIN_READ_METHODS.has(req.method) ? readLimit : writeLimit;
    limiter(req, res, next);
  };
}

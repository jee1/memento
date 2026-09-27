import { createHash } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator, type Options as RateLimitOptions } from 'express-rate-limit';

import { readAuthCredential } from './http-audit.middleware.js';
import { DASHBOARD_SESSION_COOKIE_NAME, readCookie } from './session-auth.middleware.js';

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

function hashIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/**
 * Issue #1161: express-rate-limit 의 기본 키는 `req.ip` 하나다. Docker 포트 퍼블리싱이나
 * 리버스 프록시 뒤에서는 모든 클라이언트가 같은 출발지로 보여 서버 전체가 버킷 1개가 된다
 * (한 브라우저 탭이 예산을 태우면 다른 기기까지 429).
 *
 * 그래서 이미 있는 신원 정보를 먼저 쓴다 — 우선순위는 감사 로그(`resolveHttpAuditKeyId`)와
 * 같지만, 브라우저 세션은 `'session'` 상수로 뭉치지 않고 **세션 id 해시**까지 내려간다.
 * 서로 다른 세션은 독립 예산을, 같은 세션의 여러 탭은 한 예산을 쓴다.
 *
 * rate limit 은 인증 **앞**에 있으므로(무인증 폭주 차단) `req.programmaticAuth` 가 아직
 * 없는 경우가 많다. 자격증명 원문에서 직접 키를 만들되 해시만 저장한다.
 */
export function resolveRateLimitKey(req: Request): string {
  const programmaticKeyId = req.programmaticAuth?.keyId?.trim();
  if (programmaticKeyId) {
    return `key:${programmaticKeyId}`;
  }

  const credential = readAuthCredential(req);
  if (credential) {
    return `key:${hashIdentity(credential)}`;
  }

  const sessionId = readCookie(req.headers.cookie, DASHBOARD_SESSION_COOKIE_NAME);
  if (sessionId) {
    return `session:${hashIdentity(sessionId)}`;
  }

  // 미인증 요청만 IP 로 떨어진다. `req.ip` 가 프록시 헤더를 반영할지는 `trust proxy`
  // 설정이 결정한다 — 미설정이면 X-Forwarded-For 를 무시한다 (trust-proxy.ts).
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
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
    keyGenerator: resolveRateLimitKey,
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

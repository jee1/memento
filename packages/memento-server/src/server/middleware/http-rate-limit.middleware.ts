import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator, type Options as RateLimitOptions } from 'express-rate-limit';
import { dashboardSessionIdentity } from './session-auth.middleware.js';


const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Issue #1158: the dashboard fans a single page view out over many GET /admin/*
 * calls (status, batch stats/runs/logs, review candidates, graph, embedding map…),
 * so reads and writes cannot share one budget — otherwise browsing exhausts it and
 * the operator can no longer trigger a job.
 */
const ADMIN_READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type RateLimitBucket = 'tools' | 'mcp' | 'agent' | 'admin' | 'admin_read' | 'auth_failures';

type RateLimitEnvKey =
  | 'MEMENTO_HTTP_RATE_LIMIT_TOOLS'
  | 'MEMENTO_HTTP_RATE_LIMIT_MCP'
  | 'MEMENTO_HTTP_RATE_LIMIT_AGENT'
  | 'MEMENTO_HTTP_RATE_LIMIT_ADMIN'
  | 'MEMENTO_HTTP_RATE_LIMIT_ADMIN_READ'
  | 'MEMENTO_HTTP_RATE_LIMIT_AUTH_FAILURES';

export function isHttpRateLimitDisabled(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.MEMENTO_HTTP_RATE_LIMIT_DISABLED === '1';
}

/**
 * Issue #1161: express-rate-limit 의 기본 키는 `req.ip` 하나다. Docker 포트 퍼블리싱이나
 * 리버스 프록시 뒤에서는 모든 클라이언트가 같은 출발지로 보여 서버 전체가 버킷 1개가 된다
 * (한 브라우저 탭이 예산을 태우면 다른 기기까지 429).
 *
 * 그래서 검증된 신원을 먼저 쓴다. 서로 다른 세션은 독립 예산을, 같은 세션의 여러 탭은
 * 한 예산을 쓴다. 버킷 limiter 는 인증 **뒤**에 붙는다. 검증 전 자격증명이나 쿠키로 키를
 * 만들면 추측값마다 새 버킷이 생겨 한도가 무의미해진다. 인증 실패는
 * `createAuthFailureRateLimitMiddleware` 가 IP 로 센다.
 */
function resolveRateLimitKey(req: Request, res: Response): string {
  const programmaticKeyId = req.programmaticAuth?.keyId?.trim();
  if (programmaticKeyId) {
    return `key:${programmaticKeyId}`;
  }

  const sessionIdentity = dashboardSessionIdentity(res);
  if (sessionIdentity) {
    return sessionIdentity;
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
  options: Partial<RateLimitOptions> = {},
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
    ...options,
  });
}

/**
 * 인증 미들웨어 앞에 붙어 401 응답만 IP 별로 센다. 한도를 넘으면 그 IP 의 요청을 창이 끝날 때까지
 * 막는다(올바른 자격증명 포함). 막지 않으면 추측 결과가 401/200 으로 드러난다.
 */
export function createAuthFailureRateLimitMiddleware(): RequestHandler {
  return createBucketRateLimitMiddleware('auth_failures', 100, 'MEMENTO_HTTP_RATE_LIMIT_AUTH_FAILURES', {
    keyGenerator: (req) => `ip:${ipKeyGenerator(req.ip ?? '')}`,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  });
}

export function createToolsRateLimitMiddleware(): RequestHandler {
  return createBucketRateLimitMiddleware('tools', 100, 'MEMENTO_HTTP_RATE_LIMIT_TOOLS');
}

/**
 * `/mcp`·`/messages` 는 MCP 세션 하나가 initialize·tools/list·도구 호출을 모두 보내고
 * 훅이 매 턴 memory_injection 을 부르므로 `/tools` 보다 예산이 크다. 운영 audit_log 에서
 * 키당 15분 최대가 약 480건이었다(2026-09~10) — 기본값은 그 3배.
 */
export function createMcpRateLimitMiddleware(): RequestHandler {
  return createBucketRateLimitMiddleware('mcp', 1500, 'MEMENTO_HTTP_RATE_LIMIT_MCP');
}

/** `/api/v1/agent` — 세션·관찰 이벤트 수집 훅용. `/mcp` 와 예산을 나눠 훅 폭주가 MCP 를 막지 않게 한다. */
export function createAgentRateLimitMiddleware(): RequestHandler {
  return createBucketRateLimitMiddleware('agent', 600, 'MEMENTO_HTTP_RATE_LIMIT_AGENT');
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

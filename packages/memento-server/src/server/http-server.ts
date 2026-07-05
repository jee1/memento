#!/usr/bin/env node
/**
 * HTTP/WebSocket 기반 MCP 서버 v2
 * 모듈화된 구조로 새로 구현
 */

import {
  AgentContextInjectionService,
  AgentContextRecallService,
  canonicalizeHttpBindHostForListen,
  createMementoCore,
  formatHttpBindHostForUrl,
  getMementoHttpSecurityStartupViolationMessage,
  getVectorSearchEngine,
  isHttpBindHostRemotelyReachable,
  logger,
  mementoConfig,
  MementoHttpSecurityStartupError,
  SqliteHybridAgentContextSource,
  validateConfig,
  type ServerServices,
} from '@memento/core';
import Database from 'better-sqlite3';
import cors from 'cors';
import express from 'express';
import { existsSync, readFileSync } from 'fs';
import helmet from 'helmet';
import { createServer } from 'http';
import { join } from 'path';
import {
  injectReviewQueueBootIntoDashboardHtml,
  resolveReviewQueueDashboardBootFromEnv
} from './review-queue-dashboard-boot.js';
import type { WebSocket } from 'ws';
import { WebSocketServer } from 'ws';
import packageJson from '../../package.json' with { type: 'json' };
import { resolveServerInfoConfigDir,writeServerInfo } from './server-info.js';
import { createSessionStore,type SessionStore } from './auth/session-store.js';
import { createAdminRouter } from './routes/admin.routes.js';
import { createAgentRouter } from './routes/agent.routes.js';
import { createApiRouter } from './routes/api.routes.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createMcpRouter,type SSETransport } from './routes/mcp.routes.js';
import { createQualityRouter } from './routes/quality.routes.js';
import { createToolsRouter } from './routes/tools.routes.js';
import {
createAdminAuthMiddleware,
createOwnerScopeMiddleware,
createProgrammaticAuthMiddleware,
createServiceInjector,
createSessionAuthMiddleware,
createToolContextMiddleware,
errorHandler
} from './middleware/index.js';
import {
  createRuntimeDiagnosticsWriter,
  performCleanup,
  registerCleanupHandlers,
} from './http-server-lifecycle.js';
import { setupWebSocketServer } from './http-server-websocket.js';

// 전역 변수 (서비스는 serverServices로만 접근)
let db: Database.Database | null = null;
let serverServices: ServerServices | null = null;
let adminSessionStore: SessionStore | null = null;

const transports: Record<string, SSETransport> = {};

type TestDependencies = {
  database: Database.Database | null;
  serverServices?: ServerServices | null;
  searchEngine?: ServerServices['searchEngine'];
  hybridSearchEngine?: ServerServices['hybridSearchEngine'];
  embeddingService?: ServerServices['embeddingService'];
};

function setTestDependencies(_deps: TestDependencies): void {
  db = _deps.database ?? null;
  if (_deps.serverServices !== undefined) {
    serverServices = _deps.serverServices ?? null;
  } else if (
    _deps.searchEngine != null &&
    _deps.hybridSearchEngine != null &&
    _deps.embeddingService != null
  ) {
    serverServices = {
      searchEngine: _deps.searchEngine,
      hybridSearchEngine: _deps.hybridSearchEngine,
      embeddingService: _deps.embeddingService
    } as ServerServices;
  }
}

const writeRuntimeDiagnosticsEvent = createRuntimeDiagnosticsWriter(() => serverServices);

/**
 * 정적 UI(graph.html 등) 위치 — Docker(/app/static), 로컬 모노레포 루트(./static),
 * 또는 memento-server 패키지 cwd에서 상위 탐색.
 */
function resolveStaticRoot(): string {
  const env = process.env.MEMENTO_STATIC_ROOT?.trim();
  if (env) {
    return env;
  }
  const cwd = process.cwd();
  const candidates = [join(cwd, 'static'), join(cwd, '..', 'static'), join(cwd, '..', '..', 'static')];
  for (const p of candidates) {
    const graphPath = join(p, 'graph.html');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- 모노레포·Docker에서 static/ 위치만 탐색
    if (existsSync(graphPath)) {
      return p;
    }
  }
  return join(cwd, 'static');
}

const staticRoot = resolveStaticRoot();

// Express 앱 생성
const app = express();
const server = createServer(app);

// HTTP 보안 헤더 (FR-005/FR-006): 모든 응답에 OWASP 최소 보안 헤더 추가
// D3.js CDN(d3js.org)은 dashboard.html 및 graph.html에서 사용하므로 CSP에서 허용
// frameguard: 대시보드가 동일 출처에서 /graph 를 iframe으로 포함하므로 SAMEORIGIN (외부 도메인 임베드 방지)
// frame-src: dashboard.html 의 Memory Graph 탭 iframe 허용
app.use(helmet({
  frameguard: { action: 'sameorigin' },
  referrerPolicy: { policy: 'no-referrer' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://d3js.org'],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'"]
    }
  }
}));

// 미들웨어 설정: CORS는 corsAllowedOrigins로 제한 (비어 있으면 크로스 오리진 미허용)
const corsOrigins = mementoConfig.corsAllowedOrigins;
app.use(cors({
  origin: corsOrigins.length > 0
    ? corsOrigins
    : (_orig: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => cb(null, false),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-API-Key']
}));
// DoS 완화: body 제한 1MB (리뷰 S4). 운영 시 rate limiting(예: express-rate-limit) 적용 권장.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Static 파일 서빙 (대시보드 및 UI 리소스)
app.use('/static', express.static(staticRoot));

// 기본 API 엔드포인트
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: mementoConfig.serverName,
    version: mementoConfig.serverVersion,
    database: db ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// WebSocket 클라이언트 관리 (Anchor Map 업데이트용)
const anchorMapSubscribers = new Map<string, Set<WebSocket>>();

// 라우터 등록 (서비스 초기화 후 업데이트됨)
let toolsRouter: express.Router | null = null;
let adminRouter: express.Router | null = null;
let apiRouter: express.Router | null = null;
let mcpRouter: express.Router | null = null;
let authRouter: express.Router | null = null;

const DASHBOARD_SESSION_COOKIE_NAME = 'memento_admin_session';
const DASHBOARD_SESSION_IDLE_TTL_MS = 15 * 60 * 1000;
const DASHBOARD_SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;

const HTTP_AUTH_TRUST_MODEL_NOTICE =
  'HTTP trust model: /auth/session starts the browser-session cookie flow; /admin and /api require a browser session; /api/v1/quality, /api/v1/agent, /tools, /mcp, and /messages require Authorization Bearer or X-API-Key.';
const HTTP_AUTH_MISSING_ADMIN_KEY_WARNING =
  'ADMIN_API_KEY is not configured: /api/v1/quality, /api/v1/agent, /tools, /mcp, and /messages fail closed with 401 until ADMIN_API_KEY is set.';

function isProtectedMcpProgrammaticPath(pathname: string): boolean {
  return /^\/(?:mcp|messages)\/?$/.test(pathname);
}

export function getHttpAuthTrustModelNotice(): string {
  return HTTP_AUTH_TRUST_MODEL_NOTICE;
}

export function getHttpAuthMissingAdminKeyWarning(): string {
  return HTTP_AUTH_MISSING_ADMIN_KEY_WARNING;
}

// 대시보드 라우트: Review Queue 폴링 부트를 환경 변수 기준으로 인라인 주입 (#274)
app.get('/dashboard', (req, res) => {
  const dashboardPath = join(staticRoot, 'dashboard.html');
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- staticRoot 하위 고정 파일 dashboard.html
    const raw = readFileSync(dashboardPath, 'utf8');
    const boot = resolveReviewQueueDashboardBootFromEnv();
    const html = injectReviewQueueBootIntoDashboardHtml(raw, boot);
    res.type('html').send(html);
  } catch (err) {
    logger.error('대시보드 파일 로드 실패', { error: err });
    res.status(404).send('Dashboard not found');
  }
});

// 기억 관계 그래프 뷰 (009-memory-graph-view)
app.get('/graph', (req, res) => {
  res.sendFile('graph.html', { root: staticRoot }, (err) => {
    if (err) {
      logger.error('그래프 파일 로드 실패', { error: err });
      res.status(404).send('Graph view not found');
    }
  });
});

async function initializeCoreServices(): Promise<void> {
  if (!db || !serverServices) {
    const core = await createMementoCore({
      dbPath: process.env.DB_PATH ?? mementoConfig.dbPath
    });
    db = core.db;
    serverServices = core.services;
  }
}

function setupMiddleware(): void {
  getVectorSearchEngine().initialize(db!);
  app.use(createServiceInjector(serverServices!, db!));
  adminSessionStore = createSessionStore({
    idleTtlMs: DASHBOARD_SESSION_IDLE_TTL_MS,
    absoluteTtlMs: DASHBOARD_SESSION_ABSOLUTE_TTL_MS
  });
}

function createContextInjectionService(): AgentContextInjectionService {
  const injectionTimeoutMs = Number(process.env.MEMENTO_AGENT_INJECTION_TIMEOUT_MS);
  return new AgentContextInjectionService({
    recallService: new AgentContextRecallService({
      sources: [
        new SqliteHybridAgentContextSource({
          db: db!,
          hybridSearchEngine: serverServices!.hybridSearchEngine,
        }),
      ],
    }),
    timeoutMs: Number.isFinite(injectionTimeoutMs) ? injectionTimeoutMs : undefined,
  });
}

function createAllRouters(): void {
  const retentionDays = Number(process.env.MEMENTO_AGENT_OBSERVATION_RETENTION_DAYS);
  const abandonedTtlMs = Number(process.env.MEMENTO_AGENT_SESSION_ABANDONED_TTL_MS);
  const initialInjectionTokenBudget = Number(process.env.MEMENTO_AGENT_INITIAL_INJECTION_TOKEN_BUDGET);

  toolsRouter = createToolsRouter(db!, serverServices!, anchorMapSubscribers);
  adminRouter = createAdminRouter(db!, serverServices!);
  apiRouter = createApiRouter(db!, serverServices!);
  authRouter = createAuthRouter({
    expectedKey: mementoConfig.adminApiKey,
    store: adminSessionStore!,
    cookieName: DASHBOARD_SESSION_COOKIE_NAME,
    secureCookie: process.env.NODE_ENV === 'production'
  });
  mcpRouter = createMcpRouter(db!, serverServices!, transports);

  const qualityRouter = createQualityRouter(db!);
  const agentRouter = createAgentRouter(db!, {
    retentionDays: Number.isFinite(retentionDays) ? retentionDays : undefined,
    abandonedTtlMs: Number.isFinite(abandonedTtlMs) ? abandonedTtlMs : undefined,
    contextInjectionService: createContextInjectionService(),
    initialInjectionTokenBudget: Number.isFinite(initialInjectionTokenBudget) ? initialInjectionTokenBudget : undefined,
    serverServices: serverServices!,
  });

  registerRoutes(qualityRouter, agentRouter);
}

function registerRoutes(qualityRouter: express.Router, agentRouter: express.Router): void {
  const browserSessionAuth = createSessionAuthMiddleware({
    store: adminSessionStore!,
    cookieName: DASHBOARD_SESSION_COOKIE_NAME
  });
  const adminAuth = createAdminAuthMiddleware();
  const programmaticAuth = createProgrammaticAuthMiddleware({ expectedKey: mementoConfig.adminApiKey });
  const ownerScopeMiddleware = createOwnerScopeMiddleware();
  const agentProgrammaticAuth = createProgrammaticAuthMiddleware({
    expectedKey: mementoConfig.adminApiKey,
    errorFormat: 'agent',
  });
  const mcpProgrammaticAuth: express.RequestHandler = (req, res, next) => {
    if (req.method === 'OPTIONS') return void next();
    if (isProtectedMcpProgrammaticPath(req.path)) return void programmaticAuth(req, res, next);
    next();
  };

  app.use('/tools', programmaticAuth, createToolContextMiddleware, ownerScopeMiddleware, toolsRouter!);
  app.use('/auth', authRouter!);
  app.use('/admin', browserSessionAuth, adminRouter!);
  app.use('/api/v1/quality', adminAuth, qualityRouter, (_req, res) => {
    res.status(404).json({ error: 'Not Found', message: 'Quality API route not found.' });
  });
  app.use('/api/v1/agent', agentProgrammaticAuth, agentRouter);
  app.use('/api', browserSessionAuth, apiRouter!);
  app.use('/', mcpProgrammaticAuth, mcpRouter!);
  app.use(errorHandler);
}

function logEmbeddingProviderInfo(): void {
  const providerInfo: Record<string, unknown> = {
    provider: mementoConfig.embeddingProvider.toUpperCase()
  };
  if (mementoConfig.embeddingProvider === 'openai' && mementoConfig.openaiApiKey) {
    providerInfo.model = mementoConfig.openaiModel;
    providerInfo.dimensions = mementoConfig.embeddingDimensions;
  } else if (mementoConfig.embeddingProvider === 'gemini' && mementoConfig.geminiApiKey) {
    providerInfo.model = mementoConfig.geminiModel;
    providerInfo.dimensions = mementoConfig.embeddingDimensions;
  } else if (mementoConfig.embeddingProvider === 'lightweight') {
    providerInfo.model = 'lightweight-hybrid';
    providerInfo.dimensions = 512;
  }
  logger.info('임베딩 프로바이더 설정', providerInfo);
}

async function initializeServer() {
  try {
    logger.info('Memento HTTP/WebSocket MCP Server 시작', { version: packageJson.version });
    logger.info('HTTP/WebSocket MCP 서버 v2 시작 중');

    await initializeCoreServices();
    setupMiddleware();
    createAllRouters();

    logger.info('서비스 초기화 완료');
    await writeRuntimeDiagnosticsEvent('server_start');

    logEmbeddingProviderInfo();
    logger.info('서버 초기화 완료', {
      server: mementoConfig.serverName,
      version: mementoConfig.serverVersion,
      database: mementoConfig.dbPath
    });
  } catch (error) {
    logger.error('서버 초기화 실패', { error });
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function cleanup() {
  await performCleanup({
    getDb: () => db,
    setDb: (v) => { db = v; },
    getServerServices: () => serverServices,
    setServerServices: (v) => { serverServices = v; },
    writeDiagnostics: writeRuntimeDiagnosticsEvent,
  });
}

// WebSocket 서버 설정
const wss = new WebSocketServer({ server });
setupWebSocketServer(wss, anchorMapSubscribers, () => db, () => serverServices);

// 서버 시작
export async function startServer() {
  // DB·스케줄러 기동 전에 설정·보안 정책을 검사해 실패 시 리소스가 남지 않게 한다.
  validateConfig();

  const PORT = mementoConfig.port || 9001;
  const bindHostRaw = (mementoConfig.httpListenHost || '127.0.0.1').trim();
  const bindHostListen = canonicalizeHttpBindHostForListen(bindHostRaw);
  const bindHostForUrl = formatHttpBindHostForUrl(bindHostRaw);

  const securityViolation = getMementoHttpSecurityStartupViolationMessage({
    httpListenHost: bindHostRaw,
    adminApiKey: mementoConfig.adminApiKey,
    allowInsecureHttpAdmin: mementoConfig.allowInsecureHttpAdmin
  });
  if (securityViolation) {
    logger.error(securityViolation);
    throw new MementoHttpSecurityStartupError(securityViolation);
  }
  if (
    mementoConfig.allowInsecureHttpAdmin &&
    isHttpBindHostRemotelyReachable(bindHostRaw)
  ) {
    logger.warn(
      'MEMENTO_ALLOW_INSECURE_HTTP_ADMIN=true: Server is allowed to bind on a non-loopback address without ADMIN_API_KEY. Note: /admin and /api still require a browser session, and /api/v1/quality, /api/v1/agent, /tools, /mcp, and /messages still return 401 unless ADMIN_API_KEY is set (fail-closed). Do not use in production.'
    );
  }

  // FR-003: ADMIN_API_KEY 미설정 시 경고 (loopback 포함 항상 emit)
  const adminKey = mementoConfig.adminApiKey;
  if (!adminKey || adminKey.trim() === '') {
    logger.warn(getHttpAuthMissingAdminKeyWarning());
  } else if ([...adminKey].some((char) => char.charCodeAt(0) > 0x7f)) {
    logger.warn(
      'ADMIN_API_KEY contains non-ASCII characters: browser-based dashboard sign-in or programmatic clients may fail to send Authorization reliably (use ASCII-only keys, e.g. hex or base64url).'
    );
  }

  logger.info(getHttpAuthTrustModelNotice());

  try {
    await initializeServer();
  } catch (error) {
    logger.error('서버 초기화 실패 — 리소스 정리 시도', { error });
    await cleanup();
    throw error instanceof Error ? error : new Error(String(error));
  }

  // 정리 핸들러 등록 (초기화 성공 후)
  registerCleanupHandlers(cleanup, writeRuntimeDiagnosticsEvent);

  // 이미 리스닝 중이면 먼저 종료
  if (server.listening) {
    logger.warn('서버가 이미 리스닝 중입니다. 종료 후 재시작합니다');
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  server.listen(Number(PORT), bindHostListen, () => {
    logger.info('서버 시작 완료', {
      http: `http://${bindHostForUrl}:${PORT}`,
      websocket: `ws://${bindHostForUrl}:${PORT}`,
      api_docs: `http://${bindHostForUrl}:${PORT}/tools`,
      health: `http://${bindHostForUrl}:${PORT}/health`
    });
  });

  server.on('listening', () => {
    const address = server.address();
    if (address && typeof address === 'object') {
      logger.info('서버 바인딩 완료', { address: address.address, port: address.port });
      const configDir = resolveServerInfoConfigDir();
      void writeServerInfo(configDir, address.port).catch((error) => {
        logger.error('server.json 기록 실패', {
          error: error instanceof Error ? error.message : String(error),
          configDir,
        });
      });
    }
  });
}

export const __test: {
  setTestDependencies: (deps: TestDependencies) => void;
  initializeServer: () => Promise<void>;
  getApp: () => express.Application;
  getServer: () => typeof server;
  getDatabase: () => Database.Database | null;
  getSearchEngine: () => ServerServices['searchEngine'];
  getHybridSearchEngine: () => ServerServices['hybridSearchEngine'];
  getEmbeddingService: () => ServerServices['embeddingService'];
  isProtectedMcpProgrammaticPath: (pathname: string) => boolean;
} = {
  setTestDependencies,
  initializeServer,
  getApp: () => app,
  getServer: () => server,
  getDatabase: () => db,
  getSearchEngine: () => serverServices!.searchEngine,
  getHybridSearchEngine: () => serverServices!.hybridSearchEngine,
  getEmbeddingService: () => serverServices!.embeddingService,
  isProtectedMcpProgrammaticPath
};

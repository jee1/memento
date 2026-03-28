#!/usr/bin/env node
/**
 * HTTP/WebSocket 기반 MCP 서버 v2
 * 모듈화된 구조로 새로 구현
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import cors from 'cors';
import { createServer } from 'http';
import {
  createMementoCore,
  closeDatabase,
  createToolContext,
  getToolRegistry,
  type ServerServices as CoreServerServices,
  mementoConfig,
  validateConfig,
  getVectorSearchEngine,
  getBatchScheduler,
  logger,
  getMementoHttpSecurityStartupViolationMessage,
  isHttpBindHostRemotelyReachable,
  canonicalizeHttpBindHostForListen,
  formatHttpBindHostForUrl,
  MementoHttpSecurityStartupError
} from '@memento/core';
import type { ServerServices as LocalServerServices } from './bootstrap.js';
import Database from 'better-sqlite3';
import packageJson from '../../package.json' with { type: 'json' };
// Phase 1.2: 라우터 import
import { createToolsRouter } from './routes/tools.routes.js';
import { createAdminRouter } from './routes/admin.routes.js';
import { createApiRouter } from './routes/api.routes.js';
import { createMcpRouter, type SSETransport } from './routes/mcp.routes.js';
import { createQualityRouter } from './routes/quality.routes.js';
// Phase 0: 공통 미들웨어 import
import { createServiceInjector, createToolContextMiddleware, createAdminAuthMiddleware, errorHandler } from './middleware/index.js';

// 전역 변수 (서비스는 serverServices로만 접근)
let db: Database.Database | null = null;
let serverServices: CoreServerServices | null = null;

// Phase 1.2: 라우터에서 사용할 전역 변수들
// SSE Transport 저장소 (MCP 라우터용)
const transports: Record<string, SSETransport> = {};

type TestDependencies = {
  database: Database.Database | null;
  serverServices?: CoreServerServices | null;
  searchEngine?: CoreServerServices['searchEngine'];
  hybridSearchEngine?: CoreServerServices['hybridSearchEngine'];
  embeddingService?: CoreServerServices['embeddingService'];
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
    } as CoreServerServices;
  }
}

// Express 앱 생성
const app = express();
const server = createServer(app);

// 미들웨어 설정: CORS는 corsAllowedOrigins로 제한 (비어 있으면 크로스 오리진 미허용)
const corsOrigins = mementoConfig.corsAllowedOrigins;
app.use(cors({
  origin: corsOrigins.length > 0
    ? corsOrigins
    : (_orig: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => cb(null, false),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
}));
// DoS 완화: body 제한 1MB (리뷰 S4). 운영 시 rate limiting(예: express-rate-limit) 적용 권장.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Static 파일 서빙 (대시보드 및 UI 리소스)
app.use('/static', express.static('static'));

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

// Phase 1.2: 라우터 등록
// WebSocket 클라이언트 관리 (Anchor Map 업데이트용) - 라우터에서도 사용
const anchorMapSubscribers = new Map<string, Set<WebSocket>>(); // agent_id -> WebSocket Set

// 라우터 등록 (서비스 초기화 후 업데이트됨)
let toolsRouter: express.Router | null = null;
let adminRouter: express.Router | null = null;
let apiRouter: express.Router | null = null;
let mcpRouter: express.Router | null = null;

// Phase 1.2: 기존 엔드포인트는 모두 라우터로 이동됨
// 주석 처리된 기존 코드는 제거됨 (tools.routes.ts, admin.routes.ts, api.routes.ts, mcp.routes.ts로 이동)

// 대시보드 라우트 (정적 파일 서빙)
app.get('/dashboard', (req, res) => {
  res.sendFile('dashboard.html', { root: 'static' }, (err) => {
    if (err) {
      logger.error('대시보드 파일 로드 실패', { error: err });
      res.status(404).send('Dashboard not found');
    }
  });
});

// Phase 1.2: 기존 엔드포인트는 모두 라우터로 이동됨
// 주석 처리된 코드는 제거됨 (tools.routes.ts, admin.routes.ts, api.routes.ts, mcp.routes.ts로 이동)
// 서버 초기화
async function initializeServer() {
  try {
    logger.info('Memento HTTP/WebSocket MCP Server 시작', { version: packageJson.version });
    logger.info('HTTP/WebSocket MCP 서버 v2 시작 중');

    // @memento/core로 DB·서비스 초기화
    const core = await createMementoCore({
      dbPath: process.env.DB_PATH ?? mementoConfig.dbPath
    });
    db = core.db;
    const services = core.services;

    serverServices = services;

    // Vector Search Engine 초기화 (HTTP 서버 전용)
    const vectorSearchEngine = getVectorSearchEngine();
    vectorSearchEngine.initialize(db);

    const localServices = serverServices as unknown as LocalServerServices;

    // Phase 0: 공통 미들웨어 적용
    // 서비스 주입 미들웨어 (모든 라우터에 적용)
    app.use(createServiceInjector(localServices, db));

    // Phase 1.2: 라우터 초기화 및 등록
    toolsRouter = createToolsRouter(db, localServices, anchorMapSubscribers);
    adminRouter = createAdminRouter(db, localServices);
    apiRouter = createApiRouter(db, localServices);
    mcpRouter = createMcpRouter(db, localServices, transports);
    const qualityRouter = createQualityRouter(db);
    
    // 라우터 등록 (Admin/API/Quality는 ADMIN_API_KEY 설정 시 API 키 인증 적용)
    const adminAuth = createAdminAuthMiddleware();
    app.use('/tools', createToolContextMiddleware, toolsRouter);
    app.use('/admin', adminAuth, adminRouter);
    app.use('/api', adminAuth, apiRouter);
    app.use('/api/v1/quality', adminAuth, qualityRouter);
    app.use('/', mcpRouter); // /mcp, /messages는 루트에 등록
    
    // Phase 0: 공통 에러 핸들러 미들웨어 (모든 라우터 이후에 적용)
    app.use(errorHandler);
    
    logger.info('서비스 초기화 완료');
    // 배치 스케줄러는 core bootstrap에서 이미 시작됨 (services.batchScheduler)

    // 임베딩 프로바이더 정보 표시
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

// 정리 함수
let isCleaningUp = false;
async function cleanup() {
  if (isCleaningUp) {
    return;
  }
  
  isCleaningUp = true;
  
  try {
    // WAL 체크포인트 스케줄러 및 데이터베이스 락 모니터 중지
    if (serverServices) {
      try {
        await serverServices.walCheckpointScheduler.stop();
        logger.info('WAL 체크포인트 스케줄러 중지됨');
      } catch (error) {
        logger.error('WAL 체크포인트 스케줄러 중지 실패', { error });
      }
      
      try {
        serverServices.databaseLockMonitor.stop();
        logger.info('데이터베이스 락 모니터 중지됨');
      } catch (error) {
        logger.error('데이터베이스 락 모니터 중지 실패', { error });
      }
    }
    
    // Write Coalescing Manager 정리
    if (serverServices?.writeCoalescingManager) {
      await serverServices.writeCoalescingManager.flush();
      await serverServices.writeCoalescingManager.destroy();
      logger.info('Write Coalescing Manager 정리 완료');
    }
    
    // 배치 스케줄러 중지
    const batchScheduler = getBatchScheduler();
    await batchScheduler.stop();
    logger.info('배치 스케줄러 중지됨');
    
    if (db) {
      closeDatabase(db);
      db = null;
    }
    serverServices = null;
    logger.info('HTTP/WebSocket MCP 서버 v2 종료');
  } catch (error) {
    logger.error('정리 중 오류', { error });
  } finally {
    isCleaningUp = false;
  }
}

// 프로세스 종료 시 정리
let cleanupRegistered = false;
function registerCleanupHandlers() {
  if (cleanupRegistered) {
    return;
  }
  
  cleanupRegistered = true;
  
  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });
  
  process.on('uncaughtException', async (error) => {
    logger.error('예상치 못한 오류', { error });
    await cleanup();
    process.exit(1);
  });
}

// WebSocket 서버 설정
const wss = new WebSocketServer({ server });

// Phase 1.2: anchorMapSubscribers는 위에서 이미 선언됨

wss.on('connection', (ws: WebSocket) => {
  logger.info('WebSocket 클라이언트 연결됨');
  
  ws.on('message', async (data) => {
    // WebSocket 메시지 타입 정의
    interface WebSocketMessage {
      method?: string;
      params?: Record<string, unknown>;
      id?: string | number;
      [key: string]: unknown; // 기타 필드 허용
    }
    
    let message: WebSocketMessage;
    try {
      message = JSON.parse(data.toString()) as WebSocketMessage;
      
      // Anchor Map 업데이트 구독 처리
      if (message.method === 'subscribe' && message.params?.type === 'anchor_map_updates') {
        const agentId = typeof message.params.agent_id === 'string' ? message.params.agent_id : 'default';
        
        if (!anchorMapSubscribers.has(agentId)) {
          anchorMapSubscribers.set(agentId, new Set<WebSocket>());
        }
        anchorMapSubscribers.get(agentId)!.add(ws);
        
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { subscribed: true, agent_id: agentId }
        }));
        
        logger.info('Anchor Map 업데이트 구독', { agent_id: agentId });
        return;
      }
      
      // Keep-alive ping/pong 처리
      if (message.type === 'pong') {
        return; // ping 응답만 처리
      }
      
      if (message.method === 'tools/list') {
        const toolRegistry = getToolRegistry();
        const tools = toolRegistry.getAll();
        
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { tools }
        }));
      } else if (message.method === 'tools/call') {
        // params가 Record<string, unknown>이므로 타입 단언 필요
        const params = message.params as { name?: string; arguments?: unknown } | undefined;
        const name = params?.name;
        const args = params?.arguments;
        
        if (!name) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32602,
              message: 'Invalid params',
              data: 'name parameter is required'
            }
          }));
          return;
        }
        
        const toolRegistry = getToolRegistry();
        
        // 부트스트랩에서 초기화된 서비스 객체를 사용하여 ToolContext 생성
        if (!serverServices) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: 'Internal error',
              data: '서비스가 초기화되지 않았습니다'
            }
          }));
          return;
        }
        
        if (!db) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: 'Internal error',
              data: '데이터베이스가 초기화되지 않았습니다'
            }
          }));
          return;
        }
        
        // Phase 7.4: 표준 팩토리 함수 사용
        const context = createToolContext(db, serverServices);
        
        // 도구 실행
        const result = await toolRegistry.execute(name, args, context);
        
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text: JSON.stringify(result) }] }
        }));
      }
    } catch (error) {
      logger.error('WebSocket 메시지 처리 실패', { error });
      // message가 할당되지 않았을 수 있으므로 안전하게 처리
      let messageId: string | number | null = null;
      try {
        const parsedMessage = JSON.parse(data.toString()) as { id?: string | number };
        messageId = parsedMessage.id || null;
      } catch {
        // 파싱 실패 시 null 사용
      }
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: messageId,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : 'Unknown error'
        }
      }));
    }
  });
  
  ws.on('close', () => {
    logger.info('WebSocket 클라이언트 연결 해제됨');
    
    // 구독 목록에서 제거
    for (const [agentId, subscribers] of anchorMapSubscribers.entries()) {
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        anchorMapSubscribers.delete(agentId);
      }
    }
  });
  
  ws.on('error', (error) => {
    logger.error('WebSocket 에러', { error });
  });
});

// 서버 시작
async function startServer() {
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
      'MEMENTO_ALLOW_INSECURE_HTTP_ADMIN=true: Admin/API/Quality routes are reachable without ADMIN_API_KEY on a non-loopback bind. Do not use in production.'
    );
  }

  try {
    await initializeServer();
  } catch (error) {
    logger.error('서버 초기화 실패 — 리소스 정리 시도', { error });
    await cleanup();
    throw error instanceof Error ? error : new Error(String(error));
  }

  // 정리 핸들러 등록 (초기화 성공 후)
  registerCleanupHandlers();

  // 이미 리스닝 중이면 먼저 종료
  if (server.listening) {
    logger.warn('서버가 이미 리스닝 중입니다. 종료 후 재시작합니다');
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
  
  // HTTP 서버를 사용하여 Express app과 WebSocket 서버 모두 바인딩
  // app.listen() 대신 server.listen()을 사용하여 WebSocket 서버와 동일한 인스턴스 사용
  server.listen(Number(PORT), bindHostListen, () => {
    logger.info('서버 시작 완료', {
      http: `http://${bindHostForUrl}:${PORT}`,
      websocket: `ws://${bindHostForUrl}:${PORT}`,
      api_docs: `http://${bindHostForUrl}:${PORT}/tools`,
      health: `http://${bindHostForUrl}:${PORT}/health`
    });
  });
  
  // 추가: 모든 인터페이스에 바인딩 확인
  server.on('listening', () => {
    const address = server.address();
    if (address && typeof address === 'object') {
      logger.info('서버 바인딩 완료', { address: address.address, port: address.port });
    }
  });
}

// 서버 시작 함수는 export만 유지 (팩토리 패턴 사용)
// 직접 실행 코드는 제거됨 - 팩토리를 통해 서버를 시작해야 함

export const __test: {
  setTestDependencies: (deps: TestDependencies) => void;
  getApp: () => express.Application;
  getServer: () => any;
  getDatabase: () => Database.Database | null;
  getSearchEngine: () => CoreServerServices['searchEngine'];
  getHybridSearchEngine: () => CoreServerServices['hybridSearchEngine'];
  getEmbeddingService: () => CoreServerServices['embeddingService'];
} = {
  setTestDependencies,
  getApp: () => app,
  getServer: () => server,
  getDatabase: () => db,
  getSearchEngine: () => serverServices!.searchEngine,
  getHybridSearchEngine: () => serverServices!.hybridSearchEngine,
  getEmbeddingService: () => serverServices!.embeddingService
};

export { startServer, cleanup };

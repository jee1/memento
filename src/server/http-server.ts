#!/usr/bin/env node
/**
 * HTTP/WebSocket 기반 MCP 서버 v2
 * 모듈화된 구조로 새로 구현
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { createServer } from 'http';
import { initializeDatabase, closeDatabase } from '../infrastructure/database/database/init.js';
import { mementoConfig, validateConfig } from '../shared/config/index.js';
import { initializeServices, type ServerServices } from './bootstrap.js';
import { SearchEngine } from '../domains/search/algorithms/search-engine.js';
import { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { HybridSearchFactory } from '../domains/search/factories/hybrid-search.factory.js';
import { getVectorSearchEngine } from '../domains/search/algorithms/vector-search-engine.js';
import { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import { getBatchScheduler } from '../infrastructure/scheduler/batch-scheduler.js';
// ConsolidationScoreService는 serverServices를 통해 접근
import { WriteCoalescingManager } from '../shared/utils/write-coalescing.js';
import { getToolRegistry } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import Database from 'better-sqlite3';
import packageJson from '../../package.json' with { type: 'json' };
// Phase 1.2: 라우터 import
import { createToolsRouter } from './routes/tools.routes.js';
import { createAdminRouter } from './routes/admin.routes.js';
import { createApiRouter } from './routes/api.routes.js';
import { createMcpRouter } from './routes/mcp.routes.js';
// Phase 0: 공통 미들웨어 import
import { createServiceInjector, createToolContextMiddleware, errorHandler } from './middleware/index.js';

// 전역 변수
let db: Database.Database | null = null;
let searchEngine: SearchEngine;
let hybridSearchEngine: HybridSearchEngine;
let vectorSearchEngine: ReturnType<typeof getVectorSearchEngine>;
let embeddingService: MemoryEmbeddingService;
// 서비스들은 serverServices를 통해 접근하므로 개별 변수는 제거
// let forgettingPolicyService: ServerServices['forgettingPolicyService'];
// let performanceMonitor: ServerServices['performanceMonitor'];
// let databaseOptimizer: ServerServices['databaseOptimizer'];
// let errorLoggingService: ServerServices['errorLoggingService'];
// let performanceAlertService: ServerServices['performanceAlertService'];
// let consolidationScoreService: ConsolidationScoreService | null = null;
let writeCoalescingManager: WriteCoalescingManager | null = null;
// 부트스트랩에서 반환된 전체 서비스 객체 (ToolContext 생성 시 사용)
let serverServices: ServerServices | null = null;

// Phase 1.2: 라우터에서 사용할 전역 변수들
// SSE Transport 저장소 (MCP 라우터용)
const transports: Record<string, { res: any; sessionId: string; keepAliveInterval: ReturnType<typeof setTimeout> }> = {};

type TestDependencies = {
  database: Database.Database;
  searchEngine?: SearchEngine;
  hybridSearchEngine?: HybridSearchEngine;
  embeddingService?: MemoryEmbeddingService;
};

function setTestDependencies({
  database,
  searchEngine: search,
  hybridSearchEngine: hybrid,
  embeddingService: embedding
}: TestDependencies): void {
  db = database;
  searchEngine = search ?? new SearchEngine();
  hybridSearchEngine = hybrid ?? HybridSearchFactory.createDefaultEngine(db);
  embeddingService = embedding ?? new MemoryEmbeddingService();
}

// Express 앱 생성
const app = express();
const server = createServer(app);

// 미들웨어 설정
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
}));
app.use(express.json({ limit: '10mb' }));
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
const anchorMapSubscribers = new Map<string, Set<any>>(); // agent_id -> WebSocket Set

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
      console.error('❌ 대시보드 파일 로드 실패:', err);
      res.status(404).send('Dashboard not found');
    }
  });
});

// Phase 1.2: 기존 엔드포인트는 모두 라우터로 이동됨
// 주석 처리된 코드는 제거됨 (tools.routes.ts, admin.routes.ts, api.routes.ts, mcp.routes.ts로 이동)
// 서버 초기화
async function initializeServer() {
  try {
    console.log(`📦 Memento HTTP/WebSocket MCP Server v${packageJson.version}`);
    console.log('🚀 HTTP/WebSocket MCP 서버 v2 시작 중...');
    
    // 설정 검증
    validateConfig();
    
    // 데이터베이스 초기화
    db = await initializeDatabase();
    
    // 공용 부트스트랩 함수를 사용하여 모든 서비스 초기화
    const services = await initializeServices(db);
    
    // 전역 변수에 서비스 할당
    searchEngine = services.searchEngine;
    hybridSearchEngine = services.hybridSearchEngine;
    embeddingService = services.embeddingService;
    // 서비스들은 serverServices를 통해 접근
    // forgettingPolicyService = services.forgettingPolicyService;
    // performanceMonitor = services.performanceMonitor;
    // databaseOptimizer = services.databaseOptimizer;
    // errorLoggingService = services.errorLoggingService;
    // performanceAlertService = services.performanceAlertService;
    // consolidationScoreService = services.consolidationScoreService || null;
    writeCoalescingManager = services.writeCoalescingManager || null;
    
    // 부트스트랩에서 반환된 전체 서비스 객체 저장 (ToolContext 생성 시 사용)
    serverServices = services;
    
    // Vector Search Engine 초기화 (HTTP 서버 전용)
    vectorSearchEngine = getVectorSearchEngine();
    vectorSearchEngine.initialize(db);
    
    // Phase 0: 공통 미들웨어 적용
    // 서비스 주입 미들웨어 (모든 라우터에 적용)
    app.use(createServiceInjector(serverServices, db));
    
    // Phase 1.2: 라우터 초기화 및 등록
    toolsRouter = createToolsRouter(db, serverServices, anchorMapSubscribers);
    adminRouter = createAdminRouter(db);
    apiRouter = createApiRouter(db, serverServices);
    mcpRouter = createMcpRouter(db, serverServices, transports);
    
    // 라우터 등록
    // ToolContext 미들웨어는 /tools 라우터에만 적용 (도구 실행 시 필요)
    app.use('/tools', createToolContextMiddleware, toolsRouter);
    app.use('/admin', adminRouter);
    app.use('/api', apiRouter);
    app.use('/', mcpRouter); // /mcp, /messages는 루트에 등록
    
    // Phase 0: 공통 에러 핸들러 미들웨어 (모든 라우터 이후에 적용)
    app.use(errorHandler);
    
    console.log('✅ 서비스 초기화 완료');
    
    // 배치 스케줄러 시작 (이미 실행 중이면 먼저 중지)
    const batchScheduler = getBatchScheduler();
    if (batchScheduler.getStatus().isRunning) {
      console.log('⚠️  이전 BatchScheduler가 실행 중입니다. 중지 후 재시작합니다...');
      await batchScheduler.stop();
    }
    // Reflexion Worker 통합 (Phase 2)
    await batchScheduler.start(db, services.reflexionWorker);
    console.log('⏰ 배치 스케줄러 시작됨');
    
    // 임베딩 프로바이더 정보 표시
    console.log(`🔧 임베딩 프로바이더: ${mementoConfig.embeddingProvider.toUpperCase()}`);
    if (mementoConfig.embeddingProvider === 'openai' && mementoConfig.openaiApiKey) {
      console.log(`   📝 모델: ${mementoConfig.openaiModel} (${mementoConfig.embeddingDimensions}차원)`);
    } else if (mementoConfig.embeddingProvider === 'gemini' && mementoConfig.geminiApiKey) {
      console.log(`   📝 모델: ${mementoConfig.geminiModel} (${mementoConfig.embeddingDimensions}차원)`);
    } else if (mementoConfig.embeddingProvider === 'lightweight') {
      console.log(`   📝 모델: lightweight-hybrid (512차원)`);
    }
    
    console.log('✅ 서버 초기화 완료');
    console.log(`📊 서버: ${mementoConfig.serverName} v${mementoConfig.serverVersion}`);
    console.log(`🗄️  데이터베이스: ${mementoConfig.dbPath}`);
    
  } catch (error) {
    console.error('❌ 서버 초기화 실패:', error);
    process.exit(1);
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
    // Write Coalescing Manager 정리
    if (writeCoalescingManager) {
      await writeCoalescingManager.flush();
      await writeCoalescingManager.destroy();
      console.log('✅ Write Coalescing Manager 정리 완료');
    }
    
    // 배치 스케줄러 중지
    const batchScheduler = getBatchScheduler();
    await batchScheduler.stop();
    console.log('⏰ 배치 스케줄러 중지됨');
    
    if (db) {
      closeDatabase(db);
      db = null;
    }
    console.log('👋 HTTP/WebSocket MCP 서버 v2 종료');
  } catch (error) {
    console.error('❌ 정리 중 오류:', error);
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
    console.error('❌ 예상치 못한 오류:', error);
    await cleanup();
    process.exit(1);
  });
}

// WebSocket 서버 설정
const wss = new WebSocketServer({ server });

// Phase 1.2: anchorMapSubscribers는 위에서 이미 선언됨

wss.on('connection', (ws) => {
  console.log('🔗 WebSocket 클라이언트 연결됨');
  
  ws.on('message', async (data) => {
    let message: any;
    try {
      message = JSON.parse(data.toString());
      
      // Anchor Map 업데이트 구독 처리
      if (message.method === 'subscribe' && message.params?.type === 'anchor_map_updates') {
        const agentId = message.params.agent_id || 'default';
        
        if (!anchorMapSubscribers.has(agentId)) {
          anchorMapSubscribers.set(agentId, new Set());
        }
        anchorMapSubscribers.get(agentId)!.add(ws);
        
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { subscribed: true, agent_id: agentId }
        }));
        
        console.log(`📡 Anchor Map 업데이트 구독: agent_id=${agentId}`);
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
        const { name, arguments: args } = message.params;
        
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
        
        const context: ToolContext = {
          db,
          services: {
            searchEngine: serverServices.searchEngine,
            hybridSearchEngine: serverServices.hybridSearchEngine,
            embeddingService: serverServices.embeddingService,
            forgettingPolicyService: serverServices.forgettingPolicyService,
            performanceMonitor: serverServices.performanceMonitor,
            databaseOptimizer: serverServices.databaseOptimizer,
            errorLoggingService: serverServices.errorLoggingService,
            performanceAlertService: serverServices.performanceAlertService,
            consolidationScoreService: serverServices.consolidationScoreService,
            writeCoalescingManager: serverServices.writeCoalescingManager,
            anchorManager: serverServices.anchorManager
          }
        };
        
        // 도구 실행
        const result = await toolRegistry.execute(name, args, context);
        
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { content: [{ type: 'text', text: JSON.stringify(result) }] }
        }));
      }
    } catch (error) {
      console.error('❌ WebSocket 메시지 처리 실패:', error);
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: message?.id || null,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : 'Unknown error'
        }
      }));
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket 클라이언트 연결 해제됨');
    
    // 구독 목록에서 제거
    for (const [agentId, subscribers] of anchorMapSubscribers.entries()) {
      subscribers.delete(ws);
      if (subscribers.size === 0) {
        anchorMapSubscribers.delete(agentId);
      }
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket 에러:', error);
  });
});

// 서버 시작
async function startServer() {
  await initializeServer();
  
  // 정리 핸들러 등록
  registerCleanupHandlers();
  
  // 포트 설정 (mementoConfig에서 가져오거나 기본값 9001)
  const PORT = mementoConfig.port || 9001;
  
  // 이미 리스닝 중이면 먼저 종료
  if (server.listening) {
    console.log('⚠️  서버가 이미 리스닝 중입니다. 종료 후 재시작합니다...');
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
  
  // HTTP 서버를 사용하여 Express app과 WebSocket 서버 모두 바인딩
  // app.listen() 대신 server.listen()을 사용하여 WebSocket 서버와 동일한 인스턴스 사용
  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🌐 HTTP 서버: http://0.0.0.0:${PORT}`);
    console.log(`🔌 WebSocket 서버: ws://0.0.0.0:${PORT}`);
    console.log(`📋 API 문서: http://0.0.0.0:${PORT}/tools`);
    console.log(`❤️  헬스 체크: http://0.0.0.0:${PORT}/health`);
  });
  
  // 추가: 모든 인터페이스에 바인딩 확인
  server.on('listening', () => {
    const address = server.address();
    if (address && typeof address === 'object') {
      console.log(`🔗 서버가 ${address.address}:${address.port}에 바인딩됨`);
    }
  });
}

// 서버 시작
if (process.argv[1] && (process.argv[1].includes('http-server'))) {
  startServer().catch(error => {
    console.error('❌ 서버 시작 실패:', error);
    process.exit(1);
  });
}

export const __test: {
  setTestDependencies: (deps: TestDependencies) => void;
  getApp: () => express.Application;
  getServer: () => any;
  getDatabase: () => Database.Database | null;
  getSearchEngine: () => SearchEngine | undefined;
  getHybridSearchEngine: () => HybridSearchEngine | undefined;
  getEmbeddingService: () => MemoryEmbeddingService | undefined;
} = {
  setTestDependencies,
  getApp: () => app,
  getServer: () => server,
  getDatabase: () => db,
  getSearchEngine: () => searchEngine,
  getHybridSearchEngine: () => hybridSearchEngine,
  getEmbeddingService: () => embeddingService
};

export { startServer, cleanup };

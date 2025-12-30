#!/usr/bin/env node
/**
 * Memento MCP Server 메인 진입점 (리팩토링된 버전)
 * 모듈화된 도구들을 사용하여 유지보수성 개선
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { initializeDatabase, closeDatabase } from '../infrastructure/database/database/init.js';
import { mementoConfig, validateConfig } from '../shared/config/index.js';
import { DatabaseUtils } from '../shared/utils/database.js';
import { initializeServices, type ServerServices } from './bootstrap.js';
import { ErrorLoggingService, ErrorSeverity, ErrorCategory } from '../domains/monitoring/services/error-logging-service.js';
import type { SearchEngine } from '../domains/search/algorithms/search-engine.js';
import type { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import type { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import type { ForgettingPolicyService } from '../domains/forgetting/services/forgetting-policy-service.js';
import type { PerformanceMonitor } from '../domains/monitoring/services/performance-monitor.js';
import type { DatabaseOptimizer } from '../infrastructure/database/database-optimizer.js';
import type { PerformanceAlertService } from '../domains/monitoring/services/performance-alert-service.js';
import type { ConsolidationScoreService } from '../infrastructure/consolidation-score-service.js';
import type { WriteCoalescingManager } from '../shared/utils/write-coalescing.js';
import { getToolRegistry } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import { MemoryNeighborService } from '../domains/memory/services/memory-neighbor-service.js';
import { getVectorSearchEngine } from '../domains/search/algorithms/vector-search-engine.js';
import { getBatchScheduler } from '../infrastructure/scheduler/batch-scheduler.js';
import { mcpLogger } from './mcp-logger.js';
import Database from 'better-sqlite3';
import packageJson from '../../package.json' with { type: 'json' };

// MCP 서버 인스턴스
let server: Server;
let db: Database.Database | null = null;
// 부트스트랩 함수에서 초기화된 서비스들 (전역 변수로 저장)
// 하위 호환성을 위해 유지하지만 현재는 serverServices를 통해 접근
/* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars */
let searchEngine: SearchEngine;
let hybridSearchEngine: HybridSearchEngine;
let embeddingService: MemoryEmbeddingService;
let forgettingPolicyService: ForgettingPolicyService;
let performanceMonitor: PerformanceMonitor;
let databaseOptimizer: DatabaseOptimizer;
let errorLoggingService: ErrorLoggingService;
let performanceAlertService: PerformanceAlertService;
let consolidationScoreService: ConsolidationScoreService | null = null;
let writeCoalescingManager: WriteCoalescingManager | null = null;
/* eslint-enable @typescript-eslint/no-unused-vars, no-unused-vars */
// 부트스트랩에서 반환된 전체 서비스 객체 (ToolContext 생성 시 사용)
let serverServices: ServerServices | null = null;
// let performanceMonitoringIntegration: PerformanceMonitoringIntegration;

// MCP 서버에서는 모든 로그 출력을 완전히 차단
// 모든 console 메서드를 빈 함수로 교체
// MCP 프로토콜 스펙: stdio 전송 시 stdout에는 오직 JSON-RPC 메시지만 출력되어야 함
// 모든 로그는 stderr로 출력되어야 함 (mcpLogger 사용)
// 단, 초기화 전 에러는 stderr에 직접 출력하여 디버깅 가능하도록 함
console.log = () => {};
// console.error는 초기화 전 에러를 위해 유지하되, stderr로 리다이렉트
console.error = (...args: any[]) => {
  // 초기화 전에는 stderr에 직접 출력
  process.stderr.write(`[CONSOLE ERROR] ${args.map(a => String(a)).join(' ')}\n`);
};
console.warn = () => {};
console.info = () => {};
console.debug = () => {};

// MCP 프로토콜 준수: stdio 전송 시 stdout에는 오직 JSON-RPC 메시지만 출력되어야 함
// 모든 로그는 stderr로 출력되어야 함 (mcpLogger 사용)
// 주의: process.stdout.write를 래핑하지 않음
// MCP SDK의 StdioServerTransport가 stdout을 직접 사용하므로 래핑하면 간섭 발생
// 대신 모듈 로드 시점부터 stdout에 출력이 발생하지 않도록 보장

// MCP 서버가 connect()되기 전까지는 로그 출력을 억제
// MCP 프로토콜 스펙: 서버가 초기화되면서 stdout에 출력이 발생하면 JSON 파싱 오류 발생

// 동시성 제한을 위한 세마포어
export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise(resolve => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      this.permits--;
      resolve();
    }
  }
}

// 동시 처리 제한 (최대 20개 동시 요청)
const concurrencyLimiter = new Semaphore(20);

// 데이터베이스 상태 모니터링
/**
 * 초기 데이터베이스 상태 확인 (한 번만 실행)
 * 주기적 모니터링은 DatabaseLockMonitor가 담당하므로, 초기 상태만 확인
 */
async function checkInitialDatabaseStatus() {
  if (!db) return;
  
  try {
    const status = await DatabaseUtils.getDatabaseStatus(db);
    mcpLogger.logServer('info', '초기 데이터베이스 상태 확인', {
      journalMode: status.journalMode,
      walAutoCheckpoint: status.walAutoCheckpoint,
      busyTimeout: status.busyTimeout,
      isLocked: status.isLocked ? '잠김' : '정상'
    });
    
    // 주기적 모니터링은 DatabaseLockMonitor가 담당하므로 여기서는 초기 상태만 확인
    // 락이 감지되면 DatabaseLockMonitor가 자동으로 처리함
  } catch (error) {
    mcpLogger.logServer('warn', '초기 데이터베이스 상태 확인 실패', { error: error instanceof Error ? error.message : String(error) });
  }
}

// MCP 서버 초기화
async function initializeServer() {
  try {
    mcpLogger.logServer('info', `Memento MCP Server v${packageJson.version}`);
    mcpLogger.logServer('info', 'MCP 서버 초기화 시작...');
    
    // 설정 검증
    validateConfig();
    mcpLogger.logServer('info', '설정 검증 완료');
    
    // 데이터베이스 초기화
    db = await initializeDatabase();
    mcpLogger.logServer('info', '데이터베이스 초기화 완료');
    
    // 초기 데이터베이스 상태 확인 (주기적 모니터링은 DatabaseLockMonitor가 담당)
    await checkInitialDatabaseStatus();
    mcpLogger.logServer('info', '초기 데이터베이스 상태 확인 완료');
    
    // 공용 부트스트랩 함수를 사용하여 모든 서비스 초기화
    const services = await initializeServices(db);
    
    // 전역 변수에 서비스 할당 (하위 호환성을 위해 유지)
    /* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars */
    searchEngine = services.searchEngine;
    hybridSearchEngine = services.hybridSearchEngine;
    embeddingService = services.embeddingService;
    forgettingPolicyService = services.forgettingPolicyService;
    performanceMonitor = services.performanceMonitor;
    databaseOptimizer = services.databaseOptimizer;
    errorLoggingService = services.errorLoggingService;
    performanceAlertService = services.performanceAlertService;
    consolidationScoreService = services.consolidationScoreService || null;
    writeCoalescingManager = services.writeCoalescingManager || null;
    /* eslint-enable @typescript-eslint/no-unused-vars, no-unused-vars */
    
    // 부트스트랩에서 반환된 전체 서비스 객체 저장 (ToolContext 생성 시 사용)
    serverServices = services;
    
    mcpLogger.logServer('info', '서비스 초기화 완료');
    
    // 배치 스케줄러 시작 (이미 실행 중이면 먼저 중지)
    const batchScheduler = getBatchScheduler();
    if (batchScheduler.getStatus().isRunning) {
      mcpLogger.logServer('warn', '이전 BatchScheduler가 실행 중입니다. 중지 후 재시작합니다...');
      await batchScheduler.stop();
    }
    // Reflexion Worker 통합 (Phase 2)
    await batchScheduler.start(db, services.reflexionWorker);
    mcpLogger.logServer('info', '배치 스케줄러 시작됨');
    
    // 배치 스케줄러 상태 확인
    const status = batchScheduler.getStatus();
    mcpLogger.logServer('info', `배치 스케줄러 상태: ${JSON.stringify({
      isRunning: status.isRunning,
      activeJobs: status.activeJobs,
      uptime: status.uptime
    }, null, 2)}`);
    
    // 임베딩 프로바이더 정보 표시
    const providerInfo: any = {
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
    mcpLogger.logServer('info', '임베딩 프로바이더 정보', providerInfo);
    
    mcpLogger.logServer('info', '검색 엔진 초기화 완료');
    
    // MCP 서버 생성
    server = new Server(
      {
        name: mementoConfig.serverName,
        version: mementoConfig.serverVersion,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        }
      }
    );
    
    // MCP 로거에 Server 인스턴스 설정
    mcpLogger.setServer(server);
    
    mcpLogger.logServer('info', 'MCP 서버 생성 완료');
    
    // 주의: isTransportConnected 플래그는 server.connect() 호출 직전에 설정됨
    // initializeServer()에서는 설정하지 않음
    
    // 도구 레지스트리 가져오기
    const toolRegistry = getToolRegistry();
    
    // Tools 등록
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      await mcpLogger.logMCPProtocol('debug', '도구 목록 요청 처리');
      const tools = toolRegistry.getAll();
      await mcpLogger.logMCPProtocol('debug', `등록된 도구 개수: ${tools.length}`, { count: tools.length });
      
      return {
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      };
    });
    
    // Resources 목록 핸들러
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      await mcpLogger.logMCPProtocol('debug', '리소스 목록 요청 처리');
      
      if (!db) {
        throw new Error('Database not initialized');
      }
      
      // 모든 메모리 ID 조회
      const memories = await DatabaseUtils.all(db, 'SELECT id FROM memory_item ORDER BY created_at DESC LIMIT 1000');
      await mcpLogger.logMCPProtocol('debug', `리소스 개수: ${memories.length}`, { count: memories.length });
      
      return {
        resources: memories.map((memory: any) => ({
          uri: `memory://${memory.id}`,
          name: `Memory ${memory.id}`,
          description: `Memory item with ID: ${memory.id}`,
          mimeType: 'application/json'
        }))
      };
    });
    
    // Resource 읽기 핸들러
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      await mcpLogger.logMCPProtocol('debug', `리소스 읽기 요청: ${uri}`, { uri });
      
      // URI 파싱: memory://{id}?include_neighbors=true
      const uriMatch = uri.match(/^memory:\/\/([^?]+)(\?.*)?$/);
      if (!uriMatch) {
        throw new Error(`Invalid resource URI: ${uri}`);
      }
      
      const memoryId = uriMatch[1];
      if (!memoryId) {
        throw new Error(`Invalid memory ID in URI: ${uri}`);
      }
      
      const queryString = uriMatch[2] || '';
      const includeNeighbors = queryString.includes('include_neighbors=true');
      
      if (!db) {
        throw new Error('Database not initialized');
      }
      
      // 메모리 조회
      const memory = await DatabaseUtils.get(
        db,
        'SELECT id, type, content, importance, privacy_scope, tags, source, created_at, last_accessed, pinned FROM memory_item WHERE id = ?',
        [memoryId]
      );
      
      if (!memory) {
        throw new Error(`Memory not found: ${memoryId}`);
      }
      
      // 메모리 데이터 구성
      const memoryData: any = {
        id: memory.id,
        type: memory.type,
        content: memory.content,
        importance: memory.importance,
        privacy_scope: memory.privacy_scope,
        tags: memory.tags ? JSON.parse(memory.tags) : [],
        source: memory.source,
        created_at: memory.created_at,
        last_accessed: memory.last_accessed,
        pinned: memory.pinned === 1
      };
      
      // 이웃 기억 포함 여부 확인
      if (includeNeighbors) {
        try {
          const vectorSearchEngine = getVectorSearchEngine();
          const neighborService = new MemoryNeighborService(
            vectorSearchEngine,
            embeddingService
          );
          neighborService.setDatabase(db);
          
          const neighborsResult = await neighborService.getNeighbors(memoryId, {
            limit: 5,
            similarity_threshold: 0.8
          });
          
          memoryData.neighbors = neighborsResult.neighbors;
          memoryData.neighbors_count = neighborsResult.total_count;
          memoryData.neighbors_query_time = neighborsResult.query_time;
        } catch (error) {
          mcpLogger.logServer('warn', `이웃 기억 조회 실패: ${error instanceof Error ? error.message : String(error)}`, { error: error instanceof Error ? error.message : String(error) });
          memoryData.neighbors = [];
          memoryData.neighbors_count = 0;
        }
      }
      
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(memoryData, null, 2)
          }
        ]
      };
    });
    
    // Tool 실행 핸들러 - 동시성 제한 적용
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      await mcpLogger.logMCPProtocol('debug', `도구 실행 요청: ${name}`, { toolName: name, args });
      
      // 동시성 제한 적용
      await concurrencyLimiter.acquire();
      
      try {
        // 부트스트랩에서 초기화된 서비스 객체를 사용하여 ToolContext 생성
        if (!serverServices) {
          throw new Error('서비스가 초기화되지 않았습니다');
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
            anchorManager: serverServices.anchorManager,
            failureDetector: serverServices.failureDetector,
            reflexionWorker: serverServices.reflexionWorker
            // performanceMonitoringIntegration
          }
        };
        
        // 도구 실행
        const toolResult = await toolRegistry.execute(name, args, context);
        await mcpLogger.logMCPProtocol('debug', `도구 실행 완료: ${name}`, { toolName: name });
        
        // MCP 형식으로 변환
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(toolResult)
            }
          ]
        };
      } catch (error) {
        // 에러 로깅
        if (errorLoggingService) {
          errorLoggingService.logError(
            error instanceof Error ? error : new Error(String(error)),
            ErrorSeverity.HIGH,
            ErrorCategory.UNKNOWN,
            {
              operation: 'tool_execution',
              toolName: name,
              requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            }
          );
        }
        
        if (error instanceof Error) {
          throw new Error(`Tool execution failed: ${error.message}`);
        }
        throw error;
      } finally {
        // 동시성 제한 해제
        concurrencyLimiter.release();
      }
    });
    
    mcpLogger.logServer('info', 'MCP 서버 초기화 완료');
    
    // 실시간 성능 모니터링 시작
    // performanceMonitoringIntegration.startRealTimeMonitoring();
    
    mcpLogger.logServer('info', 'Memento MCP Server가 시작되었습니다!');
    // process.stderr.write('📊 실시간 성능 모니터링이 활성화되었습니다\n');
    
  } catch (error) {
    // 에러 발생 시 상세 정보를 stderr에 출력
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    mcpLogger.logServer('error', `서버 초기화 실패: ${errorMessage}`, { 
      error: errorMessage,
      stack: errorStack,
      type: error instanceof Error ? error.constructor.name : typeof error
    });
    
    // stderr에 직접 출력하여 Cursor에서도 확인 가능하도록
    process.stderr.write(`\n[ERROR] MCP Server Initialization Failed\n`);
    process.stderr.write(`Error: ${errorMessage}\n`);
    if (errorStack) {
      process.stderr.write(`Stack:\n${errorStack}\n`);
    }
    process.stderr.write(`\n`);
    
    process.exit(1);
  }
}

// 서버 시작
async function startServer() {
  try {
    // MCP 프로토콜 준수: transport 연결 전까지는 로그를 억제하여 stdout 오염 방지
    // initializeServer() 호출 전에 플래그를 설정하여 초기화 중 로그 출력 방지
    // globalThis를 통해 mcpLogger에서 접근 가능하도록 설정
    (globalThis as any).__mcp_transport_connected = false;
    
    await initializeServer();
    mcpLogger.logServer('info', '서버 초기화 완료');
    
    // Stdio 전송 계층 사용
    // MCP SDK의 StdioServerTransport가 stdout을 사용하여 JSON-RPC 메시지 전송
    // MCP 프로토콜 스펙: stdio 전송 시 stdout에는 오직 JSON-RPC 메시지만 출력되어야 함
    
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    // transport 연결 완료 후 로그 출력 허용
    (globalThis as any).__mcp_transport_connected = true;
    
    mcpLogger.logServer('info', 'MCP 전송 계층 연결 완료');
    
    // MCP 클라이언트 연결 대기 중
    mcpLogger.logServer('info', 'MCP 클라이언트 연결 대기 중...');
    
    // 서버가 종료될 때까지 대기
    return new Promise<void>((resolve) => {
      process.on('SIGINT', () => {
        mcpLogger.logServer('info', '서버 종료 신호 수신 (SIGINT)');
        cleanup().then(() => {
          resolve();
          process.exit(0);
        });
      });

      process.on('SIGTERM', () => {
        mcpLogger.logServer('info', '서버 종료 신호 수신 (SIGTERM)');
        cleanup().then(() => {
          resolve();
          process.exit(0);
        });
      });
    });
  } catch (error) {
    // 에러 발생 시 상세 정보를 stderr에 출력
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    mcpLogger.logServer('error', `서버 시작 실패: ${errorMessage}`, { 
      error: errorMessage,
      stack: errorStack,
      type: error instanceof Error ? error.constructor.name : typeof error
    });
    
    // stderr에 직접 출력하여 Cursor에서도 확인 가능하도록
    process.stderr.write(`\n[ERROR] MCP Server Start Failed\n`);
    process.stderr.write(`Error: ${errorMessage}\n`);
    if (errorStack) {
      process.stderr.write(`Stack:\n${errorStack}\n`);
    }
    process.stderr.write(`\n`);
    
    process.exit(1);
  }
}

// 정리 함수
let isCleaningUp = false;

async function cleanup() {
  if (isCleaningUp) {
    return; // 이미 정리 중이면 중복 실행 방지
  }
  
  isCleaningUp = true;
  
  mcpLogger.logServer('info', '서버 정리 시작...');
  
  // WAL 체크포인트 스케줄러 및 데이터베이스 락 모니터 중지
  if (serverServices) {
    try {
      await serverServices.walCheckpointScheduler.stop();
      mcpLogger.logServer('info', 'WAL 체크포인트 스케줄러 중지됨');
    } catch (error) {
      mcpLogger.logServer('error', `WAL 체크포인트 스케줄러 중지 실패: ${error}`, { error: error instanceof Error ? error.message : String(error) });
    }
    
    try {
      serverServices.databaseLockMonitor.stop();
      mcpLogger.logServer('info', '데이터베이스 락 모니터 중지됨');
    } catch (error) {
      mcpLogger.logServer('error', `데이터베이스 락 모니터 중지 실패: ${error}`, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  
  // Write Coalescing Manager의 남은 버퍼 flush
  if (writeCoalescingManager) {
    try {
      await writeCoalescingManager.flush();
      await writeCoalescingManager.destroy();
    } catch (error) {
      mcpLogger.logServer('warn', `Write coalescing flush 실패 (종료 시): ${error instanceof Error ? error.message : String(error)}`, { error: error instanceof Error ? error.message : String(error) });
    }
  }
  
  // 배치 스케줄러 중지
  try {
    const batchScheduler = getBatchScheduler();
    await batchScheduler.stop();
    mcpLogger.logServer('info', '배치 스케줄러 중지됨');
  } catch (error) {
    mcpLogger.logServer('warn', `배치 스케줄러 중지 실패: ${error instanceof Error ? error.message : String(error)}`, { error: error instanceof Error ? error.message : String(error) });
  }
  
  if (db) {
    closeDatabase(db);
    db = null; // 참조 제거
  }
  
  mcpLogger.logServer('info', '서버 정리 완료');
  // Memento MCP Server 종료
}

// 프로세스 종료 시 정리
// Note: SIGINT와 SIGTERM 핸들러는 startServer() 내부에서 등록되므로
// 여기서는 uncaughtException만 처리합니다.
process.on('uncaughtException', (error) => {
  // 예상치 못한 오류 로깅
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  
  // stderr에 직접 출력하여 Cursor에서도 확인 가능하도록
  process.stderr.write(`\n[FATAL ERROR] Uncaught Exception\n`);
  process.stderr.write(`Error: ${errorMessage}\n`);
  if (errorStack) {
    process.stderr.write(`Stack:\n${errorStack}\n`);
  }
  process.stderr.write(`\n`);
  
  // mcpLogger가 준비되었다면 사용
  try {
    mcpLogger.logServer('error', 'Uncaught exception', { 
      error: errorMessage,
      stack: errorStack
    });
  } catch {
    // mcpLogger 초기화 실패 시 무시
  }
  
  cleanup();
  process.exit(1);
});

// 서버 시작 함수 export (팩토리 패턴을 위해)
export { startServer, cleanup };

// 팩토리 패턴을 사용하여 서버 시작
import { createServerFactory } from './server-factory.js';

// 서버 시작 (팩토리 패턴 사용)
async function main() {
  try {
    const factory = createServerFactory();
    const server = factory.createServerFromEnv();
    await server.start();
  } catch (error) {
    // 초기화 전 에러는 mcpLogger가 아직 준비되지 않았을 수 있으므로
    // stderr에 직접 출력
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    process.stderr.write(`\n[FATAL ERROR] Failed to start MCP server\n`);
    process.stderr.write(`Error: ${errorMessage}\n`);
    if (errorStack) {
      process.stderr.write(`Stack:\n${errorStack}\n`);
    }
    process.stderr.write(`\n`);
    
    // mcpLogger가 준비되었다면 사용
    try {
      mcpLogger.logServer('error', 'Failed to start server', { 
        error: errorMessage,
        stack: errorStack
      });
    } catch {
      // mcpLogger 초기화 실패 시 무시
    }
    
    process.exit(1);
  }
}

// index.ts가 직접 실행되는 경우에만 팩토리 패턴으로 서버 시작
// 팩토리 패턴을 사용하지 않는 경우를 위해 기존 startServer도 유지
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     import.meta.url.endsWith(process.argv[1] || '') ||
                     process.argv[1]?.endsWith('index.ts') || 
                     process.argv[1]?.endsWith('index.js');

if (isMainModule) {
  main().catch((error) => {
    // 초기화 전 에러는 mcpLogger가 아직 준비되지 않았을 수 있으므로
    // stderr에 직접 출력
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    process.stderr.write(`\n[FATAL ERROR] Failed to start MCP server (unhandled)\n`);
    process.stderr.write(`Error: ${errorMessage}\n`);
    if (errorStack) {
      process.stderr.write(`Stack:\n${errorStack}\n`);
    }
    process.stderr.write(`\n`);
    
    // mcpLogger가 준비되었다면 사용
    try {
      mcpLogger.logServer('error', 'Failed to start server', { 
        error: errorMessage,
        stack: errorStack
      });
    } catch {
      // mcpLogger 초기화 실패 시 무시
    }
    
    process.exit(1);
  });
}

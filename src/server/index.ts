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
import Database from 'better-sqlite3';
import packageJson from '../../package.json' with { type: 'json' };

// MCP 서버 인스턴스
let server: Server;
let db: Database.Database | null = null;
// 부트스트랩 함수에서 초기화된 서비스들 (전역 변수로 저장)
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
// 부트스트랩에서 반환된 전체 서비스 객체 (ToolContext 생성 시 사용)
let serverServices: ServerServices | null = null;
// let performanceMonitoringIntegration: PerformanceMonitoringIntegration;

// MCP 서버에서는 모든 로그 출력을 완전히 차단
// 모든 console 메서드를 빈 함수로 교체
console.log = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};
console.debug = () => {};

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
async function monitorDatabaseStatus() {
  if (!db) return;
  
  try {
    const status = await DatabaseUtils.getDatabaseStatus(db);
    log('📊 데이터베이스 상태:', {
      journalMode: status.journalMode,
      walAutoCheckpoint: status.walAutoCheckpoint,
      busyTimeout: status.busyTimeout,
      isLocked: status.isLocked ? '🔒 잠김' : '🔓 정상'
    });
    
    // 락이 감지되면 WAL 체크포인트 실행
    if (status.isLocked) {
      log('⚠️ 데이터베이스 락 감지, WAL 체크포인트 실행...');
      await DatabaseUtils.checkpointWAL(db);
    }
  } catch (error) {
    // 데이터베이스 상태 모니터링 실패
  }
}

// MCP 모드 감지 (stdio를 통해 실행되는지 확인)
const isMCPMode = process.stdin.isTTY === false && process.stdout.isTTY === false;

// MCP 모드에서는 로그를 stderr로 출력
const log = isMCPMode ? console.error : console.log;

// MCP 서버 초기화
async function initializeServer() {
  try {
    process.stderr.write(`📦 Memento MCP Server v${packageJson.version}\n`);
    process.stderr.write('🚀 MCP 서버 초기화 시작...\n');
    
    // 설정 검증
    validateConfig();
    process.stderr.write('✅ 설정 검증 완료\n');
    
    // 데이터베이스 초기화
    db = await initializeDatabase();
    process.stderr.write('✅ 데이터베이스 초기화 완료\n');
    
    // 데이터베이스 상태 모니터링
    await monitorDatabaseStatus();
    process.stderr.write('✅ 데이터베이스 상태 모니터링 완료\n');
    
    // 공용 부트스트랩 함수를 사용하여 모든 서비스 초기화
    const services = await initializeServices(db);
    
    // 전역 변수에 서비스 할당 (하위 호환성을 위해 유지)
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
    
    // 부트스트랩에서 반환된 전체 서비스 객체 저장 (ToolContext 생성 시 사용)
    serverServices = services;
    
    process.stderr.write('✅ 서비스 초기화 완료\n');
    
    // 배치 스케줄러 시작 (이미 실행 중이면 먼저 중지)
    const batchScheduler = getBatchScheduler();
    if (batchScheduler.getStatus().isRunning) {
      process.stderr.write('⚠️  이전 BatchScheduler가 실행 중입니다. 중지 후 재시작합니다...\n');
      await batchScheduler.stop();
    }
    // Reflexion Worker 통합 (Phase 2)
    await batchScheduler.start(db, services.reflexionWorker);
    process.stderr.write('⏰ 배치 스케줄러 시작됨\n');
    
    // 배치 스케줄러 상태 확인
    const status = batchScheduler.getStatus();
    process.stderr.write(`📊 배치 스케줄러 상태: ${JSON.stringify({
      isRunning: status.isRunning,
      activeJobs: status.activeJobs,
      uptime: status.uptime
    }, null, 2)}\n`);
    
    // 임베딩 프로바이더 정보 표시
    process.stderr.write(`🔧 임베딩 프로바이더: ${mementoConfig.embeddingProvider.toUpperCase()}\n`);
    if (mementoConfig.embeddingProvider === 'openai' && mementoConfig.openaiApiKey) {
      process.stderr.write(`   📝 모델: ${mementoConfig.openaiModel} (${mementoConfig.embeddingDimensions}차원)\n`);
    } else if (mementoConfig.embeddingProvider === 'gemini' && mementoConfig.geminiApiKey) {
      process.stderr.write(`   📝 모델: ${mementoConfig.geminiModel} (${mementoConfig.embeddingDimensions}차원)\n`);
    } else if (mementoConfig.embeddingProvider === 'lightweight') {
      process.stderr.write(`   📝 모델: lightweight-hybrid (512차원)\n`);
    }
    
    process.stderr.write('✅ 검색 엔진 초기화 완료\n');
    
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
    process.stderr.write('✅ MCP 서버 생성 완료\n');
    
    // 도구 레지스트리 가져오기
    const toolRegistry = getToolRegistry();
    
    // Tools 등록
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      process.stderr.write('📋 도구 목록 요청 처리\n');
      const tools = toolRegistry.getAll();
      process.stderr.write(`📋 등록된 도구 개수: ${tools.length}\n`);
      tools.forEach(tool => {
        process.stderr.write(`   - ${tool.name}: ${tool.description}\n`);
      });
      
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
      process.stderr.write('📋 리소스 목록 요청 처리\n');
      
      if (!db) {
        throw new Error('Database not initialized');
      }
      
      // 모든 메모리 ID 조회
      const memories = await DatabaseUtils.all(db, 'SELECT id FROM memory_item ORDER BY created_at DESC LIMIT 1000');
      
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
      process.stderr.write(`📖 리소스 읽기 요청: ${uri}\n`);
      
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
          process.stderr.write(`⚠️ 이웃 기억 조회 실패: ${error instanceof Error ? error.message : String(error)}\n`);
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
      process.stderr.write(`🔧 도구 실행 요청: ${name}\n`);
      process.stderr.write(`🔧 도구 인수: ${JSON.stringify(args)}\n`);
      
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
        
        process.stderr.write(`🔧 도구 실행 시작: ${name}\n`);
        // 도구 실행
        const toolResult = await toolRegistry.execute(name, args, context);
        process.stderr.write(`🔧 도구 실행 완료: ${name}\n`);
        
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
    
    process.stderr.write('✅ MCP 서버 초기화 완료\n');
    
    // 실시간 성능 모니터링 시작
    // performanceMonitoringIntegration.startRealTimeMonitoring();
    
    process.stderr.write('🚀 Memento MCP Server가 시작되었습니다!\n');
    // process.stderr.write('📊 실시간 성능 모니터링이 활성화되었습니다\n');
    
  } catch (error) {
    process.stderr.write(`❌ 서버 초기화 실패: ${error}\n`);
    process.exit(1);
  }
}

// 서버 시작
async function startServer() {
  try {
    await initializeServer();
    process.stderr.write('✅ 서버 초기화 완료\n');
    
    // Stdio 전송 계층 사용
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('✅ MCP 전송 계층 연결 완료\n');
    
    // MCP 클라이언트 연결 대기 중
    process.stderr.write('🔗 MCP 클라이언트 연결 대기 중...\n');
    
    // 서버가 종료될 때까지 대기
    return new Promise<void>((resolve) => {
      process.on('SIGINT', () => {
        process.stderr.write('👋 서버 종료 신호 수신\n');
        cleanup().then(() => {
          process.exit(0);
        });
      });

      process.on('SIGTERM', () => {
        process.stderr.write('👋 서버 종료 신호 수신\n');
        cleanup().then(() => {
          process.exit(0);
        });
      });
    });
  } catch (error) {
    process.stderr.write(`❌ 서버 시작 실패: ${error}\n`);
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
  
  // Write Coalescing Manager의 남은 버퍼 flush
  if (writeCoalescingManager) {
    try {
      await writeCoalescingManager.flush();
      await writeCoalescingManager.destroy();
    } catch (error) {
      process.stderr.write(`⚠️ Write coalescing flush 실패 (종료 시): ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  
  // 배치 스케줄러 중지
  try {
    const batchScheduler = getBatchScheduler();
    await batchScheduler.stop();
    process.stderr.write('⏰ 배치 스케줄러 중지됨\n');
  } catch (error) {
    process.stderr.write(`⚠️ 배치 스케줄러 중지 실패: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  
  if (db) {
    closeDatabase(db);
    db = null; // 참조 제거
  }
  // Memento MCP Server 종료
}

// 프로세스 종료 시 정리
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('uncaughtException', (error) => {
  // 예상치 못한 오류
  cleanup();
  process.exit(1);
});

// 서버 시작 (MCP 서버는 항상 시작되어야 함)
startServer().catch(error => {
  process.exit(1);
});

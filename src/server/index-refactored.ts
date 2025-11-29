/**
 * Memento MCP Server 메인 진입점 (리팩토링된 버전)
 * 모듈화된 도구들을 사용하여 유지보수성 개선
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { initializeDatabase, closeDatabase } from '../infrastructure/database/init.js';
import { mementoConfig, validateConfig } from '../shared/config/index.js';
import { DatabaseUtils } from '../shared/utils/database.js';
import { SearchEngine } from '../domains/search/algorithms/search-engine.js';
import { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import { ForgettingPolicyService } from '../domains/forgetting/services/forgetting-policy-service.js';
import { PerformanceMonitor } from '../domains/monitoring/services/performance-monitor.js';
import { SearchCacheService } from '../infrastructure/cache/cache-service.js';
import { DatabaseOptimizer } from '../infrastructure/database/database-optimizer.js';
import { getToolRegistry } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import Database from 'better-sqlite3';

// MCP 서버 인스턴스
let server: Server;
let db: Database.Database | null = null;
let searchEngine: SearchEngine;
let hybridSearchEngine: HybridSearchEngine;
let embeddingService: MemoryEmbeddingService;
let forgettingPolicyService: ForgettingPolicyService;
let performanceMonitor: PerformanceMonitor;
let searchCache: SearchCacheService;
let databaseOptimizer: DatabaseOptimizer;

// MCP 서버에서는 모든 로그 출력을 완전히 차단
// 모든 console 메서드를 빈 함수로 교체
console.log = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};
console.debug = () => {};

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
    
    // 검색 엔진 초기화
    searchEngine = new SearchEngine();
    hybridSearchEngine = new HybridSearchEngine();
    embeddingService = new MemoryEmbeddingService();
    forgettingPolicyService = new ForgettingPolicyService();
    performanceMonitor = new PerformanceMonitor(db);
    searchCache = new SearchCacheService(1000, 300000); // 5분 TTL
    databaseOptimizer = new DatabaseOptimizer(db);
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
      
      return {
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      };
    });
    
    // Tool 실행 핸들러
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      process.stderr.write(`🔧 도구 실행 요청: ${name}\n`);
      
      try {
        // 도구 컨텍스트 생성
        const context: ToolContext = {
          db,
          services: {
            searchEngine,
            hybridSearchEngine,
            embeddingService,
            forgettingPolicyService,
            performanceMonitor,
            databaseOptimizer
          }
        };
        
        // 도구 실행
        const result = await toolRegistry.execute(name, args, context);
        return result;
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`Tool execution failed: ${error.message}`);
        }
        throw error;
      }
    });
    
    process.stderr.write('✅ MCP 서버 초기화 완료\n');
    process.stderr.write('🚀 Memento MCP Server가 시작되었습니다!\n');
    
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

// 서버 시작
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  startServer().catch(error => {
    process.exit(1);
  });
}

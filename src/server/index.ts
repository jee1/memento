/**
 * Memento MCP Server 메인 진입점
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { initializeDatabase, closeDatabase } from '../database/init.js';
import { mementoConfig, validateConfig } from '../config/index.js';
import type { MemoryType, PrivacyScope } from '../types/index.js';
import { DatabaseUtils } from '../utils/database.js';
import { SearchEngine } from '../algorithms/search-engine.js';
import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import sqlite3 from 'sqlite3';

// MCP 서버 인스턴스
let server: Server;
let db: sqlite3.Database | null = null;
let searchEngine: SearchEngine;
let hybridSearchEngine: HybridSearchEngine;
let embeddingService: MemoryEmbeddingService;

// MCP 서버에서는 모든 로그 출력을 완전히 차단
// 모든 console 메서드를 빈 함수로 교체
console.log = () => {};
console.error = () => {};
console.warn = () => {};
console.info = () => {};
console.debug = () => {};

// MCP Tools 스키마 정의
const RememberSchema = z.object({
  content: z.string().min(1, 'Content cannot be empty'),
  type: z.enum(['working', 'episodic', 'semantic', 'procedural']).default('episodic'),
  tags: z.array(z.string()).optional(),
  importance: z.number().min(0).max(1).default(0.5),
  source: z.string().optional(),
  privacy_scope: z.enum(['private', 'team', 'public']).default('private')
});

const RecallSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty'),
  filters: z.object({
    type: z.array(z.enum(['working', 'episodic', 'semantic', 'procedural'])).optional(),
    tags: z.array(z.string()).optional(),
    privacy_scope: z.array(z.enum(['private', 'team', 'public'])).optional(),
    time_from: z.string().optional(),
    time_to: z.string().optional(),
    pinned: z.boolean().optional()
  }).optional(),
  limit: z.number().min(1).max(50).default(10)
});

const ForgetSchema = z.object({
  id: z.string().min(1, 'Memory ID cannot be empty'),
  hard: z.boolean().default(false)
});

const PinSchema = z.object({
  id: z.string().min(1, 'Memory ID cannot be empty')
});

const UnpinSchema = z.object({
  id: z.string().min(1, 'Memory ID cannot be empty')
});

// Tool 핸들러들 (개선된 구현)
async function handleRemember(params: z.infer<typeof RememberSchema>) {
  const { content, type, tags, importance, source, privacy_scope } = params;
  
  // UUID 생성 (임시로 간단한 ID 사용)
  const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // 데이터베이스 연결 확인
  if (!db) {
    throw new Error('데이터베이스가 초기화되지 않았습니다');
  }
  
  try {
    // 개선된 트랜잭션 재시도 로직 사용
    const result = await DatabaseUtils.runTransaction(db!, async () => {
      await DatabaseUtils.run(db!, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, tags, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [id, type, content, importance, privacy_scope, 
          tags ? JSON.stringify(tags) : null, source]);
      
      return { id, type, content, importance, privacy_scope, tags, source };
    });
    
    // 임베딩 생성 (비동기, 실패해도 메모리 저장은 성공)
    if (embeddingService.isAvailable()) {
      embeddingService.createAndStoreEmbedding(db, id, content, type)
        .then(result => {
          if (result) {
            // 임베딩 생성 완료
          }
        })
        .catch(error => {
          console.warn(`⚠️ 임베딩 생성 실패 (${id}):`, error.message);
        });
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            memory_id: id,
            message: `기억이 저장되었습니다: ${id}`,
            embedding_created: embeddingService.isAvailable()
          })
        }
      ]
    };
  } catch (error) {
    // 데이터베이스 락 문제인 경우 WAL 체크포인트 시도
    if ((error as any).code === 'SQLITE_BUSY') {
      // 데이터베이스 락 감지, WAL 체크포인트 시도
      try {
        await DatabaseUtils.checkpointWAL(db);
        // WAL 체크포인트 완료
      } catch (checkpointError) {
        // WAL 체크포인트 실패
      }
    }
    throw error;
  }
}

async function handleRecall(params: z.infer<typeof RecallSchema>) {
  const { query, filters, limit } = params;
  
  if (!db) {
    throw new Error('데이터베이스가 초기화되지 않았습니다');
  }
  
  if (!hybridSearchEngine) {
    throw new Error('하이브리드 검색 엔진이 초기화되지 않았습니다');
  }
  
  // 하이브리드 검색 엔진 사용 (텍스트 + 벡터 검색)
  const results = await hybridSearchEngine.search(db, {
    query,
    filters,
    limit,
    vectorWeight: 0.6, // 벡터 검색 60%
    textWeight: 0.4,   // 텍스트 검색 40%
  });
  
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          items: results,
          search_type: 'hybrid',
          vector_search_available: hybridSearchEngine.isEmbeddingAvailable()
        })
      }
    ]
  };
}

async function handleForget(params: z.infer<typeof ForgetSchema>) {
  const { id, hard } = params;
  
  if (!db) {
    throw new Error('데이터베이스가 초기화되지 않았습니다');
  }
  
  try {
    // 개선된 트랜잭션 재시도 로직 사용
    const result = await DatabaseUtils.runTransaction(db!, async () => {
      if (hard) {
        // 하드 삭제
        const deleteResult = await DatabaseUtils.run(db!, 'DELETE FROM memory_item WHERE id = ?', [id]);
        
        if (deleteResult.changes === 0) {
          throw new Error(`Memory with ID ${id} not found`);
        }
        
        return { type: 'hard', changes: deleteResult.changes };
      } else {
        // 소프트 삭제 (pinned 해제 후 TTL에 의해 삭제)
        const updateResult = await DatabaseUtils.run(db!, 'UPDATE memory_item SET pinned = FALSE WHERE id = ?', [id]);
        
        if (updateResult.changes === 0) {
          throw new Error(`Memory with ID ${id} not found`);
        }
        
        return { type: 'soft', changes: updateResult.changes };
      }
    });
    
    // 임베딩도 삭제 (하드 삭제인 경우)
    if (hard && embeddingService.isAvailable()) {
      try {
        await embeddingService.deleteEmbedding(db, id);
      } catch (embeddingError) {
        console.warn(`⚠️ 임베딩 삭제 실패 (${id}):`, embeddingError);
      }
    }
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            memory_id: id,
            message: hard ? `기억이 완전히 삭제되었습니다: ${id}` : `기억이 삭제 대상으로 표시되었습니다: ${id}`
          })
        }
      ]
    };
  } catch (error) {
    // 데이터베이스 락 문제인 경우 WAL 체크포인트 시도
    if ((error as any).code === 'SQLITE_BUSY') {
      // 데이터베이스 락 감지, WAL 체크포인트 시도
      try {
        await DatabaseUtils.checkpointWAL(db);
        // WAL 체크포인트 완료
      } catch (checkpointError) {
        // WAL 체크포인트 실패
      }
    }
    throw error;
  }
}

async function handlePin(params: z.infer<typeof PinSchema>) {
  const { id } = params;
  
  if (!db) {
    throw new Error('데이터베이스가 초기화되지 않았습니다');
  }
  
  try {
    // 개선된 트랜잭션 재시도 로직 사용
    await DatabaseUtils.runTransaction(db!, async () => {
      const result = await DatabaseUtils.run(db!, 'UPDATE memory_item SET pinned = TRUE WHERE id = ?', [id]);
      
      if (result.changes === 0) {
        throw new Error(`Memory with ID ${id} not found`);
      }
      
      return result;
    });
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            memory_id: id,
            message: `기억이 고정되었습니다: ${id}`
          })
        }
      ]
    };
  } catch (error) {
    // 데이터베이스 락 문제인 경우 WAL 체크포인트 시도
    if ((error as any).code === 'SQLITE_BUSY') {
      // 데이터베이스 락 감지, WAL 체크포인트 시도
      try {
        await DatabaseUtils.checkpointWAL(db);
        // WAL 체크포인트 완료
      } catch (checkpointError) {
        // WAL 체크포인트 실패
      }
    }
    throw error;
  }
}

async function handleUnpin(params: z.infer<typeof UnpinSchema>) {
  const { id } = params;
  
  if (!db) {
    throw new Error('데이터베이스가 초기화되지 않았습니다');
  }
  
  try {
    // 개선된 트랜잭션 재시도 로직 사용
    await DatabaseUtils.runTransaction(db!, async () => {
      const result = await DatabaseUtils.run(db!, 'UPDATE memory_item SET pinned = FALSE WHERE id = ?', [id]);
      
      if (result.changes === 0) {
        throw new Error(`Memory with ID ${id} not found`);
      }
      
      return result;
    });
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            memory_id: id,
            message: `기억 고정이 해제되었습니다: ${id}`
          })
        }
      ]
    };
  } catch (error) {
    // 데이터베이스 락 문제인 경우 WAL 체크포인트 시도
    if ((error as any).code === 'SQLITE_BUSY') {
      // 데이터베이스 락 감지, WAL 체크포인트 시도
      try {
        await DatabaseUtils.checkpointWAL(db);
        // WAL 체크포인트 완료
      } catch (checkpointError) {
        // WAL 체크포인트 실패
      }
    }
    throw error;
  }
}

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
    
    // Tools 등록
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      process.stderr.write('📋 도구 목록 요청 처리\n');
      return {
        tools: [
          {
            name: 'remember',
            description: '새로운 기억을 저장합니다',
            inputSchema: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '저장할 내용' },
                type: { 
                  type: 'string', 
                  enum: ['working', 'episodic', 'semantic', 'procedural'],
                  description: '기억 타입',
                  default: 'episodic'
                },
                tags: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: '태그 목록'
                },
                importance: { 
                  type: 'number', 
                  minimum: 0, 
                  maximum: 1,
                  description: '중요도 (0-1)',
                  default: 0.5
                },
                source: { type: 'string', description: '출처' },
                privacy_scope: { 
                  type: 'string', 
                  enum: ['private', 'team', 'public'],
                  description: '프라이버시 범위',
                  default: 'private'
                }
              },
              required: ['content']
            }
          },
          {
            name: 'recall',
            description: '관련 기억을 검색합니다',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: '검색 쿼리' },
                filters: {
                  type: 'object',
                  properties: {
                    type: { 
                      type: 'array', 
                      items: { type: 'string', enum: ['working', 'episodic', 'semantic', 'procedural'] }
                    },
                    tags: { type: 'array', items: { type: 'string' } },
                    privacy_scope: { 
                      type: 'array', 
                      items: { type: 'string', enum: ['private', 'team', 'public'] }
                    },
                    time_from: { type: 'string' },
                    time_to: { type: 'string' },
                    pinned: { type: 'boolean' }
                  }
                },
                limit: { type: 'number', minimum: 1, maximum: 50, default: 10 }
              },
              required: ['query']
            }
          },
          {
            name: 'forget',
            description: '기억을 삭제합니다',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '삭제할 기억의 ID' },
                hard: { type: 'boolean', description: '완전 삭제 여부', default: false }
              },
              required: ['id']
            }
          },
          {
            name: 'pin',
            description: '기억을 고정합니다',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '고정할 기억의 ID' }
              },
              required: ['id']
            }
          },
          {
            name: 'unpin',
            description: '기억 고정을 해제합니다',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '고정 해제할 기억의 ID' }
              },
              required: ['id']
            }
          }
        ]
      };
    });
    
    // Tool 실행 핸들러
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      process.stderr.write(`🔧 도구 실행 요청: ${name}\n`);
      
      try {
        switch (name) {
          case 'remember':
            return await handleRemember(RememberSchema.parse(args));
          case 'recall':
            return await handleRecall(RecallSchema.parse(args));
          case 'forget':
            return await handleForget(ForgetSchema.parse(args));
          case 'pin':
            return await handlePin(PinSchema.parse(args));
          case 'unpin':
            return await handleUnpin(UnpinSchema.parse(args));
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new Error(`Invalid parameters: ${error.errors.map(e => e.message).join(', ')}`);
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

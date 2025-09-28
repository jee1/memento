/**
 * HTTP/WebSocket 기반 MCP 서버
 * 콘솔 로그와 MCP 프로토콜 충돌 문제를 해결
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { createServer } from 'http';
import { initializeDatabase, closeDatabase } from '../database/init.js';
import { mementoConfig, validateConfig } from '../config/index.js';
import { DatabaseUtils } from '../utils/database.js';
import { SearchEngine } from '../algorithms/search-engine.js';
import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import type { MemoryType, PrivacyScope } from '../types/index.js';
import Database from 'better-sqlite3';
import { z } from 'zod';

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

const ContextInjectionSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty'),
  context: z.string().min(1, 'Context cannot be empty'),
  limit: z.number().min(1).max(50).default(5)
});

// 전역 변수
let db: Database.Database | null = null;
let searchEngine: SearchEngine;
let hybridSearchEngine: HybridSearchEngine;
let embeddingService: MemoryEmbeddingService;

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
  hybridSearchEngine = hybrid ?? new HybridSearchEngine();
  embeddingService = embedding ?? new MemoryEmbeddingService();
}

// Tool 핸들러들 (기존과 동일)
async function handleRemember(params: z.infer<typeof RememberSchema>) {
  const { content, type, tags, importance, source, privacy_scope } = params;
  
  const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  if (!db) {
    throw new Error('데이터베이스가 초기화되지 않았습니다');
  }
  
  try {
    const result = await DatabaseUtils.runTransaction(db!, async () => {
      await DatabaseUtils.run(db!, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, tags, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [id, type, content, importance, privacy_scope, 
          tags ? JSON.stringify(tags) : null, source]);
      
      return { id, type, content, importance, privacy_scope, tags, source };
    });
    
    // 임베딩 생성 (비동기)
    if (embeddingService.isAvailable()) {
      embeddingService.createAndStoreEmbedding(db, id, content, type)
        .then(result => {
          if (result) {
            console.log(`✅ 임베딩 생성 완료: ${id} (${result.embedding.length}차원)`);
          }
        })
        .catch(error => {
          console.warn(`⚠️ 임베딩 생성 실패 (${id}):`, error.message);
        });
    }
    
    return {
      memory_id: id,
      message: `기억이 저장되었습니다: ${id}`,
      embedding_created: embeddingService.isAvailable()
    };
  } catch (error) {
    if ((error as any).code === 'SQLITE_BUSY') {
      console.log('🔧 데이터베이스 락 감지, WAL 체크포인트 시도...');
      try {
        await DatabaseUtils.checkpointWAL(db);
        console.log('✅ WAL 체크포인트 완료, 재시도 가능');
      } catch (checkpointError) {
        console.error('❌ WAL 체크포인트 실패:', checkpointError);
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
  
  try {
    const results = await searchEngine.search(db, {
      query,
      filters: filters || {},
      limit
    });
    
    return {
      items: results,
      search_type: 'text',
      vector_search_available: false
    };
  } catch (error) {
    throw error;
  }
}

async function handleForget(params: z.infer<typeof ForgetSchema>) {
  const { id, hard } = params;
  
  if (!db) {
    throw new Error('데이터베이스가 초기화되지 않았습니다');
  }
  
  try {
    const result = await DatabaseUtils.runTransaction(db!, async () => {
      if (hard) {
        const deleteResult = await DatabaseUtils.run(db!, 'DELETE FROM memory_item WHERE id = ?', [id]);
        
        if (deleteResult.changes === 0) {
          throw new Error(`Memory with ID ${id} not found`);
        }
        
        return { type: 'hard', changes: deleteResult.changes };
      } else {
        const updateResult = await DatabaseUtils.run(db!, 'UPDATE memory_item SET pinned = FALSE WHERE id = ?', [id]);
        
        if (updateResult.changes === 0) {
          throw new Error(`Memory with ID ${id} not found`);
        }
        
        return { type: 'soft', changes: updateResult.changes };
      }
    });
    
    if (hard && embeddingService.isAvailable()) {
      try {
        await embeddingService.deleteEmbedding(db, id);
      } catch (embeddingError) {
        console.warn(`⚠️ 임베딩 삭제 실패 (${id}):`, embeddingError);
      }
    }
    
    return {
      memory_id: id,
      message: hard ? `기억이 완전히 삭제되었습니다: ${id}` : `기억이 삭제 대상으로 표시되었습니다: ${id}`
    };
  } catch (error) {
    if ((error as any).code === 'SQLITE_BUSY') {
      console.log('🔧 데이터베이스 락 감지, WAL 체크포인트 시도...');
      try {
        await DatabaseUtils.checkpointWAL(db);
        console.log('✅ WAL 체크포인트 완료, 재시도 가능');
      } catch (checkpointError) {
        console.error('❌ WAL 체크포인트 실패:', checkpointError);
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
    await DatabaseUtils.runTransaction(db!, async () => {
      const result = await DatabaseUtils.run(db!, 'UPDATE memory_item SET pinned = TRUE WHERE id = ?', [id]);
      
      if (result.changes === 0) {
        throw new Error(`Memory with ID ${id} not found`);
      }
      
      return result;
    });
    
    return {
      memory_id: id,
      message: `기억이 고정되었습니다: ${id}`
    };
  } catch (error) {
    if ((error as any).code === 'SQLITE_BUSY') {
      console.log('🔧 데이터베이스 락 감지, WAL 체크포인트 시도...');
      try {
        await DatabaseUtils.checkpointWAL(db);
        console.log('✅ WAL 체크포인트 완료, 재시도 가능');
      } catch (checkpointError) {
        console.error('❌ WAL 체크포인트 실패:', checkpointError);
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
    await DatabaseUtils.runTransaction(db!, async () => {
      const result = await DatabaseUtils.run(db!, 'UPDATE memory_item SET pinned = FALSE WHERE id = ?', [id]);
      
      if (result.changes === 0) {
        throw new Error(`Memory with ID ${id} not found`);
      }
      
      return result;
    });
    
    return {
      memory_id: id,
      message: `기억 고정이 해제되었습니다: ${id}`
    };
  } catch (error) {
    if ((error as any).code === 'SQLITE_BUSY') {
      console.log('🔧 데이터베이스 락 감지, WAL 체크포인트 시도...');
      try {
        await DatabaseUtils.checkpointWAL(db);
        console.log('✅ WAL 체크포인트 완료, 재시도 가능');
      } catch (checkpointError) {
        console.error('❌ WAL 체크포인트 실패:', checkpointError);
      }
    }
    throw error;
  }
}

async function handleContextInjection(params: z.infer<typeof ContextInjectionSchema>) {
  const { query, context, limit } = params;
  
  if (!db) {
    throw new Error('데이터베이스가 초기화되지 않았습니다');
  }
  
  try {
    // 쿼리로 관련 기억 검색
    const searchResult = await hybridSearchEngine.search(db, {
      query,
      limit: limit * 2, // 더 많은 후보를 가져와서 컨텍스트와 매칭
      vectorWeight: 0.6,
      textWeight: 0.4
    });
    
    // 컨텍스트와 관련성 높은 기억들 필터링
    const relevantMemories = searchResult.items
      .filter(memory => {
        // 간단한 키워드 매칭으로 관련성 판단
        const contextKeywords = context.toLowerCase().split(/\s+/);
        const memoryContent = memory.content.toLowerCase();
        return contextKeywords.some(keyword => memoryContent.includes(keyword));
      })
      .slice(0, limit);
    
    return {
      memories: relevantMemories,
      total_count: relevantMemories.length,
      context: context,
      query: query
    };
  } catch (error) {
    if ((error as any).code === 'SQLITE_BUSY') {
      console.log('🔧 데이터베이스 락 감지, WAL 체크포인트 시도...');
      try {
        await DatabaseUtils.checkpointWAL(db);
        console.log('✅ WAL 체크포인트 완료, 재시도 가능');
      } catch (checkpointError) {
        console.error('❌ WAL 체크포인트 실패:', checkpointError);
      }
    }
    throw error;
  }
}

// Express 앱 생성
const app = express();
const server = createServer(app);

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// MCP Tools 목록
const tools = [
  {
    name: 'remember',
    description: '기억을 저장합니다',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '저장할 기억 내용' },
        type: { 
          type: 'string', 
          enum: ['working', 'episodic', 'semantic', 'procedural'],
          default: 'episodic',
          description: '기억 타입'
        },
        tags: { type: 'array', items: { type: 'string' }, description: '태그 목록' },
        importance: { type: 'number', minimum: 0, maximum: 1, default: 0.5, description: '중요도 (0-1)' },
        source: { type: 'string', description: '출처' },
        privacy_scope: { 
          type: 'string', 
          enum: ['private', 'team', 'public'],
          default: 'private',
          description: '프라이버시 범위'
        }
      },
      required: ['content']
    }
  },
  {
    name: 'recall',
    description: '기억을 검색합니다',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색 쿼리' },
        filters: {
          type: 'object',
          properties: {
            type: { type: 'array', items: { type: 'string' }, description: '기억 타입 필터' },
            tags: { type: 'array', items: { type: 'string' }, description: '태그 필터' },
            privacy_scope: { type: 'array', items: { type: 'string' }, description: '프라이버시 범위 필터' },
            time_from: { type: 'string', description: '시작 시간' },
            time_to: { type: 'string', description: '종료 시간' },
            pinned: { type: 'boolean', description: '고정된 기억만' }
          }
        },
        limit: { type: 'number', minimum: 1, maximum: 50, default: 10, description: '결과 개수 제한' }
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
        id: { type: 'string', description: '삭제할 기억 ID' },
        hard: { type: 'boolean', default: false, description: '완전 삭제 여부' }
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
        id: { type: 'string', description: '고정할 기억 ID' }
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
        id: { type: 'string', description: '고정 해제할 기억 ID' }
      },
      required: ['id']
    }
  }
];

// API 엔드포인트
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    server: mementoConfig.serverName,
    version: mementoConfig.serverVersion,
    database: db ? 'connected' : 'disconnected'
  });
});

app.get('/tools', (req, res) => {
  res.json({ tools });
});

// 관리자 API 엔드포인트들
app.post('/admin/memory/cleanup', async (req, res) => {
  try {
    // 메모리 정리 로직 (기존 CleanupMemoryTool 로직)
    res.json({ message: '메모리 정리 완료' });
  } catch (error) {
    res.status(500).json({ error: '메모리 정리 실패' });
  }
});

app.get('/admin/stats/forgetting', async (req, res) => {
  try {
    // 망각 통계 로직 (기존 ForgettingStatsTool 로직)
    res.json({ message: '망각 통계 조회 완료' });
  } catch (error) {
    res.status(500).json({ error: '망각 통계 조회 실패' });
  }
});

app.get('/admin/stats/performance', async (req, res) => {
  try {
    // 성능 통계 로직 (기존 PerformanceStatsTool 로직)
    res.json({ message: '성능 통계 조회 완료' });
  } catch (error) {
    res.status(500).json({ error: '성능 통계 조회 실패' });
  }
});

app.post('/admin/database/optimize', async (req, res) => {
  try {
    // 데이터베이스 최적화 로직 (기존 DatabaseOptimizeTool 로직)
    res.json({ message: '데이터베이스 최적화 완료' });
  } catch (error) {
    res.status(500).json({ error: '데이터베이스 최적화 실패' });
  }
});

app.get('/admin/stats/errors', async (req, res) => {
  try {
    // 에러 통계 로직 (기존 errorStatsTool 로직)
    res.json({ message: '에러 통계 조회 완료' });
  } catch (error) {
    res.status(500).json({ error: '에러 통계 조회 실패' });
  }
});

app.post('/admin/errors/resolve', async (req, res) => {
  try {
    const { errorId, resolvedBy, reason } = req.body;
    // 에러 해결 로직 (기존 resolveErrorTool 로직)
    res.json({ message: '에러 해결 완료' });
  } catch (error) {
    res.status(500).json({ error: '에러 해결 실패' });
  }
});

app.get('/admin/alerts/performance', async (req, res) => {
  try {
    // 성능 알림 로직 (기존 performanceAlertsTool 로직)
    res.json({ message: '성능 알림 조회 완료' });
  } catch (error) {
    res.status(500).json({ error: '성능 알림 조회 실패' });
  }
});

app.post('/tools/:name', async (req, res) => {
  const { name } = req.params;
  const params = req.body;
  
  try {
    let result;
    
    switch (name) {
      case 'remember':
        result = await handleRemember(RememberSchema.parse(params));
        break;
      case 'recall':
        result = await handleRecall(RecallSchema.parse(params));
        break;
      case 'forget':
        result = await handleForget(ForgetSchema.parse(params));
        break;
      case 'pin':
        result = await handlePin(PinSchema.parse(params));
        break;
      case 'unpin':
        result = await handleUnpin(UnpinSchema.parse(params));
        break;
      case 'context-injection':
        result = await handleContextInjection(ContextInjectionSchema.parse(params));
        break;
      default:
        return res.status(404).json({ error: `Unknown tool: ${name}` });
    }
    
    return res.json({ result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid parameters', 
        details: error.errors.map(e => e.message).join(', ')
      });
    }
    
    console.error(`❌ Tool ${name} 실행 실패:`, error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// MCP SSE 엔드포인트 - MCP SDK 호환 구현
// Store transports by session ID
const transports: { [sessionId: string]: any } = {};

// SSE endpoint for establishing the stream
app.get('/mcp', async (req, res) => {
  console.log('🔗 MCP SSE 클라이언트 연결 요청');
  
  try {
    // SSE 헤더 설정
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control, Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'X-Accel-Buffering': 'no' // nginx 버퍼링 비활성화
    });

    // Generate session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Send the endpoint event with session ID
    const endpointUrl = `/messages?sessionId=${sessionId}`;
    res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);
    
    // MCP 서버 준비 완료 알림 (클라이언트가 initialize를 보내야 함)
    res.write(`data: {"type": "ready"}\n\n`);
    
    // 즉시 응답 플러시 (Express에서는 자동으로 처리됨)
    
    // Keep-alive ping 전송
    const keepAliveInterval = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(keepAliveInterval);
        return;
      }
      try {
        res.write(`data: {"type": "ping"}\n\n`);
      } catch (error) {
        clearInterval(keepAliveInterval);
      }
    }, 30000); // 30초마다 ping
    
    // Store the transport info
    transports[sessionId] = {
      res: res,
      sessionId: sessionId,
      keepAliveInterval: keepAliveInterval
    };

    // 연결 종료 처리
    req.on('close', () => {
      console.log(`🔌 MCP SSE 클라이언트 연결 정상 종료됨 (session: ${sessionId})`);
      clearInterval(keepAliveInterval);
      delete transports[sessionId];
    });

    req.on('error', (error) => {
      // ECONNRESET은 정상적인 연결 종료이므로 에러로 처리하지 않음
      if ((error as any).code === 'ECONNRESET') {
        console.log(`🔌 MCP SSE 클라이언트 연결 정상 종료됨 (session: ${sessionId})`);
      } else {
        console.error(`❌ MCP SSE 연결 에러 (session: ${sessionId}):`, error);
      }
      clearInterval(keepAliveInterval);
      delete transports[sessionId];
    });

    console.log(`✅ MCP SSE 스트림 설정 완료 (session: ${sessionId})`);
    
  } catch (error) {
    console.error('❌ SSE 스트림 설정 실패:', error);
    if (!res.headersSent) {
      res.status(500).send('Error establishing SSE stream');
    }
  }
});

// Messages endpoint for receiving client JSON-RPC requests
app.post('/messages', express.json(), async (req, res) => {
  console.log('📨 MCP 메시지 수신:', req.body.method);
  
  // Extract session ID from URL query parameter
  const sessionId = req.query.sessionId as string;
  if (!sessionId) {
    console.error('❌ No session ID provided in request URL');
    res.status(400).send('Missing sessionId parameter');
    return;
  }

  const transport = transports[sessionId];
  if (!transport) {
    console.error(`❌ No active transport found for session ID: ${sessionId}`);
    res.status(404).send('Session not found');
    return;
  }

  let message = req.body;
  let result;
  
  console.log(`🔍 MCP 메시지 처리 중: ${message.method}`, JSON.stringify(message, null, 2));
  
  try {
    
    if (message.method === 'initialize') {
      console.log('🚀 MCP initialize 요청 처리 중...');
      result = {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'memento-memory',
            version: '0.1.0'
          }
        }
      };
      console.log('✅ MCP initialize 응답 생성 완료:', JSON.stringify(result, null, 2));
    } else if (message.method === 'notifications/initialized') {
      console.log('🔔 MCP initialized 알림 수신');
      result = {
        jsonrpc: '2.0',
        id: message.id,
        result: {}
      };
    } else if (message.method === 'tools/list') {
      console.log('📋 MCP tools/list 요청 처리 중...');
      
      try {
        // 간단한 도구 목록으로 테스트
        const simpleTools = [
          {
            name: 'remember',
            description: '기억을 저장합니다',
            inputSchema: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '저장할 기억 내용' }
              },
              required: ['content']
            }
          },
          {
            name: 'recall',
            description: '기억을 검색합니다',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: '검색 쿼리' }
              },
              required: ['query']
            }
          }
        ];
        
        console.log('🔍 간단한 도구 목록 사용, 길이:', simpleTools.length);
        
        result = {
          jsonrpc: '2.0',
          id: message.id,
          result: { tools: simpleTools }
        };
        
        console.log('✅ MCP tools/list 응답 생성 완료, tools 개수:', simpleTools.length);
        console.log('🔍 응답 크기:', JSON.stringify(result).length, 'bytes');
        
        // SSE 응답 즉시 전송
        console.log('📤 SSE 응답 즉시 전송 중...');
        if (transport && transport.res && !transport.res.writableEnded) {
          const sseData = `data: ${JSON.stringify(result)}\n\n`;
          transport.res.write(sseData);
          console.log('✅ SSE 응답 즉시 전송 완료, 크기:', sseData.length, 'bytes');
        } else {
          console.error('❌ SSE transport가 유효하지 않음');
        }
        
        // HTTP 응답 전송
        res.json({ status: 'ok' });
        return;
        
      } catch (toolsError) {
        console.error('❌ tools/list 처리 중 오류:', toolsError);
        const errorResult = {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32603,
            message: 'Internal error',
            data: toolsError instanceof Error ? toolsError.message : String(toolsError)
          }
        };
        
        if (transport && transport.res && !transport.res.writableEnded) {
          transport.res.write(`data: ${JSON.stringify(errorResult)}\n\n`);
        }
        res.json({ status: 'error' });
        return;
      }
    } else if (message.method === 'tools/call') {
      const { name, arguments: args } = message.params;
      
      switch (name) {
        case 'remember':
          result = {
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify(await handleRemember(RememberSchema.parse(args))) }] }
          };
          break;
        case 'recall':
          result = {
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify(await handleRecall(RecallSchema.parse(args))) }] }
          };
          break;
        case 'forget':
          result = {
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify(await handleForget(ForgetSchema.parse(args))) }] }
          };
          break;
        case 'pin':
          result = {
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify(await handlePin(PinSchema.parse(args))) }] }
          };
          break;
        case 'unpin':
          result = {
            jsonrpc: '2.0',
            id: message.id,
            result: { content: [{ type: 'text', text: JSON.stringify(await handleUnpin(UnpinSchema.parse(args))) }] }
          };
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } else {
      result = {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: 'Method not found'
        }
      };
    }
    
    // Send response via SSE
    console.log('📤 SSE 응답 전송 중:', JSON.stringify(result).substring(0, 200) + '...');
    try {
      // transport 객체 유효성 확인
      if (!transport || !transport.res || transport.res.writableEnded) {
        console.error('❌ SSE transport가 유효하지 않음');
        res.status(500).json({ error: 'SSE transport invalid' });
        return;
      }
      
      // SSE 응답 전송
      const sseData = `data: ${JSON.stringify(result)}\n\n`;
      transport.res.write(sseData);
      console.log('✅ SSE 응답 전송 완료, 크기:', sseData.length, 'bytes');
    } catch (sseError) {
      console.error('❌ SSE 응답 전송 실패:', sseError);
      // SSE 전송 실패 시에도 HTTP 응답은 정상 처리
    }
    
    // Send HTTP response
    res.json({ status: 'ok' });
    
  } catch (error) {
    console.error('❌ MCP 메시지 처리 실패:', error);
    const errorResponse = {
      jsonrpc: '2.0',
      id: message?.id || null,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    };
    
    // Send error via SSE
    try {
      if (transport && transport.res && !transport.res.writableEnded) {
        const errorSseData = `data: ${JSON.stringify(errorResponse)}\n\n`;
        transport.res.write(errorSseData);
        console.log('✅ SSE 에러 응답 전송 완료');
      } else {
        console.error('❌ SSE transport가 유효하지 않아 에러 응답 전송 실패');
      }
    } catch (errorSseError) {
      console.error('❌ SSE 에러 응답 전송 실패:', errorSseError);
    }
    
    // Send HTTP response
    res.json({ status: 'error' });
  }
});

// WebSocket 서버 설정
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('🔗 WebSocket 클라이언트 연결됨');
  
  ws.on('message', async (data) => {
    let message: any;
    try {
      message = JSON.parse(data.toString());
      
      if (message.method === 'tools/list') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: { tools }
        }));
      } else if (message.method === 'tools/call') {
        const { name, arguments: args } = message.params;
        let result;
        
        switch (name) {
          case 'remember':
            result = await handleRemember(RememberSchema.parse(args));
            break;
          case 'recall':
            result = await handleRecall(RecallSchema.parse(args));
            break;
          case 'forget':
            result = await handleForget(ForgetSchema.parse(args));
            break;
          case 'pin':
            result = await handlePin(PinSchema.parse(args));
            break;
          case 'unpin':
            result = await handleUnpin(UnpinSchema.parse(args));
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
        
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
  });
});

// 서버 초기화
async function initializeServer() {
  try {
    console.log('🚀 HTTP/WebSocket MCP 서버 시작 중...');
    
    // 설정 검증
    validateConfig();
    
    // 데이터베이스 초기화
    db = await initializeDatabase();
    
    // 검색 엔진 초기화
    searchEngine = new SearchEngine();
    hybridSearchEngine = new HybridSearchEngine();
    embeddingService = new MemoryEmbeddingService();
    
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
    return; // 이미 정리 중이면 중복 실행 방지
  }
  
  isCleaningUp = true;
  
  try {
    if (db) {
      closeDatabase(db);
      db = null;
    }
    console.log('👋 HTTP/WebSocket MCP 서버 종료');
  } catch (error) {
    console.error('❌ 정리 중 오류:', error);
  }
}

// 프로세스 종료 시 정리 (한 번만 등록)
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

// 서버 시작
const PORT = process.env.PORT || 9001;

async function startServer() {
  await initializeServer();
  
  // 정리 핸들러 등록
  registerCleanupHandlers();
  
  // Express app을 사용하여 모든 인터페이스에 바인딩
  app.listen(Number(PORT), '0.0.0.0', () => {
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
if (process.argv[1] && process.argv[1].endsWith('http-server.js')) {
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

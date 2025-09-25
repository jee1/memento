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
    
    console.log('✅ 서버 초기화 완료');
    console.log(`📊 서버: ${mementoConfig.serverName} v${mementoConfig.serverVersion}`);
    console.log(`🗄️  데이터베이스: ${mementoConfig.dbPath}`);
    
  } catch (error) {
    console.error('❌ 서버 초기화 실패:', error);
    process.exit(1);
  }
}

// 정리 함수
async function cleanup() {
  if (db) {
    closeDatabase(db);
    db = null;
  }
  console.log('👋 HTTP/WebSocket MCP 서버 종료');
}

// 프로세스 종료 시 정리
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('uncaughtException', (error) => {
  console.error('❌ 예상치 못한 오류:', error);
  cleanup();
  process.exit(1);
});

// 서버 시작
const PORT = process.env.PORT || 3000;

async function startServer() {
  await initializeServer();
  
  server.listen(PORT, () => {
    console.log(`🌐 HTTP 서버: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket 서버: ws://localhost:${PORT}`);
    console.log(`📋 API 문서: http://localhost:${PORT}/tools`);
    console.log(`❤️  헬스 체크: http://localhost:${PORT}/health`);
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

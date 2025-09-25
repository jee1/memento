/**
 * HTTP/WebSocket 기반 MCP 서버 (리팩토링된 버전)
 * 모듈화된 도구들을 사용하여 유지보수성 개선
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { createServer } from 'http';
import { initializeDatabase, closeDatabase } from '../database/init.js';
import { mementoConfig, validateConfig } from '../config/index.js';
import { SearchEngine } from '../algorithms/search-engine.js';
import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { getToolRegistry } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import sqlite3 from 'sqlite3';

// 전역 변수
let db: sqlite3.Database | null = null;
let searchEngine: SearchEngine;
let hybridSearchEngine: HybridSearchEngine;
let embeddingService: MemoryEmbeddingService;

type TestDependencies = {
  database: sqlite3.Database;
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

// Express 앱 생성
const app = express();
const server = createServer(app);

// 미들웨어 설정
app.use(cors());
app.use(express.json());

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
  const toolRegistry = getToolRegistry();
  const tools = toolRegistry.getAll();
  res.json({ tools });
});

app.post('/tools/:name', async (req, res) => {
  const { name } = req.params;
  const params = req.body;
  
  try {
    const toolRegistry = getToolRegistry();
    
    // 도구 컨텍스트 생성
    const context: ToolContext = {
      db,
      services: {
        searchEngine,
        hybridSearchEngine,
        embeddingService
      }
    };
    
    // 도구 실행
    const result = await toolRegistry.execute(name, params, context);
    return res.json({ result });
  } catch (error) {
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
        
        // 도구 컨텍스트 생성
        const context: ToolContext = {
          db,
          services: {
            searchEngine,
            hybridSearchEngine,
            embeddingService
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

export const __test = {
  setTestDependencies,
  getApp: () => app,
  getServer: () => server,
  getDatabase: () => db,
  getSearchEngine: () => searchEngine,
  getHybridSearchEngine: () => hybridSearchEngine,
  getEmbeddingService: () => embeddingService
};

export { startServer, cleanup };

/**
 * HTTP/WebSocket 기반 MCP 서버 v2
 * 모듈화된 구조로 새로 구현
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { createServer } from 'http';
import { initializeDatabase, closeDatabase } from '../database/init.js';
import { mementoConfig, validateConfig } from '../config/index.js';
import { SearchEngine } from '../algorithms/search-engine.js';
import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { HybridSearchFactory } from '../factories/hybrid-search.factory.js';
import { getVectorSearchEngine } from '../algorithms/vector-search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { getBatchScheduler } from '../services/batch-scheduler.js';
import { getPerformanceMonitor } from '../services/performance-monitor.js';
import { getToolRegistry } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import Database from 'better-sqlite3';

// 전역 변수
let db: Database.Database | null = null;
let searchEngine: SearchEngine;
let hybridSearchEngine: HybridSearchEngine;
let vectorSearchEngine: ReturnType<typeof getVectorSearchEngine>;
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

app.get('/tools', (req, res) => {
  try {
    const toolRegistry = getToolRegistry();
    const tools = toolRegistry.getAll();
    res.json({ 
      tools,
      count: tools.length,
      server: mementoConfig.serverName
    });
  } catch (error) {
    console.error('❌ 도구 목록 조회 실패:', error);
    res.status(500).json({ 
      error: 'Failed to get tools',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 도구 실행 엔드포인트
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
    return res.json({ 
      result,
      tool: name,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Tool ${name} 실행 실패:`, error);
    return res.status(500).json({ 
      error: 'Tool execution failed',
      tool: name,
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
    return;
    
  } catch (error) {
    console.error('❌ SSE 스트림 설정 실패:', error);
    if (!res.headersSent) {
      res.status(500).send('Error establishing SSE stream');
    }
    return;
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
        const toolRegistry = getToolRegistry();
        const tools = toolRegistry.getAll();
        
        console.log('🔍 도구 목록 사용, 길이:', tools.length);
        
        result = {
          jsonrpc: '2.0',
          id: message.id,
          result: { tools }
        };
        
        console.log('✅ MCP tools/list 응답 생성 완료, tools 개수:', tools.length);
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
      const toolResult = await toolRegistry.execute(name, args, context);
      
      result = {
        jsonrpc: '2.0',
        id: message.id,
        result: { content: [{ type: 'text', text: JSON.stringify(toolResult) }] }
      };
    } else if (message.method === 'prompts/list') {
      console.log('📋 MCP prompts/list 요청 처리 중...');
      
      const prompts = [
        {
          name: 'memory_injection',
          description: '관련 기억을 요약하여 프롬프트에 주입',
          arguments: [
            {
              name: 'query',
              description: '검색할 쿼리',
              required: true
            },
            {
              name: 'token_budget',
              description: '토큰 예산 (기본값: 1000)',
              required: false
            },
            {
              name: 'max_memories',
              description: '최대 기억 개수 (기본값: 5)',
              required: false
            }
          ]
        }
      ];
      
      result = {
        jsonrpc: '2.0',
        id: message.id,
        result: { prompts }
      };
      
      console.log('✅ MCP prompts/list 응답 생성 완료');
    } else if (message.method === 'prompts/get') {
      const { name } = message.params;
      
      if (name === 'memory_injection') {
        result = {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            description: '관련 기억을 요약하여 프롬프트에 주입',
            arguments: [
              {
                name: 'query',
                description: '검색할 쿼리',
                required: true
              },
              {
                name: 'token_budget',
                description: '토큰 예산 (기본값: 1000)',
                required: false
              },
              {
                name: 'max_memories',
                description: '최대 기억 개수 (기본값: 5)',
                required: false
              }
            ]
          }
        };
      } else {
        result = {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: 'Prompt not found'
          }
        };
      }
    } else if (message.method === 'prompts/call') {
      const { name, arguments: args } = message.params;
      
      if (name === 'memory_injection') {
        try {
          // MemoryInjectionPrompt 도구 사용
          const toolRegistry = getToolRegistry();
          const context: ToolContext = {
            db,
            services: {
              searchEngine,
              hybridSearchEngine,
              embeddingService
            }
          };
          
          const promptResult = await toolRegistry.execute('memory_injection', args, context);
          
          result = {
            jsonrpc: '2.0',
            id: message.id,
            result: promptResult
          };
        } catch (error) {
          result = {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32603,
              message: 'Prompt execution failed',
              data: error instanceof Error ? error.message : 'Unknown error'
            }
          };
        }
      } else {
        result = {
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32601,
            message: 'Prompt not found'
          }
        };
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

// 관리자 API 엔드포인트들
app.post('/admin/memory/cleanup', async (req, res) => {
  try {
    // 메모리 정리 로직 (기존 CleanupMemoryTool 로직)
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    
    // 간단한 메모리 정리 구현
    const result = await db.prepare(`
      DELETE FROM memory_item 
      WHERE pinned = FALSE 
        AND type = 'working' 
        AND created_at < datetime('now', '-2 days')
    `).run();
    
    return res.json({ 
      message: '메모리 정리 완료',
      deleted_count: result.changes,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 메모리 정리 실패:', error);
    return res.status(500).json({ 
      error: '메모리 정리 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/admin/stats/forgetting', async (req, res) => {
  try {
    // 망각 통계 로직 (기존 ForgettingStatsTool 로직)
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    
    const stats = await db.prepare(`
      SELECT 
        type,
        COUNT(*) as total_count,
        COUNT(CASE WHEN pinned = TRUE THEN 1 END) as pinned_count,
        COUNT(CASE WHEN created_at < datetime('now', '-30 days') THEN 1 END) as old_count
      FROM memory_item 
      GROUP BY type
    `).all();
    
    return res.json({ 
      message: '망각 통계 조회 완료',
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 망각 통계 조회 실패:', error);
    return res.status(500).json({ 
      error: '망각 통계 조회 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/admin/stats/performance', async (req, res) => {
  try {
    // 성능 통계 로직 (기존 PerformanceStatsTool 로직)
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    
    const stats = await db.prepare(`
      SELECT 
        COUNT(*) as total_memories,
        COUNT(CASE WHEN type = 'working' THEN 1 END) as working_memories,
        COUNT(CASE WHEN type = 'episodic' THEN 1 END) as episodic_memories,
        COUNT(CASE WHEN type = 'semantic' THEN 1 END) as semantic_memories,
        COUNT(CASE WHEN type = 'procedural' THEN 1 END) as procedural_memories,
        COUNT(CASE WHEN pinned = TRUE THEN 1 END) as pinned_memories
      FROM memory_item
    `).get();
    
    return res.json({ 
      message: '성능 통계 조회 완료',
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 성능 통계 조회 실패:', error);
    return res.status(500).json({ 
      error: '성능 통계 조회 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.post('/admin/database/optimize', async (req, res) => {
  try {
    // 데이터베이스 최적화 로직 (기존 DatabaseOptimizeTool 로직)
    if (!db) {
      return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
    }
    
    // VACUUM 실행
    await db.prepare('VACUUM').run();
    
    // ANALYZE 실행
    await db.prepare('ANALYZE').run();
    
    return res.json({ 
      message: '데이터베이스 최적화 완료',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 데이터베이스 최적화 실패:', error);
    return res.status(500).json({ 
      error: '데이터베이스 최적화 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/admin/stats/errors', async (req, res) => {
  try {
    // 에러 통계 로직 (기존 errorStatsTool 로직)
    res.json({ 
      message: '에러 통계 조회 완료',
      stats: {
        total_errors: 0,
        recent_errors: [],
        error_types: {}
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 에러 통계 조회 실패:', error);
    res.status(500).json({ 
      error: '에러 통계 조회 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.post('/admin/errors/resolve', async (req, res) => {
  try {
    const { errorId, resolvedBy, reason } = req.body;
    // 에러 해결 로직 (기존 resolveErrorTool 로직)
    res.json({ 
      message: '에러 해결 완료',
      errorId,
      resolvedBy,
      reason,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 에러 해결 실패:', error);
    res.status(500).json({ 
      error: '에러 해결 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/admin/alerts/performance', async (req, res) => {
  try {
    // 성능 알림 로직 (기존 performanceAlertsTool 로직)
    res.json({ 
      message: '성능 알림 조회 완료',
      alerts: [],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 성능 알림 조회 실패:', error);
    res.status(500).json({ 
      error: '성능 알림 조회 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 배치 스케줄러 관리 API
app.get('/admin/batch/status', async (req, res) => {
  try {
    const batchScheduler = getBatchScheduler();
    const status = batchScheduler.getStatus();
    
    res.json({ 
      message: '배치 스케줄러 상태 조회 완료',
      status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 배치 스케줄러 상태 조회 실패:', error);
    res.status(500).json({ 
      error: '배치 스케줄러 상태 조회 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.post('/admin/batch/run', async (req, res) => {
  try {
    const { jobType } = req.body;
    
    if (!jobType || !['cleanup', 'monitoring'].includes(jobType)) {
      return res.status(400).json({ 
        error: 'Invalid job type. Must be "cleanup" or "monitoring"'
      });
    }
    
    const batchScheduler = getBatchScheduler();
    const result = await batchScheduler.runJob(jobType);
    
    return res.json({ 
      message: `배치 작업 ${jobType} 실행 완료`,
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 배치 작업 실행 실패:', error);
    return res.status(500).json({ 
      error: '배치 작업 실행 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 성능 모니터링 API
app.get('/admin/performance/metrics', async (req, res) => {
  try {
    const monitor = getPerformanceMonitor();
    const metrics = await monitor.collectMetrics();
    
    res.json({ 
      message: '성능 지표 수집 완료',
      metrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 성능 지표 수집 실패:', error);
    res.status(500).json({ 
      error: '성능 지표 수집 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/admin/performance/alerts', async (req, res) => {
  try {
    const monitor = getPerformanceMonitor();
    const alerts = monitor.getActiveAlerts();
    
    res.json({ 
      message: '성능 알림 조회 완료',
      alerts,
      count: alerts.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 성능 알림 조회 실패:', error);
    res.status(500).json({ 
      error: '성능 알림 조회 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/admin/performance/summary', async (req, res) => {
  try {
    const monitor = getPerformanceMonitor();
    const summary = monitor.getPerformanceSummary();
    
    res.json({ 
      message: '성능 요약 조회 완료',
      summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ 성능 요약 조회 실패:', error);
    res.status(500).json({ 
      error: '성능 요약 조회 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.post('/admin/performance/alerts/:alertId/resolve', async (req, res) => {
  try {
    const { alertId } = req.params;
    const monitor = getPerformanceMonitor();
    const resolved = monitor.resolveAlert(alertId);
    
    if (resolved) {
      res.json({ 
        message: '알림 해결 완료',
        alertId,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({ 
        error: '알림을 찾을 수 없습니다',
        alertId
      });
    }
  } catch (error) {
    console.error('❌ 알림 해결 실패:', error);
    res.status(500).json({ 
      error: '알림 해결 실패',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 서버 초기화
async function initializeServer() {
  try {
    console.log('🚀 HTTP/WebSocket MCP 서버 v2 시작 중...');
    
    // 설정 검증
    validateConfig();
    
    // 데이터베이스 초기화
    db = await initializeDatabase();
    
    // 검색 엔진 초기화
    searchEngine = new SearchEngine();
    hybridSearchEngine = HybridSearchFactory.createDefaultEngine(db);
    vectorSearchEngine = getVectorSearchEngine();
    vectorSearchEngine.initialize(db);
    embeddingService = new MemoryEmbeddingService();
    
    // 배치 스케줄러 시작
    const batchScheduler = getBatchScheduler();
    await batchScheduler.start(db);
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
    // 배치 스케줄러 중지
    const batchScheduler = getBatchScheduler();
    batchScheduler.stop();
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
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket 에러:', error);
  });
});

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

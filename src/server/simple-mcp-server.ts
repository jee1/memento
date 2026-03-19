/**
 * 간단한 MCP 서버 구현
 * SSE 연결 문제 해결을 위한 최소 구현
 * 주의: CORS는 메인 http-server와 동일하게 corsAllowedOrigins로 제한함.
 */

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { logger } from '../shared/utils/logger.js';
import { mementoConfig } from '../shared/config/index.js';
import {
  isHttpBindHostRemotelyReachable,
  canonicalizeHttpBindHostForListen,
  formatHttpBindHostForUrl
} from '../shared/http/http-bind-policy.js';
import { buildMcpManualCorsHeaders } from './utils/cors-policy.js';

const app = express();
const server = createServer(app);

// 미들웨어 설정: CORS는 corsAllowedOrigins로 제한 (메인 http-server와 동일)
const corsOrigins = mementoConfig.corsAllowedOrigins;
app.use(cors({
  origin: corsOrigins.length > 0
    ? corsOrigins
    : (_orig: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => cb(null, false),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control']
}));
app.use(express.json());

// 간단한 도구 목록
const tools = [
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

// SSE 엔드포인트
app.get('/mcp', (req, res) => {
  logger.info('🔗 MCP SSE 클라이언트 연결 요청');

  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  const manualCors = buildMcpManualCorsHeaders(origin, corsOrigins);
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    ...manualCors
  };

  res.writeHead(200, headers);

  // 세션 ID 생성
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // 엔드포인트 이벤트 전송
  const endpointUrl = `/messages?sessionId=${sessionId}`;
  res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);
  
  // 준비 완료 알림
  res.write(`data: {"type": "ready"}\n\n`);
  
  logger.info(`✅ MCP SSE 스트림 설정 완료 (session: ${sessionId})`);
  
  // 연결 종료 처리
  req.on('close', () => {
    logger.info(`🔌 MCP SSE 클라이언트 연결 해제됨 (session: ${sessionId})`);
  });
});

// 메시지 처리 엔드포인트
app.post('/messages', (req, res) => {
  const sessionId = req.query.sessionId as string;
  const message = req.body;
  
  logger.info(`📨 MCP 메시지 수신: ${message.method} (session: ${sessionId})`);
  
  let result;
  
  try {
    if (message.method === 'initialize') {
      logger.info('🚀 MCP initialize 요청 처리 중...');
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
      logger.info('✅ MCP initialize 응답 생성 완료');
      
    } else if (message.method === 'notifications/initialized') {
      logger.info('🔔 MCP initialized 알림 수신');
      result = {
        jsonrpc: '2.0',
        id: message.id,
        result: {}
      };
      
    } else if (message.method === 'tools/list') {
      logger.info('📋 MCP tools/list 요청 처리 중...');
      result = {
        jsonrpc: '2.0',
        id: message.id,
        result: { tools }
      };
      logger.info('✅ MCP tools/list 응답 생성 완료, tools 개수:', { count: tools.length });
      
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
    
    // SSE 응답 전송 (간단한 방식)
    const sseData = `data: ${JSON.stringify(result)}\n\n`;
    logger.info('📤 SSE 응답 전송 중, 크기:', { size: sseData.length, unit: 'bytes' });
    
    // HTTP 응답 전송
    res.json({ status: 'ok', sseData: sseData.substring(0, 100) + '...' });
    
  } catch (error) {
    logger.error('❌ MCP 메시지 처리 실패:', { error });
    const errorResult = {
      jsonrpc: '2.0',
      id: message?.id || null,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    };
    
    res.json({ status: 'error', error: errorResult });
  }
});

// 헬스 체크
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    server: 'memento-memory',
    version: '0.1.0',
    tools: tools.length
  });
});

// 서버 시작 함수는 export만 유지 (팩토리 패턴 사용)
// 직접 실행 코드는 제거됨 - 팩토리를 통해 서버를 시작해야 함

/**
 * SSE 서버를 시작하는 함수
 * @returns Promise<void> 서버 시작 완료 시 resolve
 */
export async function startSimpleMcpServer(): Promise<void> {
  const PORT = process.env.PORT || 9001;
  const bindHostRaw = (mementoConfig.httpListenHost || '127.0.0.1').trim();
  const bindHostListen = canonicalizeHttpBindHostForListen(bindHostRaw);
  const bindHostForUrl = formatHttpBindHostForUrl(bindHostRaw);

  // `/admin`, `/api`, 품질 라우트가 없는 최소 MCP 전용 서버이므로
  // ADMIN_API_KEY·비루프백 기동 차단(getMementoHttpSecurityStartupViolationMessage)은 적용하지 않는다.
  if (isHttpBindHostRemotelyReachable(bindHostRaw)) {
    logger.warn(
      '간단 MCP 서버가 비루프백 주소에 바인딩됩니다. /mcp·/messages·/health만 노출되며 ' +
        '관리·API·품질 경로는 없습니다. 네트워크·CORS 노출 범위를 확인하세요.'
    );
  }

  return new Promise<void>((resolve) => {
    server.listen(Number(PORT), bindHostListen, () => {
      logger.info(`🌐 간단한 MCP 서버 시작: http://${bindHostForUrl}:${PORT}`);
      logger.info(`📋 도구 개수: ${tools.length}개`);
      logger.info(`❤️  헬스 체크: http://${bindHostForUrl}:${PORT}/health`);
      resolve();
    });
  });
}

export { app, server };

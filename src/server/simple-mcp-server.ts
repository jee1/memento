/**
 * 간단한 MCP 서버 구현
 * SSE 연결 문제 해결을 위한 최소 구현
 */

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';

const app = express();
const server = createServer(app);

// 미들웨어 설정
app.use(cors());
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
  console.log('🔗 MCP SSE 클라이언트 연결 요청');
  
  // SSE 헤더 설정
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control, Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });

  // 세션 ID 생성
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // 엔드포인트 이벤트 전송
  const endpointUrl = `/messages?sessionId=${sessionId}`;
  res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);
  
  // 준비 완료 알림
  res.write(`data: {"type": "ready"}\n\n`);
  
  console.log(`✅ MCP SSE 스트림 설정 완료 (session: ${sessionId})`);
  
  // 연결 종료 처리
  req.on('close', () => {
    console.log(`🔌 MCP SSE 클라이언트 연결 해제됨 (session: ${sessionId})`);
  });
});

// 메시지 처리 엔드포인트
app.post('/messages', (req, res) => {
  const sessionId = req.query.sessionId as string;
  const message = req.body;
  
  console.log(`📨 MCP 메시지 수신: ${message.method} (session: ${sessionId})`);
  
  let result;
  
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
      console.log('✅ MCP initialize 응답 생성 완료');
      
    } else if (message.method === 'notifications/initialized') {
      console.log('🔔 MCP initialized 알림 수신');
      result = {
        jsonrpc: '2.0',
        id: message.id,
        result: {}
      };
      
    } else if (message.method === 'tools/list') {
      console.log('📋 MCP tools/list 요청 처리 중...');
      result = {
        jsonrpc: '2.0',
        id: message.id,
        result: { tools }
      };
      console.log('✅ MCP tools/list 응답 생성 완료, tools 개수:', tools.length);
      
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
    console.log('📤 SSE 응답 전송 중, 크기:', sseData.length, 'bytes');
    
    // HTTP 응답 전송
    res.json({ status: 'ok', sseData: sseData.substring(0, 100) + '...' });
    
  } catch (error) {
    console.error('❌ MCP 메시지 처리 실패:', error);
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

// 서버 시작
const PORT = process.env.PORT || 9001;

server.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🌐 간단한 MCP 서버 시작: http://0.0.0.0:${PORT}`);
  console.log(`📋 도구 개수: ${tools.length}개`);
  console.log(`❤️  헬스 체크: http://0.0.0.0:${PORT}/health`);
});

export { app, server };

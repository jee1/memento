#!/usr/bin/env node

/**
 * Memento MCP Simple Client
 * HTTP 서버와 통신하는 간단한 MCP 클라이언트
 */

import { spawn } from 'child_process';

const serverUrl = process.env.MEMENTO_SERVER_URL || 'http://localhost:9001';
const apiKey = process.env.MEMENTO_API_KEY || 'default-key';

// HTTP 서버와 통신하는 함수
async function callHttpTool(toolName, args) {
  try {
    const response = await fetch(`${serverUrl}/tools/${toolName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Memento-MCP-Client/1.0.0'
      },
      body: JSON.stringify(args)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return result.result || result;
  } catch (error) {
    throw new Error(`Tool execution failed: ${error.message}`);
  }
}

async function getHttpTools() {
  try {
    const response = await fetch(`${serverUrl}/tools`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'Memento-MCP-Client/1.0.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return result.tools || [];
  } catch (error) {
    throw new Error(`Failed to get tools: ${error.message}`);
  }
}

// MCP 프로토콜 처리
let requestId = 0;

function sendResponse(id, result, error = null) {
  const response = {
    jsonrpc: '2.0',
    id: id
  };
  
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }
  
  process.stderr.write(`📤 응답 전송: ${JSON.stringify(response).substring(0, 100)}...\n`);
  console.log(JSON.stringify(response));
}

async function handleRequest(request) {
  const { method, params, id } = request;
  
  process.stderr.write(`📨 요청 수신: ${method} (ID: ${id})\n`);
  
  try {
    if (method === 'initialize') {
      process.stderr.write(`🚀 initialize 요청 처리 중...\n`);
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'memento-http-client',
          version: '1.0.0'
        }
      });
    } else if (method === 'notifications/initialized') {
      // This is a notification. Do not send a response.
      process.stderr.write(`🔔 initialized 알림 수신, 무시합니다.\n`);
    } else if (method === 'tools/list') {
      process.stderr.write(`📋 tools/list 요청 처리 중...\n`);
      const tools = await getHttpTools();
      process.stderr.write(`🔧 도구 개수: ${tools.length}\n`);
      sendResponse(id, { tools });
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params;
      process.stderr.write(`🔧 도구 실행: ${name}\n`);
      const result = await callHttpTool(name, args);
      
      sendResponse(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      });
    } else {
      // Unknown method
      if (id !== undefined && id !== null) {
        // Only send an error if it was a request (i.e., it had an ID).
        process.stderr.write(`❌ 알 수 없는 메서드: ${method}\n`);
        sendResponse(id, null, {
          code: -32601,
          message: 'Method not found'
        });
      } else {
        // It's an unknown notification, ignore it silently.
        process.stderr.write(`🔔 알 수 없는 알림 수신, 무시합니다: ${method}\n`);
      }
    }
  } catch (error) {
    process.stderr.write(`❌ 요청 처리 실패: ${error.message}\n`);
    if (id !== undefined && id !== null) {
      sendResponse(id, null, {
        code: -32603,
        message: 'Internal error',
        data: error.message
      });
    }
  }
}

// 서버 상태 확인
async function checkServerHealth() {
  try {
    const response = await fetch(`${serverUrl}/health`);
    if (response.ok) {
      const health = await response.json();
      process.stderr.write(`✅ 서버 연결 확인: ${health.status}\n`);
      return true;
    }
  } catch (error) {
    process.stderr.write(`❌ 서버 연결 실패: ${error.message}\n`);
  }
  return false;
}

// 메인 처리
async function main() {
  process.stderr.write(`🚀 Memento MCP 클라이언트 시작\n`);
  process.stderr.write(`🔗 서버 URL: ${serverUrl}\n`);
  
  // 서버 상태 확인
  const isHealthy = await checkServerHealth();
  if (!isHealthy) {
    process.exit(1);
  }
  
  process.stderr.write(`📡 stdin 대기 중...\n`);
  
  // stdin에서 JSON-RPC 요청 읽기
  let buffer = '';
  
  process.stdin.on('data', async (chunk) => {
    const data = chunk.toString();
    buffer += data;
    
    // Process complete JSON objects
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        try {
          const request = JSON.parse(trimmed);
          await handleRequest(request);
        } catch (error) {
          process.stderr.write(`❌ JSON 파싱 오류: ${error.message} on line: ${trimmed}\n`);
        }
      }
    }
  });
  
  process.stdin.on('end', () => {
    process.stderr.write(`📡 stdin 종료\n`);
    process.exit(0);
  });
  
  process.stdin.on('error', (error) => {
    process.stderr.write(`❌ stdin 오류: ${error.message}\n`);
    process.exit(1);
  });
}

// 프로세스 종료 시 정리
process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

// 클라이언트 시작
main().catch(error => {
  process.stderr.write(`❌ 클라이언트 시작 실패: ${error.message}\n`);
  process.exit(1);
});

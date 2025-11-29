/**
 * HTTP 서버 v2 테스트 스크립트
 * 모듈화된 구조의 HTTP 서버 v2 기능 검증
 */

import { startServer, cleanup, __test } from '../server/http-server.js';
import { initializeDatabase, closeDatabase } from '../database/init.js';
import { SearchEngine } from '../domains/search/algorithms/search-engine.js';
import { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
// eventsource는 CommonJS 모듈이므로 createRequire 사용
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const EventSourceModule = require('eventsource');
// EventSource는 모듈 객체의 EventSource 속성
const EventSource = EventSourceModule.EventSource || EventSourceModule.default || EventSourceModule;

// 테스트용 데이터베이스 설정
const TEST_DB_PATH = 'data/memory-test-v2.db';

async function setupTestDatabase() {
  console.log('🗄️ 테스트 데이터베이스 설정 중...');
  
  // 기존 테스트 DB 삭제
  try {
    const fs = await import('fs');
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  } catch (error) {
    // 파일이 없으면 무시
  }
  
  // 새 테스트 DB 생성
  const db = new Database(TEST_DB_PATH);
  
  // 스키마 생성
  const schema = `
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')),
      content TEXT NOT NULL,
      importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
      privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      source TEXT,
      agent_id TEXT,
      user_id TEXT,
      project_id TEXT,
      origin_trace TEXT,
      tags TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_embedding (
      memory_id TEXT PRIMARY KEY,
      embedding BLOB,
      dim INTEGER NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_tag (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_item_tag (
      memory_id TEXT,
      tag_id INTEGER,
      PRIMARY KEY (memory_id, tag_id),
      FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES memory_tag(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT CHECK (relation_type IN ('cause_of', 'derived_from', 'duplicates', 'contradicts')),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feedback_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      event_type TEXT CHECK (event_type IN ('used', 'edited', 'neglected', 'helpful', 'not_helpful')),
      score REAL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wm_buffer (
      session_id TEXT PRIMARY KEY,
      items TEXT NOT NULL,
      token_budget INTEGER DEFAULT 4000,
      expires_at TIMESTAMP NOT NULL
    );

    -- FTS5 텍스트 검색 인덱스
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts USING fts5(
      content,
      content='memory_item',
      content_rowid='rowid'
    );
  `;
  
  db.exec(schema);
  
  // 테스트 데이터 삽입
  const testMemories = [
    {
      id: 'test_mem_1',
      type: 'episodic',
      content: 'HTTP 서버 v2 테스트를 위한 첫 번째 기억입니다.',
      importance: 0.8,
      tags: JSON.stringify(['test', 'http-server', 'v2'])
    },
    {
      id: 'test_mem_2',
      type: 'semantic',
      content: '모듈화된 구조의 장점에 대한 지식입니다.',
      importance: 0.9,
      tags: JSON.stringify(['architecture', 'modularity'])
    },
    {
      id: 'test_mem_3',
      type: 'working',
      content: '현재 진행 중인 테스트 작업입니다.',
      importance: 0.6,
      tags: JSON.stringify(['working', 'test'])
    }
  ];
  
  const insertStmt = db.prepare(`
    INSERT INTO memory_item (id, type, content, importance, tags, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  
  for (const memory of testMemories) {
    insertStmt.run(memory.id, memory.type, memory.content, memory.importance, memory.tags);
  }
  
  console.log('✅ 테스트 데이터베이스 설정 완료');
  return db;
}

// 테스트에서 사용할 포트 (전역 변수)
const TEST_PORT = process.env.PORT ? Number(process.env.PORT) : 9001;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const WS_URL = `ws://localhost:${TEST_PORT}`;

async function testBasicEndpoints() {
  console.log('\n🧪 1️⃣ 기본 엔드포인트 테스트');
  
  try {
    // 헬스 체크 테스트
    console.log('  📋 헬스 체크 테스트...');
    const healthResponse = await fetch(`${BASE_URL}/health`);
    const healthData = await healthResponse.json();
    
    if (healthResponse.ok && healthData.status === 'healthy') {
      console.log('  ✅ 헬스 체크 성공');
    } else {
      throw new Error('헬스 체크 실패');
    }
    
    // 도구 목록 테스트
    console.log('  📋 도구 목록 테스트...');
    const toolsResponse = await fetch(`${BASE_URL}/tools`);
    const toolsData = await toolsResponse.json();
    
    if (toolsResponse.ok && toolsData.tools && toolsData.tools.length >= 5) {
      console.log(`  ✅ 도구 목록 성공 (${toolsData.tools.length}개 도구)`);
      toolsData.tools.forEach((tool: any) => {
        console.log(`    - ${tool.name}: ${tool.description}`);
      });
    } else {
      throw new Error(`도구 목록 조회 실패: ${toolsData.tools?.length || 0}개 도구 (최소 5개 필요)`);
    }
    
  } catch (error) {
    console.error('  ❌ 기본 엔드포인트 테스트 실패:', error);
    throw error;
  }
}

async function testMCPTools() {
  console.log('\n🧪 2️⃣ MCP 도구 테스트');
  
  try {
    // remember 도구 테스트
    console.log('  📝 remember 도구 테스트...');
    const rememberResponse = await fetch(`${BASE_URL}/tools/remember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'HTTP 서버 v2 테스트를 위한 새로운 기억입니다.',
        type: 'episodic',
        tags: ['test', 'v2'],
        importance: 0.7
      })
    });
    
    const rememberData = await rememberResponse.json();
    
    // 디버깅: 응답 확인
    if (!rememberResponse.ok) {
      console.error('  ❌ remember 응답 실패:', {
        status: rememberResponse.status,
        statusText: rememberResponse.statusText,
        data: rememberData
      });
      throw new Error(`remember 테스트 실패: HTTP ${rememberResponse.status} - ${JSON.stringify(rememberData)}`);
    }
    
    if (!rememberData.result) {
      console.error('  ❌ remember 응답에 result가 없음:', rememberData);
      throw new Error(`remember 테스트 실패: result가 없음 - ${JSON.stringify(rememberData)}`);
    }
    
    if (!rememberData.result.memory_id) {
      console.error('  ❌ remember 응답에 memory_id가 없음:', rememberData.result);
      throw new Error(`remember 테스트 실패: memory_id가 없음 - ${JSON.stringify(rememberData.result)}`);
    }
    
    console.log(`  ✅ remember 성공: ${rememberData.result.memory_id}`);
    const testMemoryId = rememberData.result.memory_id;
    
    // recall 도구 테스트
      console.log('  🔍 recall 도구 테스트...');
      const recallResponse = await fetch(`${BASE_URL}/tools/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'HTTP 서버 v2',
          limit: 5
        })
      });
      
      const recallData = await recallResponse.json();
      if (recallResponse.ok && recallData.result && recallData.result.items) {
        console.log(`  ✅ recall 성공: ${recallData.result.items.length}개 결과`);
      } else {
        throw new Error('recall 테스트 실패');
      }
      
      // pin 도구 테스트
      console.log('  📌 pin 도구 테스트...');
      const pinResponse = await fetch(`${BASE_URL}/tools/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: testMemoryId })
      });
      
      const pinData = await pinResponse.json();
      if (pinResponse.ok && pinData.result) {
        console.log('  ✅ pin 성공');
      } else {
        throw new Error('pin 테스트 실패');
      }
      
      // unpin 도구 테스트
      console.log('  📌 unpin 도구 테스트...');
      const unpinResponse = await fetch(`${BASE_URL}/tools/unpin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: testMemoryId })
      });
      
      const unpinData = await unpinResponse.json();
      if (unpinResponse.ok && unpinData.result) {
        console.log('  ✅ unpin 성공');
      } else {
        throw new Error('unpin 테스트 실패');
      }
      
      // forget 도구 테스트 (소프트 삭제)
      console.log('  🗑️ forget 도구 테스트...');
      const forgetResponse = await fetch(`${BASE_URL}/tools/forget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: testMemoryId, hard: false })
      });
      
      const forgetData = await forgetResponse.json();
      if (forgetResponse.ok && forgetData.result) {
        console.log('  ✅ forget 성공');
      } else {
        throw new Error('forget 테스트 실패');
      }
    
  } catch (error) {
    console.error('  ❌ MCP 도구 테스트 실패:', error);
    throw error;
  }
}

async function testAdminAPIs() {
  console.log('\n🧪 3️⃣ 관리자 API 테스트');
  
  try {
    // 성능 통계 테스트
    console.log('  📊 성능 통계 테스트...');
    const perfResponse = await fetch(`${BASE_URL}/admin/stats/performance`);
    const perfData = await perfResponse.json();
    
    if (perfResponse.ok && perfData.message) {
      console.log('  ✅ 성능 통계 성공');
    } else {
      throw new Error('성능 통계 테스트 실패');
    }
    
    // 망각 통계 테스트
    console.log('  📊 망각 통계 테스트...');
    const forgetResponse = await fetch(`${BASE_URL}/admin/stats/forgetting`);
    const forgetData = await forgetResponse.json();
    
    if (forgetResponse.ok && forgetData.message) {
      console.log('  ✅ 망각 통계 성공');
    } else {
      throw new Error('망각 통계 테스트 실패');
    }
    
    // 데이터베이스 최적화 테스트
    console.log('  🔧 데이터베이스 최적화 테스트...');
    const optimizeResponse = await fetch(`${BASE_URL}/admin/database/optimize`, {
      method: 'POST'
    });
    const optimizeData = await optimizeResponse.json();
    
    if (optimizeResponse.ok && optimizeData.message) {
      console.log('  ✅ 데이터베이스 최적화 성공');
    } else {
      throw new Error('데이터베이스 최적화 테스트 실패');
    }
    
    // 메모리 정리 테스트
    console.log('  🧹 메모리 정리 테스트...');
    const cleanupResponse = await fetch(`${BASE_URL}/admin/memory/cleanup`, {
      method: 'POST'
    });
    const cleanupData = await cleanupResponse.json();
    
    if (cleanupResponse.ok && cleanupData.message) {
      console.log('  ✅ 메모리 정리 성공');
    } else {
      throw new Error('메모리 정리 테스트 실패');
    }
    
  } catch (error) {
    console.error('  ❌ 관리자 API 테스트 실패:', error);
    throw error;
  }
}

async function testWebSocket() {
  console.log('\n🧪 4️⃣ WebSocket 연결 테스트');
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    
    let testPassed = 0;
    const totalTests = 2;
    
    ws.on('open', () => {
      console.log('  🔗 WebSocket 연결 성공');
      
      // tools/list 테스트
      const listMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      };
      ws.send(JSON.stringify(listMessage));
    });
    
    ws.on('message', (data: string) => {
      try {
        const response = JSON.parse(data);
        
        if (response.id === 1 && response.result && response.result.tools) {
          console.log(`  ✅ tools/list 성공: ${response.result.tools.length}개 도구`);
          testPassed++;
          
          // tools/call 테스트
          const callMessage = {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'remember',
              arguments: {
                content: 'WebSocket 테스트를 위한 기억입니다.',
                type: 'episodic'
              }
            }
          };
          ws.send(JSON.stringify(callMessage));
        } else if (response.id === 2 && response.result) {
          console.log('  ✅ tools/call 성공');
          testPassed++;
          
          if (testPassed === totalTests) {
            console.log('  ✅ WebSocket 테스트 완료');
            ws.close();
            resolve(true);
          }
        }
      } catch (error) {
        console.error('  ❌ WebSocket 메시지 파싱 실패:', error);
        reject(error);
      }
    });
    
    ws.on('error', (error: Error) => {
      console.error('  ❌ WebSocket 연결 실패:', error);
      reject(error);
    });
    
    ws.on('close', () => {
      if (testPassed < totalTests) {
        reject(new Error('WebSocket 테스트 미완료'));
      }
    });
    
    // 타임아웃 설정
    setTimeout(() => {
      if (testPassed < totalTests) {
        ws.close();
        reject(new Error('WebSocket 테스트 타임아웃'));
      }
    }, 10000);
  });
}

async function testSSE() {
  console.log('\n🧪 5️⃣ SSE 엔드포인트 테스트');
  
  return new Promise((resolve, reject) => {
    let sessionId: string | null = null;
    let testPassed = 0;
    const totalTests = 3;
    
    // SSE 연결
    const eventSource = new EventSource(`${BASE_URL}/mcp`);
    
    eventSource.onopen = () => {
      console.log('  🔗 SSE 연결 성공');
    };
    
    eventSource.addEventListener('endpoint', (event: any) => {
      try {
        const endpointUrl = event.data;
        sessionId = endpointUrl.split('sessionId=')[1];
        console.log(`  ✅ SSE 엔드포인트 수신: ${sessionId}`);
        testPassed++;
        
        // MCP initialize 요청
        sendMCPMessage('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'test-client', version: '1.0.0' }
        });
      } catch (error) {
        console.error('  ❌ SSE 엔드포인트 처리 실패:', error);
        reject(error);
      }
    });
    
    eventSource.onmessage = (event: any) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'ready') {
          console.log('  ✅ SSE ready 메시지 수신');
          testPassed++;
        } else if (data.jsonrpc === '2.0' && data.result) {
          if (data.id === 1) {
            console.log('  ✅ MCP initialize 성공');
            testPassed++;
            
            if (testPassed === totalTests) {
              console.log('  ✅ SSE 테스트 완료');
              eventSource.close();
              resolve(true);
            }
          }
        }
      } catch (error) {
        console.error('  ❌ SSE 메시지 파싱 실패:', error);
        reject(error);
      }
    };
    
    eventSource.onerror = (error: any) => {
      console.error('  ❌ SSE 연결 실패:', error);
      reject(error);
    };
    
    // MCP 메시지 전송 함수
    function sendMCPMessage(method: string, params: any) {
      if (!sessionId) {
        reject(new Error('세션 ID가 없습니다'));
        return;
      }
      
      const message = {
        jsonrpc: '2.0',
        id: 1,
        method: method,
        params: params
      };
      
      fetch(`${BASE_URL}/messages?sessionId=${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      }).catch(error => {
        console.error('  ❌ MCP 메시지 전송 실패:', error);
        reject(error);
      });
    }
    
    // 타임아웃 설정
    setTimeout(() => {
      if (testPassed < totalTests) {
        eventSource.close();
        reject(new Error('SSE 테스트 타임아웃'));
      }
    }, 15000);
  });
}

async function runTests() {
  console.log('🚀 HTTP 서버 v2 테스트 시작');
  
  let testDb: Database.Database | null = null;
  let serverStarted = false;
  
  // 테스트에서 사용할 포트 (환경 변수 또는 기본값)
  const TEST_PORT = process.env.PORT ? Number(process.env.PORT) : 9001;
  const BASE_URL = `http://localhost:${TEST_PORT}`;
  const WS_URL = `ws://localhost:${TEST_PORT}`;
  
  try {
    // 0. 이전 테스트에서 남아있을 수 있는 BatchScheduler 정리
    try {
      const { getBatchScheduler } = await import('../services/batch-scheduler.js');
      const batchScheduler = getBatchScheduler();
      if (batchScheduler.getStatus().isRunning) {
        console.log('🧹 이전 테스트의 BatchScheduler 정리 중...');
        await batchScheduler.stop();
      }
    } catch (error) {
      // 정리 실패는 무시 (첫 실행일 수 있음)
    }
    
    // 1. 테스트 데이터베이스 설정
    testDb = await setupTestDatabase();
    
    // 2. 서버 의존성 설정
    const searchEngine = new SearchEngine();
    const hybridSearchEngine = new HybridSearchEngine();
    const embeddingService = new MemoryEmbeddingService();
    
    __test.setTestDependencies({
      database: testDb,
      searchEngine,
      hybridSearchEngine,
      embeddingService
    });
    
    // 3. 서버 시작
    console.log('\n🚀 HTTP 서버 v2 시작 중...');
    // 환경 변수로 포트 설정 (테스트용)
    // MCP_SERVER_PORT 또는 PORT 환경 변수 설정
    if (!process.env.MCP_SERVER_PORT && !process.env.PORT) {
      process.env.MCP_SERVER_PORT = String(TEST_PORT);
      process.env.PORT = String(TEST_PORT);
    } else if (process.env.MCP_SERVER_PORT) {
      // MCP_SERVER_PORT가 설정되어 있으면 그것을 사용
      process.env.PORT = process.env.MCP_SERVER_PORT;
    }
    await startServer();
    serverStarted = true;
    
    // 서버 시작 대기 (더 긴 대기 시간)
    console.log(`⏳ 서버 시작 대기 중... (포트: ${TEST_PORT})`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 서버가 실제로 시작되었는지 확인
    let retries = 10;
    while (retries > 0) {
      try {
        const healthCheck = await fetch(`${BASE_URL}/health`);
        if (healthCheck.ok) {
          console.log('✅ 서버가 정상적으로 시작되었습니다');
          break;
        }
      } catch (error) {
        // 연결 실패, 재시도
        retries--;
        if (retries === 0) {
          throw new Error(`서버가 ${TEST_PORT} 포트에서 시작되지 않았습니다`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // 4. 테스트 실행
    await testBasicEndpoints();
    await testMCPTools();
    await testAdminAPIs();
    await testWebSocket();
    await testSSE();
    
    console.log('\n🎉 모든 테스트 통과!');
    
  } catch (error) {
    console.error('\n❌ 테스트 실패:', error);
    process.exit(1);
  } finally {
    // 5. 정리
    if (serverStarted) {
      console.log('\n🧹 서버 정리 중...');
      await cleanup();
    }
    
    if (testDb) {
      console.log('🗄️ 테스트 데이터베이스 정리 중...');
      closeDatabase(testDb);
      
      // 테스트 DB 파일 삭제
      try {
        const fs = await import('fs');
        if (fs.existsSync(TEST_DB_PATH)) {
          fs.unlinkSync(TEST_DB_PATH);
        }
      } catch (error) {
        console.warn('테스트 DB 파일 삭제 실패:', error);
      }
    }
    
    console.log('✅ 테스트 완료');
  }
}

// 테스트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests };

# @memento/client 문제 해결 가이드

## 목차

- [일반적인 문제](#일반적인-문제)
- [연결 문제](#연결-문제)
- [인증 문제](#인증-문제)
- [성능 문제](#성능-문제)
- [메모리 문제](#메모리-문제)
- [타입 오류](#타입-오류)
- [빌드 문제](#빌드-문제)
- [디버깅 도구](#디버깅-도구)

## 일반적인 문제

### 1. 모듈을 찾을 수 없음

**오류 메시지:**
```
Error: Cannot find module '@memento/client'
```

**해결 방법:**
```bash
# 패키지 설치 확인
npm list @memento/client

# 재설치
npm uninstall @memento/client
npm install @memento/client

# 또는 로컬 빌드 사용
npm run build:client
cd packages/mcp-client
npm link
```

### 2. TypeScript 타입 오류

**오류 메시지:**
```
Property 'xxx' does not exist on type 'MementoClient'
```

**해결 방법:**
```typescript
// 타입 정의 확인
import type { MementoClient, MemoryManager } from '@memento/client';

// 또는 any 타입 사용 (임시)
const client: any = new MementoClient();
```

### 3. ES 모듈 경고

**경고 메시지:**
```
Warning: Module type of file is not specified and it doesn't parse as CommonJS
```

**해결 방법:**
```json
// package.json에 추가
{
  "type": "module"
}
```

## 연결 문제

### 1. 서버 연결 실패

**오류 메시지:**
```
ConnectionError: Failed to connect to server
```

**진단 단계:**
```typescript
// 1. 서버 상태 확인
const client = new MementoClient({
  serverUrl: 'http://localhost:8080',
  logLevel: 'debug'
});

try {
  const health = await client.healthCheck();
  console.log('서버 상태:', health);
} catch (error) {
  console.error('서버 연결 실패:', error.message);
}

// 2. 네트워크 연결 확인
const response = await fetch('http://localhost:8080/health');
console.log('HTTP 응답:', response.status);
```

**해결 방법:**
```typescript
// 서버 URL 확인
const client = new MementoClient({
  serverUrl: 'http://localhost:8080', // 올바른 URL인지 확인
  timeout: 15000, // 타임아웃 증가
  retryCount: 5   // 재시도 횟수 증가
});

// 재연결 로직
client.on('error', async (error) => {
  if (error instanceof ConnectionError) {
    console.log('연결 재시도 중...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await client.connect();
  }
});
```

### 2. 타임아웃 오류

**오류 메시지:**
```
TimeoutError: Request timeout after 10000ms
```

**해결 방법:**
```typescript
// 타임아웃 설정 조정
const client = new MementoClient({
  timeout: 30000, // 30초로 증가
  retryCount: 3
});

// 개별 요청에 타임아웃 설정
const controller = new AbortController();
setTimeout(() => controller.abort(), 15000);

try {
  const result = await client.recall('query', {}, 10, {
    signal: controller.signal
  });
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('요청이 취소되었습니다');
  }
}
```

## 인증 문제

### 1. API 키 오류

**오류 메시지:**
```
AuthenticationError: Invalid API key
```

**해결 방법:**
```typescript
// API 키 확인
const client = new MementoClient({
  apiKey: process.env.MEMENTO_API_KEY || 'your-api-key'
});

// 환경 변수 설정
// .env 파일
MEMENTO_API_KEY=your-actual-api-key

// 또는 런타임에 설정
client.setApiKey('your-api-key');
```

### 2. 권한 부족

**오류 메시지:**
```
AuthenticationError: Insufficient permissions
```

**해결 방법:**
```typescript
// 권한 확인
try {
  const memory = await client.getMemory('memory-id');
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.log('권한이 부족합니다. 관리자에게 문의하세요.');
  }
}
```

## 성능 문제

### 1. 느린 응답 시간

**증상:**
- 요청이 5초 이상 걸림
- 타임아웃 발생

**진단:**
```typescript
// 성능 모니터링
const startTime = Date.now();
const result = await client.recall('query');
const duration = Date.now() - startTime;

console.log(`요청 시간: ${duration}ms`);

if (duration > 5000) {
  console.warn('응답이 느립니다. 다음을 확인하세요:');
  console.log('- 네트워크 연결 상태');
  console.log('- 서버 부하');
  console.log('- 데이터베이스 성능');
}
```

**해결 방법:**
```typescript
// 캐싱 사용
const optimizer = new PerformanceOptimizer(client);
const result = await optimizer.cachedSearch('query');

// 배치 처리 사용
const memories = await optimizer.createMemoriesBatch(largeData, {
  batchSize: 50
});

// 병렬 처리 사용
const results = await optimizer.parallelSearch(queries, {
  maxConcurrency: 5
});
```

### 2. 메모리 사용량 증가

**증상:**
- 메모리 사용량이 계속 증가
- 가비지 컬렉션이 자주 발생

**진단:**
```typescript
// 메모리 사용량 모니터링
const monitor = new MemoryMonitor();

setInterval(() => {
  const usage = monitor.getMemoryUsage();
  console.log(`메모리 사용량: ${(usage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
  
  if (usage.heapUsed > 500 * 1024 * 1024) { // 500MB
    console.warn('메모리 사용량이 높습니다');
  }
}, 10000);
```

**해결 방법:**
```typescript
// 캐시 정리
optimizer.clearCache();

// 가비지 컬렉션 강제 실행
if (global.gc) {
  global.gc();
}

// 메모리 누수 방지
const cleanup = () => {
  // 이벤트 리스너 제거
  client.removeAllListeners();
  
  // 캐시 정리
  optimizer.clearCache();
  
  // 연결 해제
  client.disconnect();
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
```

## 메모리 문제

### 1. 메모리 누수

**증상:**
- 메모리 사용량이 계속 증가
- 애플리케이션이 느려짐

**해결 방법:**
```typescript
// 이벤트 리스너 정리
class MemoryLeakPrevention {
  private listeners: Array<{ event: string; listener: Function }> = [];
  
  addListener(event: string, listener: Function) {
    this.listeners.push({ event, listener });
    client.on(event, listener);
  }
  
  cleanup() {
    this.listeners.forEach(({ event, listener }) => {
      client.off(event, listener);
    });
    this.listeners = [];
  }
}

// 사용 예시
const leakPrevention = new MemoryLeakPrevention();
leakPrevention.addListener('memory:created', (memory) => {
  console.log('새 기억:', memory.id);
});

// 정리
leakPrevention.cleanup();
```

### 2. 대용량 데이터 처리

**문제:**
- 많은 데이터를 한 번에 처리할 때 메모리 부족

**해결 방법:**
```typescript
// 스트리밍 처리
async function processLargeDataset(query: string) {
  const stream = optimizer.streamSearch(query, {
    pageSize: 100,
    maxPages: 1000
  });
  
  let processed = 0;
  
  for await (const page of stream) {
    // 각 페이지 처리
    await processPage(page.items);
    processed += page.items.length;
    
    // 메모리 사용량 체크
    if (processed % 1000 === 0) {
      const usage = process.memoryUsage();
      const heapUsedMB = usage.heapUsed / 1024 / 1024;
      
      if (heapUsedMB > 1000) { // 1GB
        console.warn('메모리 사용량이 높습니다. 잠시 대기...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}
```

## 타입 오류

### 1. 타입 불일치

**오류 메시지:**
```
Type 'string' is not assignable to type 'MemoryType'
```

**해결 방법:**
```typescript
// 타입 단언 사용
const memory = await manager.create({
  content: 'test',
  type: 'episodic' as MemoryType,
  importance: 0.5
});

// 또는 타입 가드 사용
function isValidMemoryType(type: string): type is MemoryType {
  return ['working', 'episodic', 'semantic', 'procedural'].includes(type);
}

if (isValidMemoryType(userInput)) {
  const memory = await manager.create({
    content: 'test',
    type: userInput,
    importance: 0.5
  });
}
```

### 2. 옵셔널 속성 오류

**오류 메시지:**
```
Property 'xxx' is optional but required
```

**해결 방법:**
```typescript
// 기본값 제공
const options: MementoClientOptions = {
  serverUrl: 'http://localhost:8080',
  timeout: 10000,
  retryCount: 3,
  logLevel: 'info'
};

// 또는 Partial 타입 사용
const partialOptions: Partial<MementoClientOptions> = {
  serverUrl: 'http://localhost:8080'
};
```

## 빌드 문제

### 1. TypeScript 컴파일 오류

**오류 메시지:**
```
error TS2307: Cannot find module 'axios'
```

**해결 방법:**
```bash
# 의존성 설치
cd packages/mcp-client
npm install

# 타입 정의 설치
npm install --save-dev @types/axios

# 빌드 재시도
npm run build
```

### 2. 모듈 해결 오류

**오류 메시지:**
```
Module not found: Can't resolve './types'
```

**해결 방법:**
```typescript
// 상대 경로 확인
import { MemoryType } from './types.js'; // .js 확장자 추가

// 또는 절대 경로 사용
import { MemoryType } from '@memento/client/types';
```

## 디버깅 도구

### 1. 로그 레벨 설정

```typescript
// 디버그 로그 활성화
const client = new MementoClient({
  logLevel: 'debug'
});

// 특정 작업에만 디버그 로그
client.on('debug', (message) => {
  console.log('[DEBUG]', message);
});
```

### 2. 요청/응답 로깅

```typescript
// HTTP 요청 로깅
client.on('request', (request) => {
  console.log('요청:', {
    method: request.method,
    url: request.url,
    headers: request.headers
  });
});

client.on('response', (response) => {
  console.log('응답:', {
    status: response.status,
    data: response.data
  });
});
```

### 3. 성능 프로파일링

```typescript
// 성능 측정
class PerformanceProfiler {
  private timers = new Map<string, number>();
  
  start(label: string) {
    this.timers.set(label, Date.now());
  }
  
  end(label: string) {
    const startTime = this.timers.get(label);
    if (startTime) {
      const duration = Date.now() - startTime;
      console.log(`${label}: ${duration}ms`);
      this.timers.delete(label);
    }
  }
}

// 사용 예시
const profiler = new PerformanceProfiler();
profiler.start('memory-creation');
await manager.create(memoryData);
profiler.end('memory-creation');
```

### 4. 에러 추적

```typescript
// 에러 추적
client.on('error', (error) => {
  console.error('에러 발생:', {
    message: error.message,
    code: error.code,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
  
  // 에러 리포팅 서비스에 전송
  if (process.env.NODE_ENV === 'production') {
    // Sentry, LogRocket 등에 전송
  }
});
```

### 5. 상태 모니터링

```typescript
// 클라이언트 상태 모니터링
class ClientMonitor {
  private status = 'disconnected';
  private lastActivity = Date.now();
  
  constructor(private client: MementoClient) {
    this.setupMonitoring();
  }
  
  private setupMonitoring() {
    this.client.on('connected', () => {
      this.status = 'connected';
      this.lastActivity = Date.now();
    });
    
    this.client.on('disconnected', () => {
      this.status = 'disconnected';
    });
    
    this.client.on('memory:created', () => {
      this.lastActivity = Date.now();
    });
  }
  
  getStatus() {
    return {
      status: this.status,
      lastActivity: this.lastActivity,
      timeSinceLastActivity: Date.now() - this.lastActivity
    };
  }
}
```

이 가이드를 참고하여 문제를 해결하고 `@memento/client`를 안정적으로 사용하세요.

# @memento/client 마이그레이션 가이드

## 목차

- [버전별 변경사항](#버전별-변경사항)
- [v0.1.0에서 v0.2.0으로 마이그레이션](#v010에서-v020으로-마이그레이션)
- [기존 클라이언트에서 마이그레이션](#기존-클라이언트에서-마이그레이션)
- [API 변경사항](#api-변경사항)
- [성능 개선사항](#성능-개선사항)
- [문제 해결](#문제-해결)

## 버전별 변경사항

### v0.1.0 (초기 릴리스)
- 기본 MementoClient, MemoryManager, ContextInjector 클래스
- HTTP/WebSocket 통신 지원
- 기본 CRUD 작업 및 검색 기능
- 이벤트 시스템

### v0.2.0 (예정)
- 성능 최적화 도구 추가
- 배치 처리 기능
- 캐싱 시스템
- 병렬 처리 지원
- 스트리밍 검색
- 압축 검색

## v0.1.0에서 v0.2.0으로 마이그레이션

### 1. 패키지 업데이트

```bash
# 기존 버전 제거
npm uninstall @memento/client

# 새 버전 설치
npm install @memento/client@latest
```

### 2. 성능 최적화 도구 추가

**이전 코드:**
```typescript
import { MementoClient, MemoryManager } from '@memento/client';

const client = new MementoClient();
const manager = new MemoryManager(client);

// 대량 데이터 처리
const memories = [/* 많은 데이터 */];
for (const memory of memories) {
  await manager.create(memory);
}
```

**새 코드:**
```typescript
import { MementoClient, MemoryManager } from '@memento/client';
import { PerformanceOptimizer } from '@memento/client/performance-optimizer';

const client = new MementoClient();
const manager = new MemoryManager(client);
const optimizer = new PerformanceOptimizer(client);

// 배치 처리로 성능 향상
const memories = [/* 많은 데이터 */];
await optimizer.createMemoriesBatch(memories, {
  batchSize: 50,
  delayBetweenBatches: 100
});
```

### 3. 캐싱 시스템 활용

**이전 코드:**
```typescript
// 매번 서버에 요청
const result1 = await manager.search('React Hook');
const result2 = await manager.search('React Hook'); // 중복 요청
```

**새 코드:**
```typescript
// 캐싱으로 성능 향상
const result1 = await optimizer.cachedSearch('React Hook');
const result2 = await optimizer.cachedSearch('React Hook'); // 캐시에서 반환
```

### 4. 병렬 처리 도입

**이전 코드:**
```typescript
// 순차 처리
const results = [];
for (const query of queries) {
  const result = await manager.search(query);
  results.push(result);
}
```

**새 코드:**
```typescript
// 병렬 처리
const results = await optimizer.parallelSearch(queries, {
  maxConcurrency: 5
});
```

## 기존 클라이언트에서 마이그레이션

### 1. 내부 클라이언트에서 외부 클라이언트로

**이전 (내부 클라이언트):**
```typescript
// src/client/index.ts 사용
import { MementoClient } from './client/index.js';

const client = new MementoClient();
await client.connect(); // stdio 연결
```

**새 (외부 클라이언트):**
```typescript
// @memento/client 패키지 사용
import { MementoClient } from '@memento/client';

const client = new MementoClient({
  serverUrl: 'http://localhost:8080' // HTTP 연결
});
await client.connect();
```

### 2. 연결 방식 변경

**이전 (stdio):**
```typescript
// 자동으로 stdio 연결
const client = new MementoClient();
await client.connect();
```

**새 (HTTP/WebSocket):**
```typescript
// 명시적 서버 URL 설정
const client = new MementoClient({
  serverUrl: 'http://localhost:8080',
  apiKey: 'your-api-key', // M2+에서 필요
  timeout: 15000
});
await client.connect();
```

### 3. API 변경사항

**이전 API:**
```typescript
// 직접 MCP 도구 호출
const result = await client.callTool('remember', {
  content: 'test',
  type: 'episodic'
});
```

**새 API:**
```typescript
// 고수준 API 사용
const memory = await manager.create({
  content: 'test',
  type: 'episodic'
});
```

## API 변경사항

### 1. 클라이언트 옵션

**추가된 옵션:**
```typescript
interface MementoClientOptions {
  serverUrl?: string;        // 새로 추가
  apiKey?: string;          // 새로 추가
  timeout?: number;         // 새로 추가
  retryCount?: number;      // 새로 추가
  logLevel?: LogLevel;      // 새로 추가
}
```

### 2. 메모리 관리자 메서드

**새로 추가된 메서드:**
```typescript
// 배치 처리
createBatch(params: CreateMemoryParams[]): Promise<MemoryItem[]>
deleteBatch(ids: string[], hard?: boolean): Promise<number>
pinBatch(ids: string[], pin?: boolean): Promise<number>

// 고급 검색
searchByTags(tags: string[], limit?: number): Promise<SearchResult>
searchByType(type: MemoryType, limit?: number): Promise<SearchResult>
searchByProject(projectId: string, limit?: number): Promise<SearchResult>
searchRecent(days?: number, limit?: number): Promise<SearchResult>
searchPinned(limit?: number): Promise<SearchResult>
findSimilar(memoryId: string, limit?: number): Promise<SearchResult>
findRelated(memoryId: string, limit?: number): Promise<SearchResult>

// 태그 관리
addTags(id: string, tags: string[]): Promise<MemoryItem>
removeTags(id: string, tags: string[]): Promise<MemoryItem>
setTags(id: string, tags: string[]): Promise<MemoryItem>

// 통계
getStats(): Promise<MemoryStats>
getPopularTags(limit?: number): Promise<Array<{tag: string, count: number}>>
```

### 3. 컨텍스트 주입기 개선

**새로 추가된 메서드:**
```typescript
// 특화된 컨텍스트 주입
injectConversationContext(query: string, tokenBudget?: number): Promise<ContextInjectionResult>
injectTaskContext(query: string, projectId?: string, tokenBudget?: number): Promise<ContextInjectionResult>
injectLearningContext(topic: string, tokenBudget?: number): Promise<ContextInjectionResult>
injectProjectContext(projectId: string, query: string, tokenBudget?: number): Promise<ContextInjectionResult>
```

## 성능 개선사항

### 1. 배치 처리
- **이전**: 개별 요청으로 처리
- **새**: 배치 단위로 처리하여 네트워크 오버헤드 감소

### 2. 캐싱 시스템
- **이전**: 매번 서버 요청
- **새**: 자주 사용되는 데이터를 메모리에 캐시

### 3. 병렬 처리
- **이전**: 순차 처리
- **새**: 동시 처리로 전체 처리 시간 단축

### 4. 스트리밍
- **이전**: 전체 결과를 한 번에 로드
- **새**: 청크 단위로 처리하여 메모리 사용량 최적화

### 5. 압축 검색
- **이전**: 모든 결과 반환
- **새**: 중요도 기반으로 결과 압축

## 문제 해결

### 1. 연결 오류

**문제**: 서버에 연결할 수 없음
```typescript
// 해결 방법
const client = new MementoClient({
  serverUrl: 'http://localhost:8080', // 올바른 URL 확인
  timeout: 30000, // 타임아웃 증가
  retryCount: 5   // 재시도 횟수 증가
});
```

### 2. 성능 저하

**문제**: 응답 시간이 느림
```typescript
// 해결 방법
const optimizer = new PerformanceOptimizer(client);

// 캐싱 사용
const result = await optimizer.cachedSearch(query);

// 배치 처리 사용
await optimizer.createMemoriesBatch(memories, {
  batchSize: 50
});
```

### 3. 메모리 사용량 증가

**문제**: 메모리 사용량이 계속 증가
```typescript
// 해결 방법
// 캐시 정리
optimizer.clearCache();

// 가비지 컬렉션 강제 실행
if (global.gc) {
  global.gc();
}
```

### 4. 타입 오류

**문제**: TypeScript 타입 오류
```typescript
// 해결 방법
// 타입 단언 사용
const memory = await manager.create({
  content: 'test',
  type: 'episodic' as MemoryType
});

// 또는 타입 가드 사용
function isValidMemoryType(type: string): type is MemoryType {
  return ['working', 'episodic', 'semantic', 'procedural'].includes(type);
}
```

## 마이그레이션 체크리스트

- [ ] 패키지 업데이트
- [ ] 연결 방식 변경 (stdio → HTTP/WebSocket)
- [ ] API 호출 방식 변경
- [ ] 성능 최적화 도구 도입
- [ ] 캐싱 시스템 활용
- [ ] 배치 처리 적용
- [ ] 병렬 처리 도입
- [ ] 에러 처리 업데이트
- [ ] 테스트 코드 업데이트
- [ ] 문서 업데이트

## 롤백 가이드

문제가 발생할 경우 이전 버전으로 롤백:

```bash
# 특정 버전으로 다운그레이드
npm install @memento/client@0.1.0

# 또는 완전 제거 후 재설치
npm uninstall @memento/client
npm install @memento/client@0.1.0
```

## 지원 및 문의

마이그레이션 과정에서 문제가 발생하면:

1. [문제 해결 가이드](./TROUBLESHOOTING.md) 참조
2. [GitHub Issues](https://github.com/your-org/memento/issues)에 문의
3. [성능 가이드](./PERFORMANCE-GUIDE.md)로 최적화 방법 확인

이 가이드를 따라하면 @memento/client의 새 버전으로 안전하게 마이그레이션할 수 있습니다.

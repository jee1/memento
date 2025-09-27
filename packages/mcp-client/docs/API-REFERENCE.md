# @memento/client API 참조

## 목차

- [MementoClient](#mementoclient)
- [MemoryManager](#memorymanager)
- [ContextInjector](#contextinjector)
- [타입 정의](#타입-정의)
- [에러 처리](#에러-처리)
- [이벤트 시스템](#이벤트-시스템)

## MementoClient

Memento MCP 서버와의 기본 통신을 담당하는 메인 클래스입니다.

### 생성자

```typescript
new MementoClient(options?: MementoClientOptions)
```

#### MementoClientOptions

| 속성 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `serverUrl` | `string` | `'http://localhost:8080'` | MCP 서버 URL |
| `apiKey` | `string` | `''` | API 키 (M2+에서 사용) |
| `timeout` | `number` | `10000` | 연결 타임아웃 (밀리초) |
| `retryCount` | `number` | `3` | 재시도 횟수 |
| `logLevel` | `'debug' \| 'info' \| 'warn' \| 'error' \| 'silent'` | `'info'` | 로그 레벨 |

### 메서드

#### `connect(): Promise<void>`

서버에 연결합니다.

```typescript
await client.connect();
```

#### `disconnect(): Promise<void>`

연결을 해제합니다.

```typescript
await client.disconnect();
```

#### `healthCheck(): Promise<HealthCheck>`

서버 상태를 확인합니다.

```typescript
const health = await client.healthCheck();
console.log(health.status); // 'healthy' | 'unhealthy'
```

#### `remember(params: CreateMemoryParams): Promise<RememberResult>`

새로운 기억을 저장합니다.

```typescript
const result = await client.remember({
  content: 'React Hook에 대해 학습했다',
  type: 'episodic',
  importance: 0.8,
  tags: ['react', 'frontend']
});
```

#### `recall(query: string, filters?: SearchFilters, limit?: number): Promise<SearchResult>`

기억을 검색합니다.

```typescript
const results = await client.recall('React Hook', {
  type: ['episodic', 'semantic'],
  tags: ['react']
}, 10);
```

#### `hybridSearch(params: HybridSearchParams): Promise<HybridSearchResult>`

하이브리드 검색을 수행합니다.

```typescript
const results = await client.hybridSearch({
  query: '프로그래밍 개념',
  vectorWeight: 0.7,
  textWeight: 0.3,
  limit: 10
});
```

#### `getMemory(id: string): Promise<MemoryItem>`

특정 기억을 조회합니다.

```typescript
const memory = await client.getMemory('memory-id');
```

#### `updateMemory(id: string, params: UpdateMemoryParams): Promise<MemoryItem>`

기억을 업데이트합니다.

```typescript
const updated = await client.updateMemory('memory-id', {
  importance: 0.9,
  tags: ['updated', 'important']
});
```

#### `forget(memoryId: string, hard: boolean = false): Promise<ForgetResult>`

기억을 삭제합니다.

```typescript
await client.forget('memory-id', false); // 소프트 삭제
await client.forget('memory-id', true);  // 하드 삭제
```

#### `pin(memoryId: string): Promise<PinResult>`

기억을 고정합니다.

```typescript
await client.pin('memory-id');
```

#### `unpin(memoryId: string): Promise<PinResult>`

기억 고정을 해제합니다.

```typescript
await client.unpin('memory-id');
```

## MemoryManager

기억 관리를 위한 고수준 API를 제공하는 클래스입니다.

### 생성자

```typescript
new MemoryManager(client: MementoClient)
```

### 메서드

#### `create(params: CreateMemoryParams): Promise<MemoryItem>`

기억을 생성합니다.

```typescript
const memory = await manager.create({
  content: 'TypeScript 인터페이스 설계',
  type: 'semantic',
  importance: 0.9,
  tags: ['typescript', 'design']
});
```

#### `get(id: string): Promise<MemoryItem | null>`

기억을 조회합니다.

```typescript
const memory = await manager.get('memory-id');
if (memory) {
  console.log(memory.content);
}
```

#### `update(id: string, params: UpdateMemoryParams): Promise<MemoryItem>`

기억을 업데이트합니다.

```typescript
const updated = await manager.update('memory-id', {
  importance: 0.95,
  tags: ['updated', 'critical']
});
```

#### `delete(id: string, hard: boolean = false): Promise<boolean>`

기억을 삭제합니다.

```typescript
const success = await manager.delete('memory-id', false);
```

#### `search(query: string, options?: SearchOptions): Promise<SearchResult>`

기억을 검색합니다.

```typescript
const results = await manager.search('React Hook', {
  filters: { type: ['episodic'] },
  limit: 10,
  useHybrid: true
});
```

#### `searchByTags(tags: string[], limit?: number): Promise<SearchResult>`

태그로 기억을 검색합니다.

```typescript
const results = await manager.searchByTags(['react', 'frontend'], 5);
```

#### `searchByType(type: MemoryType, limit?: number): Promise<SearchResult>`

타입별로 기억을 검색합니다.

```typescript
const results = await manager.searchByType('episodic', 10);
```

#### `searchByProject(projectId: string, limit?: number): Promise<SearchResult>`

프로젝트별로 기억을 검색합니다.

```typescript
const results = await manager.searchByProject('my-project', 20);
```

#### `searchRecent(days: number = 7, limit?: number): Promise<SearchResult>`

최근 기억을 검색합니다.

```typescript
const results = await manager.searchRecent(7, 10); // 최근 7일
```

#### `searchPinned(limit?: number): Promise<SearchResult>`

고정된 기억을 검색합니다.

```typescript
const results = await manager.searchPinned(5);
```

#### `findSimilar(memoryId: string, limit: number = 5): Promise<SearchResult>`

유사한 기억을 검색합니다.

```typescript
const similar = await manager.findSimilar('memory-id', 3);
```

#### `findRelated(memoryId: string, limit: number = 5): Promise<SearchResult>`

관련 기억을 검색합니다.

```typescript
const related = await manager.findRelated('memory-id', 3);
```

#### `pin(id: string): Promise<boolean>`

기억을 고정합니다.

```typescript
const success = await manager.pin('memory-id');
```

#### `unpin(id: string): Promise<boolean>`

기억 고정을 해제합니다.

```typescript
const success = await manager.unpin('memory-id');
```

#### `setImportance(id: string, importance: number): Promise<MemoryItem>`

기억의 중요도를 설정합니다.

```typescript
const updated = await manager.setImportance('memory-id', 0.9);
```

#### `addTags(id: string, tags: string[]): Promise<MemoryItem>`

기억에 태그를 추가합니다.

```typescript
const updated = await manager.addTags('memory-id', ['new-tag', 'important']);
```

#### `removeTags(id: string, tags: string[]): Promise<MemoryItem>`

기억에서 태그를 제거합니다.

```typescript
const updated = await manager.removeTags('memory-id', ['old-tag']);
```

#### `setTags(id: string, tags: string[]): Promise<MemoryItem>`

기억의 태그를 설정합니다.

```typescript
const updated = await manager.setTags('memory-id', ['tag1', 'tag2']);
```

#### `setPrivacyScope(id: string, privacyScope: PrivacyScope): Promise<MemoryItem>`

기억의 공개 범위를 설정합니다.

```typescript
const updated = await manager.setPrivacyScope('memory-id', 'team');
```

#### `createBatch(params: CreateMemoryParams[]): Promise<MemoryItem[]>`

여러 기억을 일괄 생성합니다.

```typescript
const memories = await manager.createBatch([
  { content: '기억 1', type: 'episodic' },
  { content: '기억 2', type: 'semantic' }
]);
```

#### `deleteBatch(ids: string[], hard: boolean = false): Promise<number>`

여러 기억을 일괄 삭제합니다.

```typescript
const deletedCount = await manager.deleteBatch(['id1', 'id2'], false);
```

#### `pinBatch(ids: string[], pin: boolean = true): Promise<number>`

여러 기억을 일괄 고정/해제합니다.

```typescript
const pinnedCount = await manager.pinBatch(['id1', 'id2'], true);
```

#### `getStats(): Promise<MemoryStats>`

기억 통계를 조회합니다.

```typescript
const stats = await manager.getStats();
console.log(`총 기억 수: ${stats.total}`);
```

#### `getPopularTags(limit: number = 10): Promise<Array<{tag: string, count: number}>>`

인기 태그를 조회합니다.

```typescript
const popularTags = await manager.getPopularTags(5);
```

## ContextInjector

AI Agent의 컨텍스트에 관련 기억을 주입하는 클래스입니다.

### 생성자

```typescript
new ContextInjector(client: MementoClient)
```

### 메서드

#### `inject(query: string, options?: ContextInjectionOptions): Promise<ContextInjectionResult>`

컨텍스트를 주입합니다.

```typescript
const context = await injector.inject('React 개발 질문', {
  tokenBudget: 1000,
  contextType: 'conversation'
});
```

#### `injectConversationContext(query: string, tokenBudget: number = 1000): Promise<ContextInjectionResult>`

대화 컨텍스트를 주입합니다.

```typescript
const context = await injector.injectConversationContext('사용자 질문', 800);
```

#### `injectTaskContext(query: string, projectId?: string, tokenBudget: number = 1200): Promise<ContextInjectionResult>`

작업 컨텍스트를 주입합니다.

```typescript
const context = await injector.injectTaskContext('프로젝트 작업', 'project-id', 1000);
```

#### `injectLearningContext(topic: string, tokenBudget: number = 1500): Promise<ContextInjectionResult>`

학습 컨텍스트를 주입합니다.

```typescript
const context = await injector.injectLearningContext('TypeScript 학습', 1200);
```

#### `injectProjectContext(projectId: string, query: string, tokenBudget: number = 1000): Promise<ContextInjectionResult>`

프로젝트 컨텍스트를 주입합니다.

```typescript
const context = await injector.injectProjectContext('project-id', '개발 질문', 1000);
```

## 타입 정의

### MemoryType

```typescript
type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';
```

### PrivacyScope

```typescript
type PrivacyScope = 'private' | 'team' | 'public';
```

### MemoryItem

```typescript
interface MemoryItem {
  id: string;
  content: string;
  type: MemoryType;
  importance: number;
  created_at: string;
  last_accessed?: string;
  pinned: boolean;
  tags?: string[];
  privacy_scope: PrivacyScope;
  source?: string;
  project_id?: string;
  user_id?: string;
  metadata?: Record<string, any>;
}
```

### SearchFilters

```typescript
interface SearchFilters {
  type?: MemoryType[];
  tags?: string[];
  project_id?: string;
  time_from?: string;
  time_to?: string;
  pinned?: boolean;
}
```

### SearchResult

```typescript
interface SearchResult {
  items: MemorySearchResult[];
  total_count: number;
  query_time: number;
  search_type?: string;
  vector_search_available?: boolean;
}
```

### MemorySearchResult

```typescript
interface MemorySearchResult {
  id: string;
  content: string;
  type: MemoryType;
  importance: number;
  created_at: string;
  last_accessed?: string;
  pinned: boolean;
  tags?: string[];
  privacy_scope: PrivacyScope;
  score: number;
  recall_reason: string;
}
```

## 에러 처리

### MementoError

```typescript
class MementoError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: any
  );
}
```

### 에러 타입들

- `ConnectionError`: 연결 관련 오류
- `AuthenticationError`: 인증 관련 오류
- `ValidationError`: 입력 검증 오류
- `NotFoundError`: 리소스를 찾을 수 없음

### 에러 처리 예시

```typescript
try {
  await client.remember({ content: 'test' });
} catch (error) {
  if (error instanceof ConnectionError) {
    console.error('연결 오류:', error.message);
  } else if (error instanceof ValidationError) {
    console.error('입력 오류:', error.message);
  } else {
    console.error('알 수 없는 오류:', error.message);
  }
}
```

## 이벤트 시스템

### 이벤트 리스닝

```typescript
client.on('connected', () => {
  console.log('서버에 연결되었습니다');
});

client.on('memory:created', (memory) => {
  console.log('새 기억 생성:', memory.id);
});

client.on('error', (error) => {
  console.error('에러 발생:', error.message);
});
```

### 사용 가능한 이벤트들

- `connected`: 서버 연결됨
- `disconnected`: 서버 연결 해제됨
- `error`: 에러 발생
- `memory:created`: 기억 생성됨
- `memory:updated`: 기억 업데이트됨
- `memory:deleted`: 기억 삭제됨
- `memory:pinned`: 기억 고정됨
- `memory:unpinned`: 기억 고정 해제됨

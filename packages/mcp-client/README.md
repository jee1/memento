# @memento/client

Memento MCP Server를 위한 TypeScript 클라이언트 라이브러리입니다. AI Agent의 기억을 관리하고 컨텍스트를 주입하는 기능을 제공합니다.

## 🚀 설치

```bash
npm install @memento/client
```

## 📖 사용법

### 기본 사용법

```typescript
import { MementoClient, MemoryManager, ContextInjector } from '@memento/client';

// 클라이언트 생성 및 연결
const client = new MementoClient({
  serverUrl: 'http://localhost:8080',
  apiKey: 'your-api-key' // M2+에서 사용
});

await client.connect();

// 기억 저장
const memory = await client.remember({
  content: 'React Hook에 대해 학습했다',
  type: 'episodic',
  importance: 0.8,
  tags: ['react', 'frontend']
});

// 기억 검색
const results = await client.recall('React Hook');
console.log(results.items);
```

### MemoryManager 사용

```typescript
const manager = new MemoryManager(client);

// 기억 생성
const memory = await manager.create({
  content: 'TypeScript 인터페이스 설계',
  type: 'semantic',
  tags: ['typescript', 'design'],
  importance: 0.9
});

// 태그로 검색
const reactMemories = await manager.searchByTags(['react']);

// 최근 기억 검색
const recentMemories = await manager.searchRecent(7); // 최근 7일

// 통계 조회
const stats = await manager.getStats();
console.log(`총 ${stats.total}개의 기억이 있습니다`);
```

### ContextInjector 사용

```typescript
const injector = new ContextInjector(client);

// 컨텍스트 주입
const context = await injector.inject('React Hook 질문', {
  tokenBudget: 1000,
  contextType: 'conversation'
});

console.log(context.content);
// 💬 관련 대화 기록:
// 1. 📅 React Hook에 대해 학습했다 [react, frontend] (관련도: 85.2%)
//    ★★★★☆ 2024-01-15T10:30:00Z
// 
// 💡 위의 1개 기억을 참고하여 "React Hook 질문"에 대해 답변해주세요.
```

## 🔧 API 참조

### MementoClient

메인 클라이언트 클래스입니다.

#### 생성자

```typescript
new MementoClient(options?: MementoClientOptions)
```

#### 옵션

```typescript
interface MementoClientOptions {
  serverUrl?: string;        // 서버 URL (기본값: http://localhost:8080)
  apiKey?: string;          // API 키 (M2+에서 사용)
  timeout?: number;         // 연결 타임아웃 (기본값: 10000ms)
  retryCount?: number;      // 재시도 횟수 (기본값: 3)
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
}
```

#### 주요 메서드

- `connect()`: 서버에 연결
- `disconnect()`: 연결 해제
- `remember(params)`: 기억 저장
- `recall(query, filters?, limit?)`: 기억 검색
- `hybridSearch(params)`: 하이브리드 검색
- `getMemory(id)`: 기억 조회
- `updateMemory(id, params)`: 기억 업데이트
- `forget(id, hard?)`: 기억 삭제
- `pin(id)` / `unpin(id)`: 기억 고정/해제

### MemoryManager

기억 관리를 위한 고수준 API입니다.

#### 주요 메서드

- `create(params)`: 기억 생성
- `get(id)`: 기억 조회
- `update(id, params)`: 기억 업데이트
- `delete(id, hard?)`: 기억 삭제
- `search(query, options?)`: 기억 검색
- `searchByTags(tags, limit?)`: 태그로 검색
- `searchByType(type, limit?)`: 타입별 검색
- `searchByProject(projectId, limit?)`: 프로젝트별 검색
- `searchRecent(days, limit?)`: 최근 기억 검색
- `searchPinned(limit?)`: 고정된 기억 검색
- `findSimilar(memoryId, limit?)`: 유사 기억 검색
- `findRelated(memoryId, limit?)`: 관련 기억 검색

### ContextInjector

AI Agent의 컨텍스트에 관련 기억을 주입합니다.

#### 주요 메서드

- `inject(query, options?)`: 컨텍스트 주입
- `injectConversationContext(query, tokenBudget?)`: 대화 컨텍스트 주입
- `injectTaskContext(query, projectId?, tokenBudget?)`: 작업 컨텍스트 주입
- `injectLearningContext(topic, tokenBudget?)`: 학습 컨텍스트 주입
- `injectProjectContext(projectId, query, tokenBudget?)`: 프로젝트 컨텍스트 주입

## 🎯 예제

### AI Agent와 통합

```typescript
import { MementoClient, ContextInjector } from '@memento/client';

class AIAgent {
  private client: MementoClient;
  private injector: ContextInjector;

  constructor() {
    this.client = new MementoClient({
      serverUrl: process.env.MEMENTO_SERVER_URL
    });
    this.injector = new ContextInjector(this.client);
  }

  async initialize() {
    await this.client.connect();
  }

  async processMessage(userMessage: string): Promise<string> {
    // 1. 관련 기억을 컨텍스트로 주입
    const context = await this.injector.injectConversationContext(
      userMessage,
      1000
    );

    // 2. AI 모델에 컨텍스트와 함께 전달
    const response = await this.generateResponse(userMessage, context.content);

    // 3. 새로운 기억 저장
    await this.client.remember({
      content: `사용자: ${userMessage}\nAI: ${response}`,
      type: 'episodic',
      importance: 0.7,
      tags: ['conversation', 'ai-response']
    });

    return response;
  }

  private async generateResponse(message: string, context: string): Promise<string> {
    // AI 모델 호출 로직
    // context를 시스템 메시지로 사용
    return 'AI 응답...';
  }
}
```

### 프로젝트 관리

```typescript
import { MemoryManager } from '@memento/client';

class ProjectManager {
  private manager: MemoryManager;

  constructor(client: MementoClient) {
    this.manager = new MemoryManager(client);
  }

  async createProject(projectId: string, name: string) {
    await this.manager.create({
      content: `프로젝트 생성: ${name}`,
      type: 'episodic',
      project_id: projectId,
      importance: 0.8,
      tags: ['project', 'creation']
    });
  }

  async addTask(projectId: string, task: string) {
    await this.manager.create({
      content: `작업 추가: ${task}`,
      type: 'procedural',
      project_id: projectId,
      importance: 0.6,
      tags: ['task', 'project']
    });
  }

  async getProjectHistory(projectId: string) {
    return await this.manager.searchByProject(projectId);
  }
}
```

## 🔍 고급 기능

### 이벤트 리스닝

```typescript
client.on('connected', () => {
  console.log('서버에 연결되었습니다');
});

client.on('memory:created', (memory) => {
  console.log('새 기억이 생성되었습니다:', memory.id);
});

client.on('error', (error) => {
  console.error('에러 발생:', error.message);
});
```

### 에러 처리

```typescript
import { MementoError, ConnectionError, AuthenticationError } from '@memento/client';

try {
  await client.remember({ content: 'test' });
} catch (error) {
  if (error instanceof ConnectionError) {
    console.error('연결 오류:', error.message);
  } else if (error instanceof AuthenticationError) {
    console.error('인증 오류:', error.message);
  } else if (error instanceof MementoError) {
    console.error('Memento 오류:', error.message, error.code);
  }
}
```

### 재시도 로직

```typescript
const client = new MementoClient({
  serverUrl: 'http://localhost:8080',
  retryCount: 5, // 5번 재시도
  timeout: 15000 // 15초 타임아웃
});
```

## 🛠️ 개발

### 빌드

```bash
npm run build
```

### 개발 모드

```bash
npm run dev
```

### 테스트

```bash
npm test
```

## 📄 라이선스

MIT License

## 🤝 기여

기여를 환영합니다! 이슈나 풀 리퀘스트를 통해 참여해주세요.

## 📚 관련 문서

- [Memento MCP Server 문서](https://github.com/your-org/memento)
- [API 참조](https://github.com/your-org/memento/docs/api-reference.md)
- [아키텍처 가이드](https://github.com/your-org/memento/docs/architecture.md)

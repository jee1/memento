# @memento/client 모범 사례

## 목차

- [설계 원칙](#설계-원칙)
- [성능 최적화](#성능-최적화)
- [에러 처리](#에러-처리)
- [보안 고려사항](#보안-고려사항)
- [코드 품질](#코드-품질)
- [테스트 전략](#테스트-전략)
- [배포 및 운영](#배포-및-운영)

## 설계 원칙

### 1. 단일 책임 원칙 (SRP)

각 클래스는 하나의 명확한 책임을 가져야 합니다.

```typescript
// ✅ 좋은 예: 각 클래스가 명확한 역할
const client = new MementoClient();        // 통신 담당
const manager = new MemoryManager(client); // 기억 관리 담당
const injector = new ContextInjector(client); // 컨텍스트 주입 담당

// ❌ 나쁜 예: 하나의 클래스가 모든 것을 담당
class EverythingManager {
  // 통신, 기억 관리, 컨텍스트 주입을 모두 처리
}
```

### 2. 의존성 주입 (DI)

의존성을 외부에서 주입하여 테스트 가능성을 높입니다.

```typescript
// ✅ 좋은 예: 의존성 주입
class MemoryService {
  constructor(
    private client: MementoClient,
    private logger: Logger
  ) {}
  
  async createMemory(data: CreateMemoryParams) {
    this.logger.info('Creating memory', data);
    return await this.client.remember(data);
  }
}

// ❌ 나쁜 예: 하드코딩된 의존성
class MemoryService {
  private client = new MementoClient(); // 하드코딩
  private logger = new ConsoleLogger(); // 하드코딩
}
```

### 3. 인터페이스 분리 원칙 (ISP)

클라이언트는 사용하지 않는 인터페이스에 의존하지 않아야 합니다.

```typescript
// ✅ 좋은 예: 필요한 기능만 노출
interface MemoryReader {
  get(id: string): Promise<MemoryItem | null>;
  search(query: string): Promise<SearchResult>;
}

interface MemoryWriter {
  create(params: CreateMemoryParams): Promise<MemoryItem>;
  update(id: string, params: UpdateMemoryParams): Promise<MemoryItem>;
  delete(id: string): Promise<boolean>;
}

// ❌ 나쁜 예: 모든 기능을 하나의 인터페이스에
interface MemoryManager {
  get(id: string): Promise<MemoryItem | null>;
  search(query: string): Promise<SearchResult>;
  create(params: CreateMemoryParams): Promise<MemoryItem>;
  update(id: string, params: UpdateMemoryParams): Promise<MemoryItem>;
  delete(id: string): Promise<boolean>;
  // ... 수많은 다른 메서드들
}
```

## 성능 최적화

### 1. 배치 처리 활용

대량 데이터 처리 시 배치 처리를 사용합니다.

```typescript
// ✅ 좋은 예: 배치 처리
const optimizer = new PerformanceOptimizer(client);
const results = await optimizer.createMemoriesBatch(memories, {
  batchSize: 50,
  delayBetweenBatches: 100
});

// ❌ 나쁜 예: 개별 처리
for (const memory of memories) {
  await manager.create(memory); // 네트워크 오버헤드 증가
}
```

### 2. 캐싱 전략

자주 사용되는 데이터는 캐싱합니다.

```typescript
// ✅ 좋은 예: 캐싱 활용
const result = await optimizer.cachedSearch('frequent query', {
  limit: 20
});

// ❌ 나쁜 예: 매번 서버 요청
const result = await manager.search('frequent query', { limit: 20 });
```

### 3. 병렬 처리

독립적인 작업은 병렬로 처리합니다.

```typescript
// ✅ 좋은 예: 병렬 처리
const queries = ['query1', 'query2', 'query3'];
const results = await optimizer.parallelSearch(queries, {
  maxConcurrency: 5
});

// ❌ 나쁜 예: 순차 처리
const results = [];
for (const query of queries) {
  const result = await manager.search(query);
  results.push(result);
}
```

### 4. 메모리 관리

대용량 데이터 처리 시 메모리 사용량을 모니터링합니다.

```typescript
// ✅ 좋은 예: 메모리 모니터링
class MemoryAwareProcessor {
  private monitor = new MemoryMonitor();
  
  async processLargeDataset(data: any[]) {
    for (const chunk of this.chunkArray(data, 1000)) {
      if (!this.monitor.checkMemoryLimit(500)) {
        await this.garbageCollect();
      }
      await this.processChunk(chunk);
    }
  }
  
  private async garbageCollect() {
    if (global.gc) {
      global.gc();
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
```

## 에러 처리

### 1. 구체적인 에러 타입 사용

```typescript
// ✅ 좋은 예: 구체적인 에러 처리
try {
  await manager.create(memoryData);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('입력 데이터 오류:', error.message);
  } else if (error instanceof ConnectionError) {
    console.error('연결 오류:', error.message);
    // 재연결 시도
    await client.connect();
  } else {
    console.error('알 수 없는 오류:', error);
  }
}

// ❌ 나쁜 예: 일반적인 에러 처리
try {
  await manager.create(memoryData);
} catch (error) {
  console.error('오류 발생:', error); // 구체적이지 않음
}
```

### 2. 재시도 로직 구현

```typescript
// ✅ 좋은 예: 재시도 로직
async function createMemoryWithRetry(data: CreateMemoryParams, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await manager.create(data);
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      if (error instanceof ConnectionError) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      
      throw error; // 재시도할 수 없는 오류
    }
  }
}
```

### 3. 에러 로깅

```typescript
// ✅ 좋은 예: 구조화된 에러 로깅
class ErrorLogger {
  logError(error: Error, context: any) {
    const errorInfo = {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
      userId: context.userId
    };
    
    console.error('Memory operation failed:', errorInfo);
    
    // 외부 로깅 서비스에 전송
    this.sendToLoggingService(errorInfo);
  }
}
```

## 보안 고려사항

### 1. API 키 관리

```typescript
// ✅ 좋은 예: 환경 변수 사용
const client = new MementoClient({
  apiKey: process.env.MEMENTO_API_KEY
});

// ❌ 나쁜 예: 하드코딩
const client = new MementoClient({
  apiKey: 'your-secret-key' // 보안 위험
});
```

### 2. 입력 검증

```typescript
// ✅ 좋은 예: 입력 검증
function validateMemoryData(data: any): CreateMemoryParams {
  if (!data.content || typeof data.content !== 'string') {
    throw new ValidationError('Content is required and must be a string');
  }
  
  if (data.importance && (data.importance < 0 || data.importance > 1)) {
    throw new ValidationError('Importance must be between 0 and 1');
  }
  
  return data as CreateMemoryParams;
}
```

### 3. 민감한 데이터 처리

```typescript
// ✅ 좋은 예: 민감한 데이터 마스킹
class SecureMemoryManager extends MemoryManager {
  async create(data: CreateMemoryParams) {
    // 민감한 정보 마스킹
    const sanitizedData = this.sanitizeData(data);
    return await super.create(sanitizedData);
  }
  
  private sanitizeData(data: CreateMemoryParams): CreateMemoryParams {
    return {
      ...data,
      content: this.maskSensitiveInfo(data.content)
    };
  }
  
  private maskSensitiveInfo(content: string): string {
    // 이메일, 전화번호 등 민감한 정보 마스킹
    return content
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
      .replace(/\b\d{3}-\d{4}-\d{4}\b/g, '[PHONE]');
  }
}
```

## 코드 품질

### 1. 타입 안전성

```typescript
// ✅ 좋은 예: 강타입 사용
interface MemorySearchOptions {
  query: string;
  filters?: SearchFilters;
  limit?: number;
  useHybrid?: boolean;
}

async function searchMemories(options: MemorySearchOptions): Promise<SearchResult> {
  return await manager.search(options.query, {
    filters: options.filters,
    limit: options.limit,
    useHybrid: options.useHybrid
  });
}

// ❌ 나쁜 예: any 타입 사용
async function searchMemories(options: any): Promise<any> {
  return await manager.search(options.query, options);
}
```

### 2. 함수 분리

```typescript
// ✅ 좋은 예: 작은 함수로 분리
class MemoryProcessor {
  async processMemories(memories: MemoryItem[]) {
    const validMemories = this.validateMemories(memories);
    const enrichedMemories = await this.enrichMemories(validMemories);
    const savedMemories = await this.saveMemories(enrichedMemories);
    return this.generateReport(savedMemories);
  }
  
  private validateMemories(memories: MemoryItem[]): MemoryItem[] {
    return memories.filter(memory => this.isValidMemory(memory));
  }
  
  private async enrichMemories(memories: MemoryItem[]): Promise<MemoryItem[]> {
    return Promise.all(memories.map(memory => this.enrichMemory(memory)));
  }
}
```

### 3. 상수 사용

```typescript
// ✅ 좋은 예: 상수 정의
const MEMORY_CONSTANTS = {
  MAX_BATCH_SIZE: 100,
  DEFAULT_TIMEOUT: 10000,
  CACHE_TTL: 5 * 60 * 1000, // 5분
  RETRY_ATTEMPTS: 3
} as const;

// 사용
const results = await optimizer.createMemoriesBatch(memories, {
  batchSize: MEMORY_CONSTANTS.MAX_BATCH_SIZE
});
```

## 테스트 전략

### 1. 단위 테스트

```typescript
// ✅ 좋은 예: 단위 테스트
describe('MemoryManager', () => {
  let mockClient: jest.Mocked<MementoClient>;
  let manager: MemoryManager;
  
  beforeEach(() => {
    mockClient = createMockClient();
    manager = new MemoryManager(mockClient);
  });
  
  it('should create memory with valid data', async () => {
    const memoryData = {
      content: 'test content',
      type: 'episodic' as const,
      importance: 0.5
    };
    
    mockClient.remember.mockResolvedValue({
      id: 'test-id',
      ...memoryData,
      created_at: new Date().toISOString()
    });
    
    const result = await manager.create(memoryData);
    
    expect(result).toBeDefined();
    expect(mockClient.remember).toHaveBeenCalledWith(memoryData);
  });
});
```

### 2. 통합 테스트

```typescript
// ✅ 좋은 예: 통합 테스트
describe('Integration Tests', () => {
  let client: MementoClient;
  let manager: MemoryManager;
  
  beforeAll(async () => {
    client = new MementoClient({
      serverUrl: 'http://localhost:8080'
    });
    await client.connect();
    manager = new MemoryManager(client);
  });
  
  afterAll(async () => {
    await client.disconnect();
  });
  
  it('should perform full CRUD operations', async () => {
    // Create
    const memory = await manager.create({
      content: 'integration test',
      type: 'episodic'
    });
    
    // Read
    const retrieved = await manager.get(memory.id);
    expect(retrieved).toBeDefined();
    
    // Update
    const updated = await manager.update(memory.id, {
      importance: 0.9
    });
    expect(updated.importance).toBe(0.9);
    
    // Delete
    const deleted = await manager.delete(memory.id);
    expect(deleted).toBe(true);
  });
});
```

### 3. 성능 테스트

```typescript
// ✅ 좋은 예: 성능 테스트
describe('Performance Tests', () => {
  it('should handle large batch operations efficiently', async () => {
    const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
      content: `test data ${i}`,
      type: 'episodic' as const,
      importance: Math.random()
    }));
    
    const startTime = Date.now();
    const results = await optimizer.createMemoriesBatch(largeDataset, {
      batchSize: 50
    });
    const endTime = Date.now();
    
    expect(results).toHaveLength(1000);
    expect(endTime - startTime).toBeLessThan(30000); // 30초 이내
  });
});
```

## 배포 및 운영

### 1. 환경별 설정

```typescript
// ✅ 좋은 예: 환경별 설정
const getClientConfig = () => {
  const env = process.env.NODE_ENV || 'development';
  
  const configs = {
    development: {
      serverUrl: 'http://localhost:8080',
      logLevel: 'debug' as const,
      timeout: 10000
    },
    staging: {
      serverUrl: 'https://staging-memento.example.com',
      logLevel: 'info' as const,
      timeout: 15000
    },
    production: {
      serverUrl: 'https://memento.example.com',
      logLevel: 'warn' as const,
      timeout: 30000
    }
  };
  
  return configs[env];
};

const client = new MementoClient(getClientConfig());
```

### 2. 모니터링 설정

```typescript
// ✅ 좋은 예: 모니터링 설정
class MonitoredMemoryManager extends MemoryManager {
  private metrics = new Map<string, number>();
  
  async create(data: CreateMemoryParams): Promise<MemoryItem> {
    const startTime = Date.now();
    
    try {
      const result = await super.create(data);
      this.recordMetric('memory.create.success', Date.now() - startTime);
      return result;
    } catch (error) {
      this.recordMetric('memory.create.error', Date.now() - startTime);
      throw error;
    }
  }
  
  private recordMetric(metric: string, value: number) {
    this.metrics.set(metric, value);
    // 외부 모니터링 시스템에 전송
    this.sendToMonitoring(metric, value);
  }
}
```

### 3. 로그 관리

```typescript
// ✅ 좋은 예: 구조화된 로깅
class Logger {
  private context: string;
  
  constructor(context: string) {
    this.context = context;
  }
  
  info(message: string, data?: any) {
    console.log(JSON.stringify({
      level: 'info',
      context: this.context,
      message,
      data,
      timestamp: new Date().toISOString()
    }));
  }
  
  error(message: string, error?: Error, data?: any) {
    console.error(JSON.stringify({
      level: 'error',
      context: this.context,
      message,
      error: error?.message,
      stack: error?.stack,
      data,
      timestamp: new Date().toISOString()
    }));
  }
}
```

이 모범 사례를 따라하면 @memento/client를 안전하고 효율적으로 사용할 수 있습니다.

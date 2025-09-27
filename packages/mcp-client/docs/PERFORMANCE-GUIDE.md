# @memento/client 성능 가이드

## 목차

- [성능 최적화 개요](#성능-최적화-개요)
- [배치 처리](#배치-처리)
- [캐싱 전략](#캐싱-전략)
- [병렬 처리](#병렬-처리)
- [메모리 사용량 최적화](#메모리-사용량-최적화)
- [성능 모니터링](#성능-모니터링)
- [벤치마킹](#벤치마킹)
- [문제 해결](#문제-해결)

## 성능 최적화 개요

`@memento/client`는 대용량 데이터 처리와 높은 성능을 위해 다양한 최적화 기법을 제공합니다.

### 주요 최적화 기능

- **배치 처리**: 여러 작업을 묶어서 처리
- **캐싱**: 자주 사용되는 데이터를 메모리에 저장
- **병렬 처리**: 여러 요청을 동시에 처리
- **스트리밍**: 대용량 결과를 청크 단위로 처리
- **압축**: 불필요한 데이터 제거

## 배치 처리

### 기본 배치 처리

```typescript
import { MementoClient, MemoryManager } from '@memento/client';
import { PerformanceOptimizer } from './performance-optimizer';

const client = new MementoClient();
const manager = new MemoryManager(client);
const optimizer = new PerformanceOptimizer(client);

// 대량 기억 생성
const memories = Array.from({ length: 1000 }, (_, i) => ({
  content: `기억 ${i + 1}: TypeScript 학습 내용`,
  type: 'episodic',
  importance: Math.random(),
  tags: ['typescript', 'learning']
}));

// 배치 처리로 생성
const results = await optimizer.createMemoriesBatch(memories, {
  batchSize: 50,        // 배치 크기
  delayBetweenBatches: 100,  // 배치 간 지연 (ms)
  onProgress: (progress) => {
    console.log(`진행률: ${progress.processed}/${progress.total} (${progress.batchNumber}/${progress.totalBatches})`);
  }
});
```

### 배치 크기 최적화

```typescript
// 시스템 리소스에 따른 배치 크기 조정
const getOptimalBatchSize = (totalItems: number, systemMemory: number) => {
  if (systemMemory < 4) return 10;      // 4GB 미만
  if (systemMemory < 8) return 25;      // 8GB 미만
  if (systemMemory < 16) return 50;     // 16GB 미만
  return 100;                           // 16GB 이상
};

const batchSize = getOptimalBatchSize(memories.length, navigator.deviceMemory || 8);
```

## 캐싱 전략

### 기본 캐싱

```typescript
// 캐시를 활용한 검색
const searchResults = await optimizer.cachedSearch('React Hook', {
  limit: 20,
  filters: { type: ['episodic'] }
});

// 캐시 히트율 확인
const stats = optimizer.getPerformanceStats();
console.log(`캐시 히트율: ${stats.cacheHitRate}%`);
```

### 캐시 관리

```typescript
// 캐시 정리
optimizer.clearCache();

// 캐시 설정 조정
optimizer.cacheTimeout = 10 * 60 * 1000; // 10분으로 연장
```

### 사용자 정의 캐싱

```typescript
class CustomCache {
  private cache = new Map();
  private maxSize = 1000;
  private ttl = 5 * 60 * 1000; // 5분

  set(key: string, value: any) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  get(key: string) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }
}
```

## 병렬 처리

### 기본 병렬 검색

```typescript
const queries = [
  'React Hook',
  'TypeScript interface',
  'JavaScript async',
  'CSS Grid',
  'Node.js performance'
];

const results = await optimizer.parallelSearch(queries, {
  maxConcurrency: 5,  // 최대 동시 실행 수
  timeout: 10000      // 개별 요청 타임아웃
});

// 결과 처리
results.forEach((result, index) => {
  if (result.success) {
    console.log(`쿼리 ${index + 1}: ${result.searchTime}ms, 결과 ${result.result.total_count}개`);
  } else {
    console.error(`쿼리 ${index + 1} 실패: ${result.error}`);
  }
});
```

### 동시성 제어

```typescript
import { Semaphore } from './performance-optimizer';

class ConcurrencyController {
  private semaphore: Semaphore;
  
  constructor(maxConcurrency: number) {
    this.semaphore = new Semaphore(maxConcurrency);
  }
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    await this.semaphore.acquire();
    try {
      return await operation();
    } finally {
      this.semaphore.release();
    }
  }
}

// 사용 예시
const controller = new ConcurrencyController(3);
const promises = operations.map(op => controller.execute(op));
const results = await Promise.all(promises);
```

## 메모리 사용량 최적화

### 스트리밍 검색

```typescript
// 대용량 결과를 스트리밍으로 처리
async function processLargeSearch(query: string) {
  const stream = optimizer.streamSearch(query, {
    pageSize: 100,
    maxPages: 50
  });
  
  let totalProcessed = 0;
  
  for await (const page of stream) {
    console.log(`페이지 ${page.page}: ${page.items.length}개 항목`);
    
    // 각 페이지 처리
    await processPage(page.items);
    
    totalProcessed += page.items.length;
    
    // 메모리 사용량 체크
    if (totalProcessed % 1000 === 0) {
      console.log(`처리된 항목: ${totalProcessed}개`);
    }
  }
}
```

### 압축 검색

```typescript
// 중요도 기반 압축 검색
const compressedResults = await optimizer.compressedSearch('프로그래밍', {
  maxResults: 50,
  compressionRatio: 0.7  // 70% 압축
});

console.log(`원본: ${compressedResults.original_count}개`);
console.log(`압축: ${compressedResults.total_count}개`);
console.log(`압축률: ${((1 - compressedResults.total_count / compressedResults.original_count) * 100).toFixed(1)}%`);
```

### 메모리 모니터링

```typescript
class MemoryMonitor {
  private initialMemory: number;
  
  constructor() {
    this.initialMemory = process.memoryUsage().heapUsed;
  }
  
  getMemoryUsage() {
    const current = process.memoryUsage();
    return {
      heapUsed: current.heapUsed,
      heapTotal: current.heapTotal,
      external: current.external,
      rss: current.rss,
      delta: current.heapUsed - this.initialMemory
    };
  }
  
  checkMemoryLimit(limitMB: number = 100) {
    const usage = this.getMemoryUsage();
    const usageMB = usage.heapUsed / 1024 / 1024;
    
    if (usageMB > limitMB) {
      console.warn(`메모리 사용량 초과: ${usageMB.toFixed(2)}MB > ${limitMB}MB`);
      return false;
    }
    
    return true;
  }
}

// 사용 예시
const monitor = new MemoryMonitor();

// 작업 전
console.log('시작 메모리:', monitor.getMemoryUsage());

// 작업 후
console.log('종료 메모리:', monitor.getMemoryUsage());
console.log('메모리 증가:', monitor.getMemoryUsage().delta / 1024 / 1024, 'MB');
```

## 성능 모니터링

### 기본 모니터링

```typescript
// 성능 통계 수집
const stats = optimizer.getPerformanceStats();
console.log('성능 통계:', {
  총 요청 수: stats.totalRequests,
  평균 응답 시간: `${stats.averageResponseTime}ms`,
  캐시 히트율: `${stats.cacheHitRate}%`,
  배치 작업 수: stats.batchOperations,
  캐시 크기: stats.cacheSize
});
```

### 실시간 모니터링

```typescript
class PerformanceMonitor {
  private metrics = {
    requests: 0,
    totalTime: 0,
    errors: 0,
    cacheHits: 0,
    cacheMisses: 0
  };
  
  recordRequest(responseTime: number, fromCache: boolean = false) {
    this.metrics.requests++;
    this.metrics.totalTime += responseTime;
    
    if (fromCache) {
      this.metrics.cacheHits++;
    } else {
      this.metrics.cacheMisses++;
    }
  }
  
  recordError() {
    this.metrics.errors++;
  }
  
  getStats() {
    return {
      ...this.metrics,
      averageResponseTime: this.metrics.requests > 0 
        ? this.metrics.totalTime / this.metrics.requests 
        : 0,
      errorRate: this.metrics.requests > 0 
        ? (this.metrics.errors / this.metrics.requests) * 100 
        : 0,
      cacheHitRate: (this.metrics.cacheHits + this.metrics.cacheMisses) > 0
        ? (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses)) * 100
        : 0
    };
  }
  
  reset() {
    this.metrics = {
      requests: 0,
      totalTime: 0,
      errors: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
  }
}
```

## 벤치마킹

### 기본 벤치마크

```typescript
// 성능 벤치마크 실행
const benchmarkResults = await optimizer.runBenchmark({
  testDataSize: 500,    // 테스트 데이터 크기
  iterations: 3         // 반복 횟수
});

console.log('벤치마크 결과:', benchmarkResults);
```

### 사용자 정의 벤치마크

```typescript
async function customBenchmark() {
  const testCases = [
    { name: '작은 배치', size: 10, batchSize: 5 },
    { name: '중간 배치', size: 100, batchSize: 25 },
    { name: '큰 배치', size: 1000, batchSize: 50 }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n${testCase.name} 테스트 시작...`);
    
    const memories = generateTestMemories(testCase.size);
    const startTime = Date.now();
    
    await optimizer.createMemoriesBatch(memories, {
      batchSize: testCase.batchSize
    });
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`완료: ${duration}ms (${(testCase.size / duration * 1000).toFixed(2)} items/sec)`);
  }
}

function generateTestMemories(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    content: `테스트 기억 ${i + 1}: 성능 테스트용 데이터입니다.`,
    type: 'episodic' as const,
    importance: Math.random(),
    tags: ['benchmark', 'test']
  }));
}
```

## 문제 해결

### 일반적인 성능 문제

#### 1. 느린 응답 시간

```typescript
// 문제 진단
const stats = optimizer.getPerformanceStats();
if (stats.averageResponseTime > 5000) {
  console.warn('응답 시간이 느립니다. 다음을 확인하세요:');
  console.log('- 네트워크 연결 상태');
  console.log('- 서버 부하');
  console.log('- 캐시 설정');
}

// 해결 방법
optimizer.clearCache(); // 캐시 정리
client.setTimeout(15000); // 타임아웃 증가
```

#### 2. 메모리 사용량 증가

```typescript
// 메모리 사용량 체크
const memoryUsage = process.memoryUsage();
const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;

if (heapUsedMB > 500) {
  console.warn(`메모리 사용량이 높습니다: ${heapUsedMB.toFixed(2)}MB`);
  
  // 해결 방법
  optimizer.clearCache(); // 캐시 정리
  global.gc && global.gc(); // 가비지 컬렉션 강제 실행
}
```

#### 3. 연결 오류

```typescript
// 연결 상태 확인
try {
  const health = await client.healthCheck();
  if (health.status !== 'healthy') {
    console.error('서버 상태가 불량합니다');
  }
} catch (error) {
  console.error('서버 연결 실패:', error.message);
  
  // 재연결 시도
  await client.disconnect();
  await new Promise(resolve => setTimeout(resolve, 1000));
  await client.connect();
}
```

### 성능 최적화 체크리스트

- [ ] 배치 크기가 적절한가? (10-100개)
- [ ] 캐시가 활성화되어 있는가?
- [ ] 병렬 처리가 적절히 사용되고 있는가?
- [ ] 메모리 사용량이 제한 범위 내인가?
- [ ] 네트워크 연결이 안정적인가?
- [ ] 서버 리소스가 충분한가?

### 성능 프로파일링

```typescript
// CPU 프로파일링
const profiler = require('v8-profiler-next');

profiler.startProfiling('memento-client');
// 작업 수행
const profile = profiler.stopProfiling('memento-client');

// 메모리 프로파일링
const heapSnapshot = require('v8').getHeapSnapshot();
console.log('힙 스냅샷 생성됨');
```

이 가이드를 따라하면 `@memento/client`의 성능을 최적화하고 대용량 데이터를 효율적으로 처리할 수 있습니다.

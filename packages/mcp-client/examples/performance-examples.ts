/**
 * @memento/client 성능 최적화 예제
 * 
 * 이 파일은 성능 최적화 기능들을 사용하는 예제들을 제공합니다.
 */

import { MementoClient, MemoryManager, ContextInjector } from '../dist/index.js';
import { PerformanceOptimizer } from '../performance-optimizer.js';

// 클라이언트 설정
const client = new MementoClient({
  serverUrl: 'http://localhost:8080',
  logLevel: 'info',
  timeout: 15000,
  retryCount: 3
});

const manager = new MemoryManager(client);
const injector = new ContextInjector(client);
const optimizer = new PerformanceOptimizer(client);

/**
 * 예제 1: 대량 데이터 배치 처리
 */
async function batchProcessingExample() {
  console.log('📦 배치 처리 예제');
  
  // 대량 테스트 데이터 생성
  const testMemories = Array.from({ length: 1000 }, (_, i) => ({
    content: `배치 처리 테스트 데이터 ${i + 1}: TypeScript와 React에 대한 상세한 학습 내용입니다.`,
    type: 'episodic' as const,
    importance: Math.random(),
    tags: ['batch-test', 'typescript', 'react'],
    source: 'performance-example'
  }));

  // 배치 처리 실행
  const results = await optimizer.createMemoriesBatch(testMemories, {
    batchSize: 50,
    delayBetweenBatches: 100,
    onProgress: (progress) => {
      const percentage = ((progress.processed / progress.total) * 100).toFixed(1);
      console.log(`진행률: ${percentage}% (${progress.processed}/${progress.total})`);
    }
  });

  console.log(`✅ 배치 처리 완료: ${results.length}개 기억 생성`);
  return results;
}

/**
 * 예제 2: 병렬 검색 최적화
 */
async function parallelSearchExample() {
  console.log('🔍 병렬 검색 예제');
  
  const searchQueries = [
    'React Hook 사용법',
    'TypeScript 인터페이스 설계',
    'JavaScript 비동기 처리',
    'CSS Grid 레이아웃',
    'Node.js 성능 최적화',
    '데이터베이스 인덱싱',
    'API 설계 원칙',
    '보안 모범 사례'
  ];

  // 병렬 검색 실행
  const results = await optimizer.parallelSearch(searchQueries, {
    maxConcurrency: 4,
    timeout: 10000
  });

  // 결과 분석
  const successful = results.filter(r => r.success).length;
  const totalResults = results.reduce((sum, r) => sum + (r.result?.total_count || 0), 0);
  
  console.log(`✅ 병렬 검색 완료: ${successful}/${searchQueries.length}개 성공`);
  console.log(`총 검색 결과: ${totalResults}개`);
  
  return results;
}

/**
 * 예제 3: 캐싱을 활용한 검색 최적화
 */
async function cachingExample() {
  console.log('💾 캐싱 예제');
  
  const query = 'React 개발 패턴';
  
  // 첫 번째 검색 (캐시 미스)
  console.log('첫 번째 검색 (캐시 미스)...');
  const start1 = Date.now();
  const result1 = await optimizer.cachedSearch(query, { limit: 20 });
  const time1 = Date.now() - start1;
  
  // 두 번째 검색 (캐시 히트)
  console.log('두 번째 검색 (캐시 히트)...');
  const start2 = Date.now();
  const result2 = await optimizer.cachedSearch(query, { limit: 20 });
  const time2 = Date.now() - start2;
  
  console.log(`첫 번째 검색: ${time1}ms`);
  console.log(`두 번째 검색: ${time2}ms`);
  console.log(`성능 향상: ${((time1 - time2) / time1 * 100).toFixed(1)}%`);
  
  // 성능 통계 확인
  const stats = optimizer.getPerformanceStats();
  console.log('성능 통계:', stats);
  
  return { result1, result2, time1, time2 };
}

/**
 * 예제 4: 스트리밍 검색
 */
async function streamingSearchExample() {
  console.log('🌊 스트리밍 검색 예제');
  
  const query = '프로그래밍 학습';
  let totalProcessed = 0;
  
  console.log('스트리밍 검색 시작...');
  
  for await (const page of optimizer.streamSearch(query, {
    pageSize: 50,
    maxPages: 20
  })) {
    console.log(`페이지 ${page.page + 1}: ${page.items.length}개 항목`);
    
    // 각 페이지 처리 (예: 데이터 분석, 저장 등)
    await processPageData(page.items);
    
    totalProcessed += page.items.length;
    
    // 메모리 사용량 체크
    if (totalProcessed % 200 === 0) {
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
      console.log(`처리된 항목: ${totalProcessed}개, 메모리: ${heapUsedMB.toFixed(2)}MB`);
    }
  }
  
  console.log(`✅ 스트리밍 검색 완료: ${totalProcessed}개 항목 처리`);
  return totalProcessed;
}

/**
 * 예제 5: 압축 검색
 */
async function compressedSearchExample() {
  console.log('🗜️ 압축 검색 예제');
  
  const query = '웹 개발 기술';
  
  // 일반 검색
  console.log('일반 검색...');
  const normalStart = Date.now();
  const normalResults = await manager.search(query, { limit: 100 });
  const normalTime = Date.now() - normalStart;
  
  // 압축 검색
  console.log('압축 검색...');
  const compressedStart = Date.now();
  const compressedResults = await optimizer.compressedSearch(query, {
    maxResults: 70,
    compressionRatio: 0.7
  });
  const compressedTime = Date.now() - compressedStart;
  
  console.log(`일반 검색: ${normalResults.total_count}개, ${normalTime}ms`);
  console.log(`압축 검색: ${compressedResults.total_count}개, ${compressedTime}ms`);
  console.log(`압축률: ${((1 - compressedResults.total_count / normalResults.total_count) * 100).toFixed(1)}%`);
  console.log(`시간 단축: ${((normalTime - compressedTime) / normalTime * 100).toFixed(1)}%`);
  
  return { normalResults, compressedResults };
}

/**
 * 예제 6: 성능 벤치마크
 */
async function benchmarkExample() {
  console.log('🏁 성능 벤치마크 예제');
  
  const benchmarkResults = await optimizer.runBenchmark({
    testDataSize: 200,
    iterations: 3
  });
  
  console.log('벤치마크 결과:', benchmarkResults);
  
  // 성능 분석
  const avgCreateTime = benchmarkResults.createMemory.avg;
  const avgSearchTime = benchmarkResults.searchMemory.avg;
  const avgContextTime = benchmarkResults.contextInjection.avg;
  
  console.log('\n📊 성능 분석:');
  console.log(`평균 기억 생성 시간: ${avgCreateTime}ms`);
  console.log(`평균 검색 시간: ${avgSearchTime}ms`);
  console.log(`평균 컨텍스트 주입 시간: ${avgContextTime}ms`);
  
  return benchmarkResults;
}

/**
 * 예제 7: 메모리 사용량 최적화
 */
async function memoryOptimizationExample() {
  console.log('🧠 메모리 최적화 예제');
  
  // 메모리 모니터링 클래스
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
        console.warn(`⚠️ 메모리 사용량 초과: ${usageMB.toFixed(2)}MB > ${limitMB}MB`);
        return false;
      }
      
      return true;
    }
  }
  
  const monitor = new MemoryMonitor();
  
  console.log('시작 메모리:', monitor.getMemoryUsage());
  
  // 대량 데이터 처리
  const largeDataset = Array.from({ length: 500 }, (_, i) => ({
    content: `대용량 데이터 ${i + 1}: 메모리 최적화 테스트를 위한 상세한 내용입니다.`,
    type: 'episodic' as const,
    importance: Math.random(),
    tags: ['memory-test', 'optimization']
  }));
  
  // 메모리 사용량을 모니터링하면서 처리
  for (let i = 0; i < largeDataset.length; i += 100) {
    const batch = largeDataset.slice(i, i + 100);
    
    // 메모리 사용량 체크
    if (!monitor.checkMemoryLimit(200)) {
      console.log('메모리 사용량이 높아서 잠시 대기...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 가비지 컬렉션 강제 실행
      if (global.gc) {
        global.gc();
      }
    }
    
    // 배치 처리
    await optimizer.createMemoriesBatch(batch, { batchSize: 20 });
    
    console.log(`처리 완료: ${i + batch.length}/${largeDataset.length}`);
  }
  
  console.log('최종 메모리:', monitor.getMemoryUsage());
  
  return monitor.getMemoryUsage();
}

/**
 * 예제 8: 실시간 성능 모니터링
 */
async function realTimeMonitoringExample() {
  console.log('📊 실시간 성능 모니터링 예제');
  
  class RealTimeMonitor {
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
    
    startMonitoring(intervalMs: number = 5000) {
      setInterval(() => {
        const stats = this.getStats();
        console.log('📈 실시간 성능 통계:', {
          요청 수: stats.requests,
          평균 응답 시간: `${stats.averageResponseTime.toFixed(2)}ms`,
          에러율: `${stats.errorRate.toFixed(2)}%`,
          캐시 히트율: `${stats.cacheHitRate.toFixed(2)}%`
        });
      }, intervalMs);
    }
  }
  
  const monitor = new RealTimeMonitor();
  monitor.startMonitoring(3000); // 3초마다 통계 출력
  
  // 테스트 작업들 실행
  const queries = ['React', 'TypeScript', 'JavaScript', 'Node.js'];
  
  for (let i = 0; i < 20; i++) {
    const query = queries[i % queries.length];
    const start = Date.now();
    
    try {
      const result = await optimizer.cachedSearch(query, { limit: 10 });
      const responseTime = Date.now() - start;
      monitor.recordRequest(responseTime, i > 4); // 5번째부터는 캐시 히트
    } catch (error) {
      monitor.recordError();
      console.error(`검색 실패: ${query}`, error);
    }
    
    // 작업 간 지연
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return monitor.getStats();
}

// 유틸리티 함수들
async function processPageData(items: any[]) {
  // 페이지 데이터 처리 로직
  await new Promise(resolve => setTimeout(resolve, 10)); // 시뮬레이션
}

// 메인 실행 함수
async function runPerformanceExamples() {
  console.log('🚀 @memento/client 성능 최적화 예제 실행\n');
  
  try {
    // 서버 연결
    await client.connect();
    console.log('✅ 서버 연결 완료\n');
    
    // 예제들 실행
    console.log('='.repeat(60));
    await batchProcessingExample();
    
    console.log('\n' + '='.repeat(60));
    await parallelSearchExample();
    
    console.log('\n' + '='.repeat(60));
    await cachingExample();
    
    console.log('\n' + '='.repeat(60));
    await streamingSearchExample();
    
    console.log('\n' + '='.repeat(60));
    await compressedSearchExample();
    
    console.log('\n' + '='.repeat(60));
    await benchmarkExample();
    
    console.log('\n' + '='.repeat(60));
    await memoryOptimizationExample();
    
    console.log('\n' + '='.repeat(60));
    await realTimeMonitoringExample();
    
    console.log('\n🎉 모든 성능 최적화 예제 완료!');
    
  } catch (error) {
    console.error('❌ 예제 실행 실패:', error);
  } finally {
    // 정리
    await client.disconnect();
    console.log('🔌 서버 연결 해제');
  }
}

// 모듈로 실행할 때만 예제 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  runPerformanceExamples().catch(console.error);
}

export {
  batchProcessingExample,
  parallelSearchExample,
  cachingExample,
  streamingSearchExample,
  compressedSearchExample,
  benchmarkExample,
  memoryOptimizationExample,
  realTimeMonitoringExample,
  runPerformanceExamples
};

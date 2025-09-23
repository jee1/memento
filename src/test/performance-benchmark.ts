/**
 * 성능 벤치마크 테스트
 * Memento MCP 서버의 성능 측정 및 분석
 */

import { createMementoClient } from '../client/index.js';
import { PerformanceMonitor } from '../services/performance-monitor.js';
import { CacheService, SearchCacheService } from '../services/cache-service.js';
import { AsyncTaskQueue } from '../services/async-optimizer.js';

interface BenchmarkResult {
  testName: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  throughput: number;
  memoryUsage: {
    before: NodeJS.MemoryUsage;
    after: NodeJS.MemoryUsage;
    delta: NodeJS.MemoryUsage;
  };
  successRate: number;
  errors: string[];
}

export class PerformanceBenchmark {
  private client: any;
  private performanceMonitor: PerformanceMonitor | null = null;
  private searchCache: SearchCacheService;
  private taskQueue: AsyncTaskQueue;
  private results: BenchmarkResult[] = [];

  constructor() {
    this.client = createMementoClient();
    this.searchCache = new SearchCacheService(1000, 300000); // 5분 TTL
    this.taskQueue = new AsyncTaskQueue(4);
  }

  /**
   * 전체 벤치마크 실행
   */
  async runFullBenchmark(): Promise<void> {
    console.log('🚀 Memento MCP 서버 성능 벤치마크 시작');
    
    try {
      // 서버 연결
      await this.client.connect();
      console.log('✅ 서버 연결 완료');

      // 성능 모니터 초기화
      this.performanceMonitor = new PerformanceMonitor(this.client.db);

      // 벤치마크 테스트 실행
      await this.benchmarkMemoryOperations();
      await this.benchmarkSearchOperations();
      await this.benchmarkCacheOperations();
      await this.benchmarkAsyncOperations();
      await this.benchmarkConcurrentOperations();

      // 결과 리포트 생성
      this.generateReport();

    } catch (error) {
      console.error('❌ 벤치마크 실행 실패:', error);
    } finally {
      await this.client.disconnect();
    }
  }

  /**
   * 메모리 작업 벤치마크
   */
  private async benchmarkMemoryOperations(): Promise<void> {
    console.log('\n📝 메모리 작업 벤치마크 시작');
    
    const iterations = 100;
    const times: number[] = [];
    const errors: string[] = [];
    const beforeMemory = process.memoryUsage();

    for (let i = 0; i < iterations; i++) {
      const startTime = process.hrtime.bigint();
      
      try {
        await this.client.remember(
          `벤치마크 테스트 메모리 ${i}: 성능 테스트를 위한 샘플 데이터입니다.`,
          'episodic',
          ['benchmark', 'test', `iteration-${i}`],
          0.5
        );
        
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1_000_000;
        times.push(executionTime);
        
      } catch (error) {
        errors.push(`Iteration ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    const afterMemory = process.memoryUsage();
    const result = this.calculateBenchmarkResult(
      'Memory Operations',
      iterations,
      times,
      beforeMemory,
      afterMemory,
      errors
    );

    this.results.push(result);
    this.printResult(result);
  }

  /**
   * 검색 작업 벤치마크
   */
  private async benchmarkSearchOperations(): Promise<void> {
    console.log('\n🔍 검색 작업 벤치마크 시작');
    
    const searchQueries = [
      '벤치마크',
      '테스트',
      '성능',
      '메모리',
      '검색',
      '데이터',
      '시스템',
      '최적화',
      '알고리즘',
      '데이터베이스'
    ];

    const iterations = 50;
    const times: number[] = [];
    const errors: string[] = [];
    const beforeMemory = process.memoryUsage();

    for (let i = 0; i < iterations; i++) {
      const query = searchQueries[i % searchQueries.length];
      const startTime = process.hrtime.bigint();
      
      try {
        await this.client.recall({
          query,
          limit: 10
        });
        
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1_000_000;
        times.push(executionTime);
        
      } catch (error) {
        errors.push(`Search ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    const afterMemory = process.memoryUsage();
    const result = this.calculateBenchmarkResult(
      'Search Operations',
      iterations,
      times,
      beforeMemory,
      afterMemory,
      errors
    );

    this.results.push(result);
    this.printResult(result);
  }

  /**
   * 캐시 작업 벤치마크
   */
  private async benchmarkCacheOperations(): Promise<void> {
    console.log('\n💾 캐시 작업 벤치마크 시작');
    
    const iterations = 1000;
    const times: number[] = [];
    const errors: string[] = [];
    const beforeMemory = process.memoryUsage();

    // 캐시 데이터 준비
    const testData = Array.from({ length: 100 }, (_, i) => ({
      id: `test_${i}`,
      content: `테스트 데이터 ${i}`,
      score: Math.random()
    }));

    for (let i = 0; i < iterations; i++) {
      const startTime = process.hrtime.bigint();
      
      try {
        const query = `test_${i % 10}`;
        
        // 캐시에서 가져오기
        let results = this.searchCache.getSearchResults(query, {}, 10);
        
        if (!results) {
          // 캐시에 없으면 데이터 생성 후 저장
          results = testData.filter(item => item.content.includes(query));
          this.searchCache.setSearchResults(query, results, {}, 10);
        }
        
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1_000_000;
        times.push(executionTime);
        
      } catch (error) {
        errors.push(`Cache ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    const afterMemory = process.memoryUsage();
    const result = this.calculateBenchmarkResult(
      'Cache Operations',
      iterations,
      times,
      beforeMemory,
      afterMemory,
      errors
    );

    this.results.push(result);
    this.printResult(result);
  }

  /**
   * 비동기 작업 벤치마크
   */
  private async benchmarkAsyncOperations(): Promise<void> {
    console.log('\n⚡ 비동기 작업 벤치마크 시작');
    
    const iterations = 100;
    const times: number[] = [];
    const errors: string[] = [];
    const beforeMemory = process.memoryUsage();

    // 작업 큐 시작
    this.taskQueue.start();

    const startTime = process.hrtime.bigint();
    
    try {
      // 작업 추가
      const taskPromises = [];
      for (let i = 0; i < iterations; i++) {
        const taskId = this.taskQueue.addTask({
          type: 'embedding',
          data: { text: `Test text ${i}` },
          priority: Math.floor(Math.random() * 10),
          maxRetries: 3,
          timeout: 5000
        });
        
        taskPromises.push(this.waitForTaskCompletion(taskId));
      }

      // 모든 작업 완료 대기
      await Promise.all(taskPromises);
      
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1_000_000;
      times.push(executionTime);
      
    } catch (error) {
      errors.push(`Async ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    const afterMemory = process.memoryUsage();
    const result = this.calculateBenchmarkResult(
      'Async Operations',
      iterations,
      times,
      beforeMemory,
      afterMemory,
      errors
    );

    this.results.push(result);
    this.printResult(result);
  }

  /**
   * 동시 작업 벤치마크
   */
  private async benchmarkConcurrentOperations(): Promise<void> {
    console.log('\n🔄 동시 작업 벤치마크 시작');
    
    const concurrentUsers = 10;
    const operationsPerUser = 20;
    const times: number[] = [];
    const errors: string[] = [];
    const beforeMemory = process.memoryUsage();

    const startTime = process.hrtime.bigint();
    
    try {
      // 동시 사용자 시뮬레이션
      const userPromises = Array.from({ length: concurrentUsers }, async (_, userIndex) => {
        const userTimes: number[] = [];
        
        for (let i = 0; i < operationsPerUser; i++) {
          const operationStart = process.hrtime.bigint();
          
          try {
            // 랜덤 작업 선택
            const operation = Math.random();
            if (operation < 0.4) {
              // 메모리 저장
              await this.client.remember(
                `동시 테스트 사용자 ${userIndex} 작업 ${i}`,
                'episodic',
                ['concurrent', 'test', `user-${userIndex}`],
                0.5
              );
            } else if (operation < 0.7) {
              // 검색
              await this.client.recall({
                query: `사용자 ${userIndex}`,
                limit: 5
              });
            } else {
              // 통계 조회
              await this.client.callTool('forgetting_stats', {});
            }
            
            const operationEnd = process.hrtime.bigint();
            const operationTime = Number(operationEnd - operationStart) / 1_000_000;
            userTimes.push(operationTime);
            
          } catch (error) {
            errors.push(`User ${userIndex} Op ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        
        return userTimes;
      });

      const allUserTimes = await Promise.all(userPromises);
      times.push(...allUserTimes.flat());
      
    } catch (error) {
      errors.push(`Concurrent ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    const endTime = process.hrtime.bigint();
    const totalTime = Number(endTime - startTime) / 1_000_000;
    
    const afterMemory = process.memoryUsage();
    const result = this.calculateBenchmarkResult(
      'Concurrent Operations',
      concurrentUsers * operationsPerUser,
      times,
      beforeMemory,
      afterMemory,
      errors,
      totalTime
    );

    this.results.push(result);
    this.printResult(result);
  }

  /**
   * 작업 완료 대기
   */
  private async waitForTaskCompletion(taskId: string, maxWait: number = 10000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const status = this.taskQueue.getTaskStatus(taskId);
      if (status === 'completed' || status === 'failed') {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error(`Task ${taskId} did not complete within ${maxWait}ms`);
  }

  /**
   * 벤치마크 결과 계산
   */
  private calculateBenchmarkResult(
    testName: string,
    iterations: number,
    times: number[],
    beforeMemory: NodeJS.MemoryUsage,
    afterMemory: NodeJS.MemoryUsage,
    errors: string[],
    totalTime?: number
  ): BenchmarkResult {
    const actualIterations = times.length;
    const successRate = actualIterations / iterations;
    
    const totalTimeMs = totalTime || times.reduce((sum, time) => sum + time, 0);
    const averageTime = times.length > 0 ? times.reduce((sum, time) => sum + time, 0) / times.length : 0;
    const minTime = times.length > 0 ? Math.min(...times) : 0;
    const maxTime = times.length > 0 ? Math.max(...times) : 0;
    const throughput = actualIterations / (totalTimeMs / 1000);

    const delta: NodeJS.MemoryUsage = {
      rss: afterMemory.rss - beforeMemory.rss,
      heapTotal: afterMemory.heapTotal - beforeMemory.heapTotal,
      heapUsed: afterMemory.heapUsed - beforeMemory.heapUsed,
      external: afterMemory.external - beforeMemory.external,
      arrayBuffers: afterMemory.arrayBuffers - beforeMemory.arrayBuffers
    };

    return {
      testName,
      iterations: actualIterations,
      totalTime: totalTimeMs,
      averageTime,
      minTime,
      maxTime,
      throughput,
      memoryUsage: {
        before: beforeMemory,
        after: afterMemory,
        delta
      },
      successRate,
      errors
    };
  }

  /**
   * 결과 출력
   */
  private printResult(result: BenchmarkResult): void {
    console.log(`\n📊 ${result.testName} 결과:`);
    console.log(`   반복: ${result.iterations}회`);
    console.log(`   총 시간: ${result.totalTime.toFixed(2)}ms`);
    console.log(`   평균 시간: ${result.averageTime.toFixed(2)}ms`);
    console.log(`   최소 시간: ${result.minTime.toFixed(2)}ms`);
    console.log(`   최대 시간: ${result.maxTime.toFixed(2)}ms`);
    console.log(`   처리량: ${result.throughput.toFixed(2)} ops/sec`);
    console.log(`   성공률: ${(result.successRate * 100).toFixed(1)}%`);
    console.log(`   메모리 증가: ${(result.memoryUsage.delta.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    
    if (result.errors.length > 0) {
      console.log(`   오류: ${result.errors.length}개`);
    }
  }

  /**
   * 전체 리포트 생성
   */
  private generateReport(): void {
    console.log('\n📋 성능 벤치마크 리포트');
    console.log('='.repeat(50));
    
    const totalIterations = this.results.reduce((sum, r) => sum + r.iterations, 0);
    const totalTime = this.results.reduce((sum, r) => sum + r.totalTime, 0);
    const averageThroughput = this.results.reduce((sum, r) => sum + r.throughput, 0) / this.results.length;
    const totalErrors = this.results.reduce((sum, r) => sum + r.errors.length, 0);

    console.log(`\n📈 전체 통계:`);
    console.log(`   총 반복: ${totalIterations.toLocaleString()}회`);
    console.log(`   총 시간: ${(totalTime / 1000).toFixed(2)}초`);
    console.log(`   평균 처리량: ${averageThroughput.toFixed(2)} ops/sec`);
    console.log(`   총 오류: ${totalErrors}개`);

    console.log(`\n🏆 성능 순위:`);
    const sortedResults = [...this.results].sort((a, b) => b.throughput - a.throughput);
    sortedResults.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.testName}: ${result.throughput.toFixed(2)} ops/sec`);
    });

    console.log(`\n💾 메모리 사용량:`);
    this.results.forEach(result => {
      const memoryDelta = result.memoryUsage.delta.heapUsed / 1024 / 1024;
      console.log(`   ${result.testName}: ${memoryDelta > 0 ? '+' : ''}${memoryDelta.toFixed(2)} MB`);
    });

    console.log('\n✅ 벤치마크 완료!');
  }
}

// 벤치마크 실행
if (process.argv[1] && process.argv[1].endsWith('performance-benchmark.ts')) {
  const benchmark = new PerformanceBenchmark();
  benchmark.runFullBenchmark()
    .then(() => {
      console.log('🎉 성능 벤치마크 완료');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 벤치마크 실패:', error);
      process.exit(1);
    });
}

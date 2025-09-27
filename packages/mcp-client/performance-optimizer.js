/**
 * @memento/client 성능 최적화 도구
 * 
 * 대용량 데이터 처리와 성능 향상을 위한 최적화 기능들을 제공합니다.
 */

const { MementoClient, MemoryManager, ContextInjector } = require('./dist/index.js');

class PerformanceOptimizer {
  constructor(client) {
    this.client = client;
    this.manager = new MemoryManager(client);
    this.injector = new ContextInjector(client);
    
    // 성능 메트릭
    this.metrics = {
      requestCount: 0,
      totalResponseTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      batchOperations: 0
    };
    
    // 요청 캐시
    this.requestCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5분
  }

  /**
   * 배치 처리를 위한 메모리 생성
   */
  async createMemoriesBatch(memories, options = {}) {
    const {
      batchSize = 10,
      delayBetweenBatches = 100,
      onProgress = null
    } = options;

    const results = [];
    const totalBatches = Math.ceil(memories.length / batchSize);
    
    console.log(`📦 배치 처리 시작: ${memories.length}개 기억을 ${totalBatches}개 배치로 처리`);

    for (let i = 0; i < memories.length; i += batchSize) {
      const batch = memories.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      
      try {
        const startTime = Date.now();
        const batchResults = await this.manager.createBatch(batch);
        const batchTime = Date.now() - startTime;
        
        results.push(...batchResults);
        this.metrics.batchOperations++;
        
        if (onProgress) {
          onProgress({
            batchNumber,
            totalBatches,
            processed: Math.min(i + batchSize, memories.length),
            total: memories.length,
            batchTime,
            success: batchResults.length
          });
        }
        
        console.log(`  배치 ${batchNumber}/${totalBatches} 완료: ${batchResults.length}개 생성 (${batchTime}ms)`);
        
        // 배치 간 지연
        if (i + batchSize < memories.length && delayBetweenBatches > 0) {
          await this.delay(delayBetweenBatches);
        }
        
      } catch (error) {
        console.error(`  배치 ${batchNumber} 실패:`, error.message);
        // 실패한 배치는 건너뛰고 계속 진행
      }
    }

    console.log(`✅ 배치 처리 완료: ${results.length}개 기억 생성`);
    return results;
  }

  /**
   * 병렬 검색 최적화
   */
  async parallelSearch(queries, options = {}) {
    const {
      maxConcurrency = 5,
      timeout = 10000
    } = options;

    console.log(`🔍 병렬 검색 시작: ${queries.length}개 쿼리, 최대 동시성: ${maxConcurrency}`);

    const results = [];
    const semaphore = new Semaphore(maxConcurrency);

    const searchPromises = queries.map(async (query, index) => {
      await semaphore.acquire();
      
      try {
        const startTime = Date.now();
        const result = await Promise.race([
          this.manager.search(query, { limit: 10 }),
          this.timeoutPromise(timeout)
        ]);
        
        const searchTime = Date.now() - startTime;
        this.recordMetric(searchTime);
        
        return {
          index,
          query,
          result,
          searchTime,
          success: true
        };
        
      } catch (error) {
        return {
          index,
          query,
          error: error.message,
          success: false
        };
      } finally {
        semaphore.release();
      }
    });

    const searchResults = await Promise.all(searchPromises);
    results.push(...searchResults);

    const successful = searchResults.filter(r => r.success).length;
    console.log(`✅ 병렬 검색 완료: ${successful}/${queries.length}개 성공`);

    return results;
  }

  /**
   * 캐시를 활용한 검색 최적화
   */
  async cachedSearch(query, options = {}) {
    const cacheKey = this.generateCacheKey('search', query, options);
    const cached = this.requestCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      this.metrics.cacheHits++;
      console.log(`💾 캐시 히트: ${query}`);
      return cached.data;
    }

    this.metrics.cacheMisses++;
    const startTime = Date.now();
    
    try {
      const result = await this.manager.search(query, options);
      const responseTime = Date.now() - startTime;
      
      // 캐시에 저장
      this.requestCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });
      
      this.recordMetric(responseTime);
      return result;
      
    } catch (error) {
      console.error(`검색 실패: ${query}`, error.message);
      throw error;
    }
  }

  /**
   * 스트리밍 검색 (대용량 결과 처리)
   */
  async *streamSearch(query, options = {}) {
    const {
      pageSize = 50,
      maxPages = 20
    } = options;

    console.log(`🌊 스트리밍 검색 시작: ${query}`);

    let page = 0;
    let hasMore = true;
    let totalProcessed = 0;

    while (hasMore && page < maxPages) {
      try {
        const searchOptions = {
          ...options,
          limit: pageSize,
          offset: page * pageSize
        };

        const result = await this.manager.search(query, searchOptions);
        
        if (result.items.length === 0) {
          hasMore = false;
        } else {
          totalProcessed += result.items.length;
          yield {
            page,
            items: result.items,
            totalCount: result.total_count,
            processed: totalProcessed
          };
          
          page++;
        }
        
      } catch (error) {
        console.error(`스트리밍 검색 오류 (페이지 ${page}):`, error.message);
        break;
      }
    }

    console.log(`✅ 스트리밍 검색 완료: ${totalProcessed}개 항목 처리`);
  }

  /**
   * 메모리 사용량 최적화를 위한 압축 검색
   */
  async compressedSearch(query, options = {}) {
    const {
      maxResults = 100,
      compressionRatio = 0.7
    } = options;

    console.log(`🗜️ 압축 검색 시작: ${query}`);

    // 1. 더 많은 결과를 가져옴
    const expandedOptions = {
      ...options,
      limit: Math.ceil(maxResults / compressionRatio)
    };

    const fullResults = await this.manager.search(query, expandedOptions);
    
    // 2. 결과 압축 (중요도와 점수 기반)
    const compressedItems = fullResults.items
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, maxResults);

    // 3. 압축된 결과 반환
    return {
      items: compressedItems,
      total_count: compressedItems.length,
      query_time: fullResults.query_time,
      compressed: true,
      original_count: fullResults.items.length
    };
  }

  /**
   * 성능 벤치마크 실행
   */
  async runBenchmark(options = {}) {
    const {
      testDataSize = 100,
      iterations = 5
    } = options;

    console.log(`🏁 성능 벤치마크 시작: ${testDataSize}개 데이터, ${iterations}회 반복`);

    const benchmarks = {
      createMemory: [],
      searchMemory: [],
      contextInjection: []
    };

    // 테스트 데이터 생성
    const testMemories = Array.from({ length: testDataSize }, (_, i) => ({
      content: `벤치마크 테스트 데이터 ${i + 1}: TypeScript와 React에 대한 상세한 학습 내용입니다.`,
      type: 'episodic',
      importance: Math.random(),
      tags: ['benchmark', 'test', `data-${i}`],
      source: 'benchmark-test'
    }));

    // 벤치마크 실행
    for (let i = 0; i < iterations; i++) {
      console.log(`  반복 ${i + 1}/${iterations}`);
      
      // 메모리 생성 벤치마크
      const createStart = Date.now();
      await this.createMemoriesBatch(testMemories, { batchSize: 20 });
      benchmarks.createMemory.push(Date.now() - createStart);
      
      // 검색 벤치마크
      const searchStart = Date.now();
      await this.manager.search('TypeScript React', { limit: 50 });
      benchmarks.searchMemory.push(Date.now() - searchStart);
      
      // 컨텍스트 주입 벤치마크
      const contextStart = Date.now();
      await this.injector.inject('프로그래밍 학습', { tokenBudget: 1000 });
      benchmarks.contextInjection.push(Date.now() - contextStart);
    }

    // 결과 분석
    const results = this.analyzeBenchmarkResults(benchmarks);
    this.printBenchmarkResults(results);
    
    return results;
  }

  /**
   * 성능 메트릭 수집
   */
  recordMetric(responseTime) {
    this.metrics.requestCount++;
    this.metrics.totalResponseTime += responseTime;
  }

  /**
   * 성능 통계 조회
   */
  getPerformanceStats() {
    const avgResponseTime = this.metrics.requestCount > 0 
      ? this.metrics.totalResponseTime / this.metrics.requestCount 
      : 0;

    const cacheHitRate = this.metrics.cacheHits + this.metrics.cacheMisses > 0
      ? (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses)) * 100
      : 0;

    return {
      totalRequests: this.metrics.requestCount,
      averageResponseTime: Math.round(avgResponseTime),
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      batchOperations: this.metrics.batchOperations,
      cacheSize: this.requestCache.size
    };
  }

  /**
   * 캐시 정리
   */
  clearCache() {
    this.requestCache.clear();
    console.log('🧹 캐시가 정리되었습니다');
  }

  // 유틸리티 메서드들
  generateCacheKey(operation, query, options) {
    return `${operation}:${query}:${JSON.stringify(options)}`;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  timeoutPromise(ms) {
    return new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Operation timeout')), ms)
    );
  }

  analyzeBenchmarkResults(benchmarks) {
    const results = {};
    
    for (const [operation, times] of Object.entries(benchmarks)) {
      times.sort((a, b) => a - b);
      
      results[operation] = {
        min: times[0],
        max: times[times.length - 1],
        avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
        median: times[Math.floor(times.length / 2)],
        p95: times[Math.floor(times.length * 0.95)]
      };
    }
    
    return results;
  }

  printBenchmarkResults(results) {
    console.log('\n📊 벤치마크 결과');
    console.log('='.repeat(60));
    
    for (const [operation, stats] of Object.entries(results)) {
      console.log(`\n${operation}:`);
      console.log(`  최소: ${stats.min}ms`);
      console.log(`  최대: ${stats.max}ms`);
      console.log(`  평균: ${stats.avg}ms`);
      console.log(`  중간값: ${stats.median}ms`);
      console.log(`  95%ile: ${stats.p95}ms`);
    }
    
    console.log('\n' + '='.repeat(60));
  }
}

/**
 * 세마포어 클래스 (동시성 제어)
 */
class Semaphore {
  constructor(maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
    this.currentConcurrency = 0;
    this.queue = [];
  }

  async acquire() {
    return new Promise((resolve) => {
      if (this.currentConcurrency < this.maxConcurrency) {
        this.currentConcurrency++;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release() {
    this.currentConcurrency--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      this.currentConcurrency++;
      next();
    }
  }
}

module.exports = { PerformanceOptimizer, Semaphore };

/* eslint-disable no-console */
/**
 * 다중 Provider 검색 성능 벤치마크
 * 다중 임베딩 provider 환경에서 검색 응답 시간 측정
 * 
 * 사용법:
 *   npm run test:multi-provider-performance
 *   또는
 *   npx tsx src/test/multi-provider-search-performance-benchmark.ts
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../shared/utils/database.js';
import { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
import { initializeServices } from '../server/bootstrap.js';
import { insertMemoryItem, insertMemoryEmbedding } from './helpers/consolidation-test-data.js';
import { PIIMasker } from '../shared/utils/pii-masker.js';
import type { EmbeddingProvider } from '../shared/types/index.js';

interface BenchmarkResult {
  scenario: string;
  provider_count: number;
  providers: string[];
  query: string;
  iterations: number;
  total_time_ms: number;
  average_time_ms: number;
  min_time_ms: number;
  max_time_ms: number;
  p50_time_ms: number;
  p95_time_ms: number;
  p99_time_ms: number;
  success_rate: number;
  errors: string[];
}

interface ProviderSearchResult {
  provider: string;
  search_time_ms: number;
  result_count: number;
  success: boolean;
  error?: string;
}

class MultiProviderSearchBenchmark {
  private db: Database.Database;
  private hybridSearchEngine: HybridSearchEngine;
  private results: BenchmarkResult[] = [];

  constructor() {
    this.db = new Database(':memory:');
    DatabaseUtils.initializeDatabase(this.db);
    this.hybridSearchEngine = new HybridSearchEngine();
  }

  /**
   * 테스트 데이터 준비
   */
  private async prepareTestData(): Promise<void> {
    console.log('📦 테스트 데이터 준비 중...\n');

    // 여러 provider로 임베딩이 저장된 메모리 생성
    const providers: EmbeddingProvider[] = ['minilm', 'openai', 'gemini'];
    const memoryCount = 50; // 각 provider당 50개 메모리

    for (let i = 0; i < memoryCount; i++) {
      const memoryId = `mem-${i}`;
      const content = `테스트 메모리 ${i}: 다중 provider 검색 성능 벤치마크를 위한 샘플 데이터입니다. 이 메모리는 여러 provider로 임베딩되어 있습니다.`;

      insertMemoryItem(this.db, {
        id: memoryId,
        type: 'episodic',
        content
      });

      // 각 provider로 임베딩 생성 및 저장
      for (const provider of providers) {
        let embedding: number[];
        let dimensions: number;

        switch (provider) {
          case 'minilm':
            embedding = Array.from({ length: 384 }, () => Math.random() * 0.1);
            dimensions = 384;
            break;
          case 'openai':
            embedding = Array.from({ length: 1536 }, () => Math.random() * 0.1);
            dimensions = 1536;
            break;
          case 'gemini':
            embedding = Array.from({ length: 768 }, () => Math.random() * 0.1);
            dimensions = 768;
            break;
          default:
            embedding = Array.from({ length: 384 }, () => Math.random() * 0.1);
            dimensions = 384;
        }

        insertMemoryEmbedding(this.db, {
          memory_id: memoryId,
          embedding,
          embedding_provider: provider,
          dim: dimensions,
          dimensions
        });
      }
    }

    console.log(`✅ 테스트 데이터 준비 완료 (${memoryCount}개 메모리, ${providers.length}개 provider)\n`);
  }

  /**
   * 단일 provider 검색 성능 측정
   */
  private async benchmarkSingleProvider(
    provider: EmbeddingProvider,
    query: string,
    iterations: number = 10
  ): Promise<ProviderSearchResult[]> {
    const results: ProviderSearchResult[] = [];

    for (let i = 0; i < iterations; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const startTime = process.hrtime.bigint();

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const searchResult = await this.hybridSearchEngine.search(this.db, {
          query,
          limit: 10,
          provider_filter: [provider]
        });

        const endTime = process.hrtime.bigint();
        const searchTime = Number(endTime - startTime) / 1_000_000; // ms

        results.push({
          provider,
          search_time_ms: searchTime,
          result_count: searchResult.items.length,
          success: true
        });
      } catch (error) {
        results.push({
          provider,
          search_time_ms: 0,
          result_count: 0,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return results;
  }

  /**
   * 다중 provider 병렬 검색 성능 측정
   */
  private async benchmarkMultiProvider(
    providers: EmbeddingProvider[],
    query: string,
    iterations: number = 10
  ): Promise<BenchmarkResult> {
    const times: number[] = [];
    const errors: string[] = [];

    for (let i = 0; i < iterations; i++) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const startTime = process.hrtime.bigint();

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
        const searchResult = await this.hybridSearchEngine.search(this.db, {
          query,
          limit: 10,
          provider_filter: providers
        });

        const endTime = process.hrtime.bigint();
        const searchTime = Number(endTime - startTime) / 1_000_000; // ms
        times.push(searchTime);
      } catch (error) {
        errors.push(`Iteration ${i}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const sortedTimes = [...times].sort((a, b) => a - b);
    const successCount = times.length;
    const totalTime = times.reduce((sum, t) => sum + t, 0);

    return {
      scenario: `다중 Provider 병렬 검색 (${providers.length}개)`,
      provider_count: providers.length,
      providers,
      query,
      iterations,
      total_time_ms: totalTime,
      average_time_ms: totalTime / successCount,
      min_time_ms: sortedTimes[0] || 0,
      max_time_ms: sortedTimes[sortedTimes.length - 1] || 0,
      p50_time_ms: sortedTimes[Math.floor(sortedTimes.length * 0.5)] || 0,
      p95_time_ms: sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0,
      p99_time_ms: sortedTimes[Math.floor(sortedTimes.length * 0.99)] || 0,
      success_rate: (successCount / iterations) * 100,
      errors
    };
  }

  /**
   * 전체 벤치마크 실행
   */
  async runBenchmark(): Promise<void> {
    console.log('🚀 다중 Provider 검색 성능 벤치마크 시작\n');

    try {
      // 테스트 데이터 준비
      await this.prepareTestData();

      const testQueries = [
        '테스트 메모리',
        '다중 provider',
        '성능 벤치마크',
        '임베딩 검색'
      ];

      const providers: EmbeddingProvider[] = ['minilm', 'openai', 'gemini'];
      const iterations = 10;

      console.log('📊 벤치마크 시나리오:\n');
      console.log(`  - 단일 Provider 검색: ${providers.length}개 provider 각각 측정`);
      console.log(`  - 다중 Provider 병렬 검색: ${providers.length}개 provider 동시 검색`);
      console.log(`  - 반복 횟수: ${iterations}회`);
      console.log(`  - 테스트 쿼리: ${testQueries.length}개\n`);

      // 시나리오 1: 단일 Provider 검색 성능
      console.log('1️⃣ 단일 Provider 검색 성능 측정\n');
      for (const provider of providers) {
        console.log(`   ${provider} 검색 성능 측정 중...`);
        const results = await this.benchmarkSingleProvider(provider, testQueries[0], iterations);
        
        const times = results.filter(r => r.success).map(r => r.search_time_ms);
        const sortedTimes = [...times].sort((a, b) => a - b);
        const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;

        console.log(`   ✅ ${provider}: 평균 ${avgTime.toFixed(2)}ms (min: ${sortedTimes[0]?.toFixed(2)}ms, max: ${sortedTimes[sortedTimes.length - 1]?.toFixed(2)}ms)`);
      }

      // 시나리오 2: 다중 Provider 병렬 검색 성능
      console.log('\n2️⃣ 다중 Provider 병렬 검색 성능 측정\n');
      for (const query of testQueries) {
        console.log(`   쿼리: "${query}"`);
        const result = await this.benchmarkMultiProvider(providers, query, iterations);
        this.results.push(result);

        console.log(`   ✅ 평균 응답 시간: ${result.average_time_ms.toFixed(2)}ms`);
        console.log(`      P50: ${result.p50_time_ms.toFixed(2)}ms, P95: ${result.p95_time_ms.toFixed(2)}ms, P99: ${result.p99_time_ms.toFixed(2)}ms`);
        console.log(`      성공률: ${result.success_rate.toFixed(1)}%\n`);
      }

      // 결과 리포트 생성
      this.generateReport();

    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.error('❌ 벤치마크 실행 실패:', maskedError.message);
      throw error;
    } finally {
      this.db.close();
    }
  }

  /**
   * 결과 리포트 생성
   */
  private generateReport(): void {
    console.log('\n📈 벤치마크 결과 리포트\n');
    console.log('='.repeat(80));

    for (const result of this.results) {
      console.log(`\n시나리오: ${result.scenario}`);
      console.log(`Provider: ${result.providers.join(', ')}`);
      console.log(`쿼리: "${result.query}"`);
      console.log(`반복 횟수: ${result.iterations}회`);
      console.log(`\n응답 시간 통계:`);
      console.log(`  평균: ${result.average_time_ms.toFixed(2)}ms`);
      console.log(`  최소: ${result.min_time_ms.toFixed(2)}ms`);
      console.log(`  최대: ${result.max_time_ms.toFixed(2)}ms`);
      console.log(`  P50: ${result.p50_time_ms.toFixed(2)}ms`);
      console.log(`  P95: ${result.p95_time_ms.toFixed(2)}ms`);
      console.log(`  P99: ${result.p99_time_ms.toFixed(2)}ms`);
      console.log(`성공률: ${result.success_rate.toFixed(1)}%`);

      if (result.errors.length > 0) {
        console.log(`\n에러 (${result.errors.length}개):`);
        result.errors.slice(0, 5).forEach(error => console.log(`  - ${error}`));
        if (result.errors.length > 5) {
          console.log(`  ... 외 ${result.errors.length - 5}개`);
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n✅ 벤치마크 완료\n');
  }
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('multi-provider-search-performance-benchmark')) {
  const benchmark = new MultiProviderSearchBenchmark();
  benchmark.runBenchmark().catch(error => {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    console.error('벤치마크 실행 실패:', maskedError.message);
    process.exit(1);
  });
}

export { MultiProviderSearchBenchmark };

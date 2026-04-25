/**
 * 단일 Provider 환경 회귀 테스트
 * 다중 provider 검색 기능 추가 후, 단일 provider 환경에서 기존 성능이 유지되는지 확인
 * 
 * 사용법:
 *   npm run test:single-provider-regression
 *   또는
 *   npx tsx src/test/test-single-provider-regression.ts
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '@memento/core/shared/utils/database.js';
import { initializeServices } from '../server/bootstrap.js';
import { insertMemoryItem, insertMemoryEmbedding } from './helpers/consolidation-test-data.js';
import { executeTool } from '@memento/core/index.js';
import type { EmbeddingProvider } from '@memento/core/index.js';
import { PIIMasker } from '@memento/core/shared/utils/pii-masker.js';
import { createToolContext } from '../server/context.js';

interface RegressionTestResult {
  test_name: string;
  passed: boolean;
  message: string;
  performance_metrics?: {
    search_time_ms: number;
    result_count: number;
  };
}

async function testSingleProviderRegression() {
  console.log('🧪 단일 Provider 환경 회귀 테스트 시작\n');
  console.log('다중 provider 검색 기능 추가 후, 단일 provider 환경에서 기존 성능이 유지되는지 확인합니다.\n');

  let testDb: Database.Database | null = null;
  const results: RegressionTestResult[] = [];

  try {
    // 1. 데이터베이스 초기화
    console.log('1️⃣ 데이터베이스 초기화');
    testDb = new Database(':memory:');
    DatabaseUtils.initializeDatabase(testDb);
    console.log('✅ 데이터베이스 초기화 완료\n');

    // 2. 단일 provider (minilm)로만 임베딩이 저장된 테스트 데이터 생성
    console.log('2️⃣ 단일 Provider 테스트 데이터 생성');
    const provider: EmbeddingProvider = 'minilm';
    const memoryCount = 20;

    for (let i = 0; i < memoryCount; i++) {
      const memoryId = `mem-single-${i}`;
      const content = `단일 provider 회귀 테스트 메모리 ${i}: minilm provider로만 임베딩된 메모리입니다.`;

      insertMemoryItem(testDb, {
        id: memoryId,
        type: 'episodic',
        content
      });

      insertMemoryEmbedding(testDb, {
        memory_id: memoryId,
        embedding: Array.from({ length: 384 }, () => Math.random() * 0.1),
        embedding_provider: provider,
        dim: 384,
        dimensions: 384
      });
    }

    console.log(`✅ 테스트 데이터 생성 완료 (${memoryCount}개 메모리, provider: ${provider})\n`);

    // 3. 서비스 초기화
    console.log('3️⃣ 서비스 초기화');
    const services = await initializeServices(testDb);
    const context = createToolContext(testDb, services);
    console.log('✅ 서비스 초기화 완료\n');

    // 4. 단일 provider 검색 성능 테스트
    console.log('4️⃣ 단일 Provider 검색 성능 테스트');
    const testQuery = '회귀 테스트';
    const iterations = 5;
    const searchTimes: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const startTime = process.hrtime.bigint();

      const searchResult = await services.hybridSearchEngine.search(testDb, {
        query: testQuery,
        limit: 10
      });

      const endTime = process.hrtime.bigint();
      const searchTime = Number(endTime - startTime) / 1_000_000; // ms
      searchTimes.push(searchTime);

      if (i === 0) {
        console.log(`   첫 검색 결과: ${searchResult.items.length}개 항목, ${searchTime.toFixed(2)}ms`);
      }
    }

    const avgSearchTime = searchTimes.reduce((sum, t) => sum + t, 0) / searchTimes.length;
    const maxSearchTime = Math.max(...searchTimes);

    console.log(`   평균 검색 시간: ${avgSearchTime.toFixed(2)}ms`);
    console.log(`   최대 검색 시간: ${maxSearchTime.toFixed(2)}ms`);

    // 성능 기준: 단일 provider 환경에서 평균 500ms 이하
    const performanceThreshold = 500; // ms
    const performancePassed = avgSearchTime <= performanceThreshold;

    results.push({
      test_name: '단일 Provider 검색 성능',
      passed: performancePassed,
      message: performancePassed
        ? `평균 검색 시간 ${avgSearchTime.toFixed(2)}ms가 기준(${performanceThreshold}ms) 이하입니다.`
        : `평균 검색 시간 ${avgSearchTime.toFixed(2)}ms가 기준(${performanceThreshold}ms)을 초과합니다.`,
      performance_metrics: {
        search_time_ms: avgSearchTime,
        result_count: memoryCount
      }
    });

    if (performancePassed) {
      console.log(`   ✅ 성능 기준 통과 (${avgSearchTime.toFixed(2)}ms <= ${performanceThreshold}ms)\n`);
    } else {
      console.log(`   ❌ 성능 기준 실패 (${avgSearchTime.toFixed(2)}ms > ${performanceThreshold}ms)\n`);
    }

    // 5. recall 도구 동작 확인 (단일 provider 환경)
    console.log('5️⃣ recall 도구 동작 확인 (단일 provider 환경)');
    const recallResult = await executeTool('recall', {
      query: testQuery,
      limit: 10
    }, context);

    if (!recallResult || !recallResult.content) {
      results.push({
        test_name: 'recall 도구 동작',
        passed: false,
        message: 'recall 도구가 정상적으로 동작하지 않습니다.'
      });
      console.log('   ❌ recall 도구 동작 실패\n');
    } else {
      try {
        const recallData = JSON.parse(recallResult.content[0].text);
        const itemCount = recallData.items?.length || 0;

        results.push({
          test_name: 'recall 도구 동작',
          passed: itemCount > 0,
          message: `recall 도구가 정상 동작합니다. (${itemCount}개 결과)`
        });

        if (itemCount > 0) {
          console.log(`   ✅ recall 도구 정상 동작 (${itemCount}개 결과)\n`);
        } else {
          console.log(`   ⚠️ recall 도구는 동작하지만 결과가 없습니다.\n`);
        }
      } catch (e) {
        results.push({
          test_name: 'recall 도구 동작',
          passed: false,
          message: 'recall 결과 파싱 실패'
        });
        console.log('   ❌ recall 결과 파싱 실패\n');
      }
    }

    // 6. 다중 provider 감지 기능이 단일 provider 환경에서 올바르게 동작하는지 확인
    console.log('6️⃣ 다중 Provider 감지 기능 확인 (단일 provider 환경)');
    const detectedProviders = await (services.hybridSearchEngine as any).detectAllStoredEmbeddingProviders(testDb);
    const providerCount = detectedProviders.length;
    const expectedProviderCount = 1; // 단일 provider 환경이므로 1개여야 함

    const detectionPassed = providerCount === expectedProviderCount;

    results.push({
      test_name: '다중 Provider 감지 (단일 provider 환경)',
      passed: detectionPassed,
      message: detectionPassed
        ? `감지된 provider 수가 올바릅니다. (${providerCount}개)`
        : `감지된 provider 수가 예상과 다릅니다. (예상: ${expectedProviderCount}개, 실제: ${providerCount}개)`
    });

    if (detectionPassed) {
      console.log(`   ✅ Provider 감지 정상 (${providerCount}개 provider 감지)\n`);
    } else {
      console.log(`   ❌ Provider 감지 실패 (예상: ${expectedProviderCount}개, 실제: ${providerCount}개)\n`);
    }

    // 7. 결과 리포트
    console.log('📊 회귀 테스트 결과 리포트\n');
    console.log('='.repeat(80));

    let passedCount = 0;
    let failedCount = 0;

    for (const result of results) {
      const status = result.passed ? '✅' : '❌';
      console.log(`${status} ${result.test_name}`);
      console.log(`   ${result.message}`);
      if (result.performance_metrics) {
        console.log(`   성능 지표: 평균 ${result.performance_metrics.search_time_ms.toFixed(2)}ms, 결과 ${result.performance_metrics.result_count}개`);
      }
      console.log();

      if (result.passed) {
        passedCount++;
      } else {
        failedCount++;
      }
    }

    console.log('='.repeat(80));
    console.log(`\n총 ${results.length}개 테스트: ${passedCount}개 통과, ${failedCount}개 실패\n`);

    if (failedCount === 0) {
      console.log('✅ 모든 회귀 테스트 통과!\n');
      process.exit(0);
    } else {
      console.log('❌ 일부 회귀 테스트 실패\n');
      process.exit(1);
    }

  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    console.error('❌ 회귀 테스트 실행 실패:', maskedError.message);
    process.exit(1);
  } finally {
    if (testDb) {
      testDb.close();
    }
  }
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('test-single-provider-regression')) {
  testSingleProviderRegression();
}

export { testSingleProviderRegression };

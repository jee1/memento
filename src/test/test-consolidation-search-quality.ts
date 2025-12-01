/**
 * Consolidation Score 반영 후 검색 품질 검증 E2E 테스트
 * 실제 데이터로 검색 품질 측정 및 Consolidation 점수 반영 전/후 비교
 */

import { createMementoClient } from '../client/index.js';
import {
  initializeTestDatabase,
  seedTestDatabase,
  cleanupTestDatabase,
  type TestMemoryItem
} from './helpers/consolidation-test-data.js';
import {
  calculatePrecisionAtK,
  calculateRecallAtK,
  calculateNDCGAtK,
  type SearchResult,
  type GroundTruth
} from './helpers/search-quality-metrics.js';
import Database from 'better-sqlite3';
import { mementoConfig } from '../shared/config/index.js';

interface QualityComparison {
  withConsolidation: {
    precision: number;
    recall: number;
    ndcg: number;
  };
  withoutConsolidation: {
    precision: number;
    recall: number;
    ndcg: number;
  };
  improvement: {
    precision: number;
    recall: number;
    ndcg: number;
  };
}

/**
 * Ground Truth 생성 (테스트용)
 * 실제로는 사용자 피드백이나 전문가 평가를 통해 생성
 */
function generateGroundTruth(memoryIds: string[]): Map<string, GroundTruth> {
  const groundTruths = new Map<string, GroundTruth>();
  
  // 예시: 각 쿼리마다 관련 결과 ID 목록 정의
  const queries = [
    { query: 'React', relevantIds: memoryIds.filter((_, i) => i % 3 === 0) },
    { query: 'TypeScript', relevantIds: memoryIds.filter((_, i) => i % 3 === 1) },
    { query: 'database', relevantIds: memoryIds.filter((_, i) => i % 3 === 2) }
  ];

  queries.forEach(({ query, relevantIds }) => {
    groundTruths.set(query, {
      queryId: query,
      relevantIds: relevantIds.slice(0, 3) // 상위 3개만 관련 결과로 간주
    });
  });

  return groundTruths;
}

/**
 * 검색 결과를 SearchResult 형식으로 변환
 */
function convertToSearchResults(items: any[]): SearchResult[] {
  return items.map(item => ({
    id: item.id,
    score: item.score,
    finalScore: item.finalScore || item.score,
    relevance: item.score || 0
  }));
}

/**
 * 검색 품질 측정
 */
async function measureSearchQuality(
  client: any,
  queries: string[],
  groundTruths: Map<string, GroundTruth>,
  k: number = 5
): Promise<{ precision: number; recall: number; ndcg: number }> {
  const queryResults = new Map<string, SearchResult[]>();
  
  for (const query of queries) {
    try {
      const results = await client.recall({ query, limit: k * 2 });
      const searchResults = convertToSearchResults(results);
      queryResults.set(query, searchResults);
    } catch (error) {
      console.error(`검색 실패: ${query}`, error);
      queryResults.set(query, []);
    }
  }

  let totalPrecision = 0;
  let totalRecall = 0;
  let totalNDCG = 0;
  let count = 0;

  queries.forEach(query => {
    const results = queryResults.get(query) || [];
    const groundTruth = groundTruths.get(query);
    
    if (groundTruth) {
      const precision = calculatePrecisionAtK(results, groundTruth.relevantIds, k);
      const recall = calculateRecallAtK(results, groundTruth.relevantIds, k);
      const ndcg = calculateNDCGAtK(results, groundTruth.relevantIds, k);
      
      totalPrecision += precision;
      totalRecall += recall;
      totalNDCG += ndcg;
      count++;
    }
  });

  return {
    precision: count > 0 ? totalPrecision / count : 0,
    recall: count > 0 ? totalRecall / count : 0,
    ndcg: count > 0 ? totalNDCG / count : 0
  };
}

/**
 * Consolidation 점수 반영 전/후 비교
 */
async function compareWithAndWithoutConsolidation(
  db: Database.Database,
  queries: string[],
  groundTruths: Map<string, GroundTruth>
): Promise<QualityComparison> {
  const client = createMementoClient();
  
  try {
    await client.connect();

    // 1. Consolidation Score 활성화 상태에서 측정
    const originalEnabled = mementoConfig.consolidationScoreEnabled;
    mementoConfig.consolidationScoreEnabled = true;
    
    const withConsolidation = await measureSearchQuality(client, queries, groundTruths);

    // 2. Consolidation Score 비활성화 상태에서 측정
    mementoConfig.consolidationScoreEnabled = false;
    
    const withoutConsolidation = await measureSearchQuality(client, queries, groundTruths);

    // 원래 상태로 복원
    mementoConfig.consolidationScoreEnabled = originalEnabled;

    // 3. 개선도 계산
    const improvement = {
      precision: withConsolidation.precision - withoutConsolidation.precision,
      recall: withConsolidation.recall - withoutConsolidation.recall,
      ndcg: withConsolidation.ndcg - withoutConsolidation.ndcg
    };

    return {
      withConsolidation,
      withoutConsolidation,
      improvement
    };
  } finally {
    await client.disconnect();
  }
}

/**
 * 랭킹 순서 정확성 검증
 */
function verifyRankingOrder(
  results: SearchResult[],
  expectedOrder: string[]
): { accuracy: number; correctPositions: number; totalPositions: number } {
  const minLength = Math.min(results.length, expectedOrder.length);
  let correctPositions = 0;

  for (let i = 0; i < minLength; i++) {
    if (results[i].id === expectedOrder[i]) {
      correctPositions++;
    }
  }

  return {
    accuracy: expectedOrder.length > 0 ? correctPositions / expectedOrder.length : 0,
    correctPositions,
    totalPositions: expectedOrder.length
  };
}

/**
 * 메인 테스트 함수
 */
async function testConsolidationSearchQuality() {
  console.log('🔍 Consolidation Score 검색 품질 검증 E2E 테스트 시작\n');

  const db = new Database(':memory:');
  
  try {
    // 1. 테스트 데이터 준비
    console.log('1️⃣ 테스트 데이터 준비 중...');
    const { memoryIds, items } = seedTestDatabase(db, 20, false);
    console.log(`✅ ${memoryIds.length}개의 메모리 아이템 생성 완료\n`);

    // 2. Ground Truth 생성
    console.log('2️⃣ Ground Truth 생성 중...');
    const queries = ['React', 'TypeScript', 'database'];
    const groundTruths = generateGroundTruth(memoryIds);
    console.log(`✅ ${queries.length}개의 쿼리에 대한 Ground Truth 생성 완료\n`);

    // 3. Consolidation 점수 반영 전/후 비교
    console.log('3️⃣ Consolidation 점수 반영 전/후 품질 비교 중...');
    const comparison = await compareWithAndWithoutConsolidation(db, queries, groundTruths);
    
    console.log('📊 품질 비교 결과:');
    console.log('  Consolidation 활성화:');
    console.log(`    Precision@5: ${comparison.withConsolidation.precision.toFixed(3)}`);
    console.log(`    Recall@5: ${comparison.withConsolidation.recall.toFixed(3)}`);
    console.log(`    NDCG@5: ${comparison.withConsolidation.ndcg.toFixed(3)}`);
    console.log('  Consolidation 비활성화:');
    console.log(`    Precision@5: ${comparison.withoutConsolidation.precision.toFixed(3)}`);
    console.log(`    Recall@5: ${comparison.withoutConsolidation.recall.toFixed(3)}`);
    console.log(`    NDCG@5: ${comparison.withoutConsolidation.ndcg.toFixed(3)}`);
    console.log('  개선도:');
    console.log(`    Precision: ${comparison.improvement.precision > 0 ? '+' : ''}${comparison.improvement.precision.toFixed(3)}`);
    console.log(`    Recall: ${comparison.improvement.recall > 0 ? '+' : ''}${comparison.improvement.recall.toFixed(3)}`);
    console.log(`    NDCG: ${comparison.improvement.ndcg > 0 ? '+' : ''}${comparison.improvement.ndcg.toFixed(3)}\n`);

    // 4. 랭킹 순서 정확성 검증
    console.log('4️⃣ 랭킹 순서 정확성 검증 중...');
    const client = createMementoClient();
    await client.connect();
    
    try {
      const results = await client.recall({ query: queries[0], limit: 10 });
      const searchResults = convertToSearchResults(results);
      
      // 예상 순서: consolidation_score가 높은 순서
      const expectedOrder = items
        .filter(item => item.consolidation_score !== undefined)
        .sort((a, b) => (b.consolidation_score || 0) - (a.consolidation_score || 0))
        .map(item => item.id)
        .slice(0, 10);

      const rankingAccuracy = verifyRankingOrder(searchResults, expectedOrder);
      console.log(`  랭킹 정확도: ${rankingAccuracy.accuracy.toFixed(3)}`);
      console.log(`  정확한 위치: ${rankingAccuracy.correctPositions}/${rankingAccuracy.totalPositions}\n`);
    } finally {
      await client.disconnect();
    }

    console.log('✅ Consolidation Score 검색 품질 검증 완료!');
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
    throw error;
  } finally {
    cleanupTestDatabase(db);
    db.close();
  }
}

// 테스트 실행
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('test-consolidation-search-quality.ts')) {
  testConsolidationSearchQuality()
    .then(() => {
      console.log('✅ E2E 테스트 완료');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ E2E 테스트 실패:', error);
      process.exit(1);
    });
}

export { testConsolidationSearchQuality, compareWithAndWithoutConsolidation };


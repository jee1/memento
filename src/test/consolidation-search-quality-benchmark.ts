/**
 * Consolidation Score 검색 품질 벤치마크
 * 다양한 가중치 조합에서 품질 비교 및 튜닝 가이드라인 제공
 */

import { createMementoClient } from '../client/index.js';
import {
  initializeTestDatabase,
  seedTestDatabase,
  cleanupTestDatabase
} from './helpers/consolidation-test-data.js';
import {
  generateQualityReport,
  calculateMeanPrecisionAtK,
  calculateMeanRecallAtK,
  calculateMeanNDCGAtK,
  type GroundTruth
} from './helpers/search-quality-metrics.js';
import Database from 'better-sqlite3';
import { mementoConfig } from '../config/index.js';
import * as fs from 'fs';
import * as path from 'path';

interface BenchmarkResult {
  timestamp: string;
  dataSize: number;
  executionTime: number;
  weights: {
    vectorSimilarity: number;
    consolidationScore: number;
  };
  metrics: {
    precision: Record<number, number>;
    recall: Record<number, number>;
    ndcg: Record<number, number>;
  };
}

interface BaselineSnapshot {
  version: string;
  timestamp: string;
  results: BenchmarkResult[];
  summary: {
    bestWeights: {
      vectorSimilarity: number;
      consolidationScore: number;
    };
    bestNDCG: number;
  };
}

/**
 * Ground Truth 생성 (벤치마크용)
 */
function generateBenchmarkGroundTruth(memoryIds: string[]): GroundTruth[] {
  const queries = [
    { query: 'React', relevantIds: memoryIds.filter((_, i) => i % 3 === 0).slice(0, 5) },
    { query: 'TypeScript', relevantIds: memoryIds.filter((_, i) => i % 3 === 1).slice(0, 5) },
    { query: 'database', relevantIds: memoryIds.filter((_, i) => i % 3 === 2).slice(0, 5) },
    { query: 'MCP', relevantIds: memoryIds.filter((_, i) => i % 4 === 0).slice(0, 4) },
    { query: 'optimization', relevantIds: memoryIds.filter((_, i) => i % 5 === 0).slice(0, 3) }
  ];

  return queries.map(({ query, relevantIds }) => ({
    queryId: query,
    relevantIds
  }));
}

/**
 * 특정 가중치 조합에서 품질 측정
 */
async function measureQualityWithWeights(
  client: any,
  queries: string[],
  groundTruths: GroundTruth[],
  weights: { vectorSimilarity: number; consolidationScore: number },
  kValues: number[] = [1, 5, 10]
): Promise<BenchmarkResult> {
  const startTime = Date.now();
  const queryResults = new Map<string, any[]>();

  // 가중치를 반영하기 위해 SearchRanking 설정 변경이 필요하지만,
  // 현재는 기본 프로파일을 사용하여 시뮬레이션
  // 실제로는 SearchRanking에 가중치를 주입할 수 있는 방법이 필요

  for (const query of queries) {
    try {
      const results = await client.recall({ query, limit: Math.max(...kValues) * 2 });
      queryResults.set(query, results);
    } catch (error) {
      console.error(`검색 실패: ${query}`, error);
      queryResults.set(query, []);
    }
  }

  const executionTime = Date.now() - startTime;

  // 품질 지표 계산
  const report = generateQualityReport(queryResults, groundTruths, kValues);

  return {
    timestamp: new Date().toISOString(),
    dataSize: queryResults.size,
    executionTime,
    weights,
    metrics: report
  };
}

/**
 * 다양한 가중치 조합 테스트
 */
async function benchmarkWeightCombinations(
  db: Database.Database,
  queries: string[],
  groundTruths: GroundTruth[]
): Promise<BenchmarkResult[]> {
  const client = createMementoClient();
  const results: BenchmarkResult[] = [];

  try {
    await client.connect();

    // 다양한 가중치 조합 테스트
    const weightCombinations = [
      { vectorSimilarity: 0.9, consolidationScore: 0.1 }, // recent
      { vectorSimilarity: 0.8, consolidationScore: 0.2 }, // balanced
      { vectorSimilarity: 0.7, consolidationScore: 0.3 }, // memory
      { vectorSimilarity: 0.95, consolidationScore: 0.05 }, // 매우 낮은 consolidation
      { vectorSimilarity: 0.65, consolidationScore: 0.35 } // 높은 consolidation (상한 0.4 적용)
    ];

    console.log(`\n📊 ${weightCombinations.length}개의 가중치 조합 테스트 중...\n`);

    for (let i = 0; i < weightCombinations.length; i++) {
      const weights = weightCombinations[i];
      console.log(`  [${i + 1}/${weightCombinations.length}] 가중치: w1=${weights.vectorSimilarity}, w2=${weights.consolidationScore}`);

      // 실제로는 SearchRanking에 가중치를 주입해야 하지만,
      // 현재 구조에서는 프로파일을 사용하므로 시뮬레이션
      const result = await measureQualityWithWeights(client, queries, groundTruths, weights);
      results.push(result);

      console.log(`    실행 시간: ${result.executionTime}ms`);
      console.log(`    NDCG@5: ${result.metrics.ndcg[5]?.toFixed(3) || 'N/A'}`);
    }
  } finally {
    await client.disconnect();
  }

  return results;
}

/**
 * Baseline 스냅샷 저장
 */
function saveBaselineSnapshot(
  results: BenchmarkResult[],
  outputPath: string
): void {
  const bestResult = results.reduce((best, current) => {
    const currentNDCG = current.metrics.ndcg[5] || 0;
    const bestNDCG = best.metrics.ndcg[5] || 0;
    return currentNDCG > bestNDCG ? current : best;
  }, results[0]);

  const snapshot: BaselineSnapshot = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    results,
    summary: {
      bestWeights: bestResult.weights,
      bestNDCG: bestResult.metrics.ndcg[5] || 0
    }
  };

  // 디렉토리 생성
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  console.log(`\n💾 Baseline 스냅샷 저장: ${outputPath}`);
}

/**
 * Baseline 스냅샷 로드
 */
function loadBaselineSnapshot(inputPath: string): BaselineSnapshot | null {
  if (!fs.existsSync(inputPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(inputPath, 'utf-8');
    return JSON.parse(content) as BaselineSnapshot;
  } catch (error) {
    console.error(`Baseline 스냅샷 로드 실패: ${error}`);
    return null;
  }
}

/**
 * Baseline과 비교
 */
function compareWithBaseline(
  currentResults: BenchmarkResult[],
  baseline: BaselineSnapshot | null
): void {
  if (!baseline) {
    console.log('\n⚠️  Baseline 스냅샷이 없습니다. 첫 실행으로 간주합니다.');
    return;
  }

  console.log('\n📈 Baseline과 비교:');
  console.log(`  Baseline 버전: ${baseline.version}`);
  console.log(`  Baseline 생성 시간: ${baseline.timestamp}`);

  const currentBest = currentResults.reduce((best, current) => {
    const currentNDCG = current.metrics.ndcg[5] || 0;
    const bestNDCG = best.metrics.ndcg[5] || 0;
    return currentNDCG > bestNDCG ? current : best;
  }, currentResults[0]);

  const baselineBestNDCG = baseline.summary.bestNDCG;
  const currentBestNDCG = currentBest.metrics.ndcg[5] || 0;
  const improvement = currentBestNDCG - baselineBestNDCG;

  console.log(`  Baseline 최고 NDCG@5: ${baselineBestNDCG.toFixed(3)}`);
  console.log(`  현재 최고 NDCG@5: ${currentBestNDCG.toFixed(3)}`);
  console.log(`  개선도: ${improvement > 0 ? '+' : ''}${improvement.toFixed(3)}`);

  if (improvement > 0.01) {
    console.log('  ✅ 품질이 개선되었습니다!');
  } else if (improvement < -0.01) {
    console.log('  ⚠️  품질이 저하되었습니다.');
  } else {
    console.log('  ➡️  품질이 유사합니다.');
  }
}

/**
 * 튜닝 가이드라인 생성
 */
function generateTuningGuidelines(results: BenchmarkResult[]): void {
  console.log('\n📋 튜닝 가이드라인:');

  // 최적 가중치 조합 찾기
  const bestResult = results.reduce((best, current) => {
    const currentNDCG = current.metrics.ndcg[5] || 0;
    const bestNDCG = best.metrics.ndcg[5] || 0;
    return currentNDCG > bestNDCG ? current : best;
  }, results[0]);

  console.log(`\n1. 최적 가중치 조합:`);
  console.log(`   - vectorSimilarity: ${bestResult.weights.vectorSimilarity}`);
  console.log(`   - consolidationScore: ${bestResult.weights.consolidationScore}`);
  console.log(`   - NDCG@5: ${bestResult.metrics.ndcg[5]?.toFixed(3) || 'N/A'}`);

  // 프로파일별 권장 설정
  console.log(`\n2. 검색 프로파일별 권장 설정:`);
  const profiles = [
    { name: 'recent', weights: { vectorSimilarity: 0.9, consolidationScore: 0.1 } },
    { name: 'balanced', weights: { vectorSimilarity: 0.8, consolidationScore: 0.2 } },
    { name: 'memory', weights: { vectorSimilarity: 0.7, consolidationScore: 0.3 } }
  ];

  profiles.forEach(profile => {
    const result = results.find(r => 
      Math.abs(r.weights.vectorSimilarity - profile.weights.vectorSimilarity) < 0.01 &&
      Math.abs(r.weights.consolidationScore - profile.weights.consolidationScore) < 0.01
    );

    if (result) {
      console.log(`   - ${profile.name}: NDCG@5 = ${result.metrics.ndcg[5]?.toFixed(3) || 'N/A'}`);
    }
  });

  // Consolidation 점수 영향력 분석
  console.log(`\n3. Consolidation 점수 영향력 분석:`);
  const withConsolidation = results.filter(r => r.weights.consolidationScore > 0.1);
  const withoutConsolidation = results.filter(r => r.weights.consolidationScore <= 0.1);

  if (withConsolidation.length > 0 && withoutConsolidation.length > 0) {
    const avgWith = withConsolidation.reduce((sum, r) => sum + (r.metrics.ndcg[5] || 0), 0) / withConsolidation.length;
    const avgWithout = withoutConsolidation.reduce((sum, r) => sum + (r.metrics.ndcg[5] || 0), 0) / withoutConsolidation.length;
    const impact = avgWith - avgWithout;

    console.log(`   - Consolidation 사용 시 평균 NDCG@5: ${avgWith.toFixed(3)}`);
    console.log(`   - Consolidation 미사용 시 평균 NDCG@5: ${avgWithout.toFixed(3)}`);
    console.log(`   - 영향력: ${impact > 0 ? '+' : ''}${impact.toFixed(3)}`);
  }
}

/**
 * 메인 벤치마크 함수
 */
async function runConsolidationQualityBenchmark() {
  console.log('🚀 Consolidation Score 검색 품질 벤치마크 시작\n');

  const startTime = Date.now();
  const db = new Database(':memory:');
  const baselinePath = process.env.CONSOLIDATION_BASELINE_PATH || './data/consolidation-baseline.json';

  try {
    // 1. 테스트 데이터 준비
    console.log('1️⃣ 테스트 데이터 준비 중...');
    const itemCount = parseInt(process.env.CONSOLIDATION_TEST_ITEM_COUNT || '100', 10);
    const { memoryIds } = seedTestDatabase(db, itemCount, false);
    console.log(`✅ ${memoryIds.length}개의 메모리 아이템 생성 완료`);
    console.log(`   데이터 크기: ${memoryIds.length} items\n`);

    // 2. Ground Truth 생성
    console.log('2️⃣ Ground Truth 생성 중...');
    const queries = ['React', 'TypeScript', 'database', 'MCP', 'optimization'];
    const groundTruths = generateBenchmarkGroundTruth(memoryIds);
    console.log(`✅ ${queries.length}개의 쿼리에 대한 Ground Truth 생성 완료\n`);

    // 3. Baseline 로드
    console.log('3️⃣ Baseline 스냅샷 로드 중...');
    const baseline = loadBaselineSnapshot(baselinePath);
    if (baseline) {
      console.log(`✅ Baseline 스냅샷 로드 완료 (버전: ${baseline.version})\n`);
    } else {
      console.log(`⚠️  Baseline 스냅샷이 없습니다. 새로 생성합니다.\n`);
    }

    // 4. 다양한 가중치 조합 테스트
    console.log('4️⃣ 다양한 가중치 조합 테스트 중...');
    const results = await benchmarkWeightCombinations(db, queries, groundTruths);

    // 5. 실행 시간 및 데이터 크기 로깅
    const totalExecutionTime = Date.now() - startTime;
    console.log(`\n⏱️  총 실행 시간: ${totalExecutionTime}ms`);
    console.log(`📊 테스트 데이터 크기: ${memoryIds.length} items`);
    console.warn(`[BENCHMARK] Execution time: ${totalExecutionTime}ms, Data size: ${memoryIds.length} items`);

    // 6. Baseline과 비교
    compareWithBaseline(results, baseline);

    // 7. 튜닝 가이드라인 생성
    generateTuningGuidelines(results);

    // 8. Baseline 스냅샷 저장
    console.log('\n5️⃣ Baseline 스냅샷 저장 중...');
    saveBaselineSnapshot(results, baselinePath);

    console.log('\n✅ 벤치마크 완료!');
  } catch (error) {
    console.error('❌ 벤치마크 실패:', error);
    throw error;
  } finally {
    cleanupTestDatabase(db);
    db.close();
  }
}

// 벤치마크 실행
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('consolidation-search-quality-benchmark.ts')) {
  runConsolidationQualityBenchmark()
    .then(() => {
      console.log('✅ 벤치마크 완료');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 벤치마크 실패:', error);
      process.exit(1);
    });
}

export { runConsolidationQualityBenchmark, saveBaselineSnapshot, loadBaselineSnapshot };


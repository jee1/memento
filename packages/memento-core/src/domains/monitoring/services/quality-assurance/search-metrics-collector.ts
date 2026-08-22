import Database from 'better-sqlite3';
import { logger } from '../../../../shared/utils/logger.js';
import {
  calculatePrecisionAtK,
  calculateRecallAtK,
  calculateNDCGAtK,
  type SearchResult,
  type GroundTruth,
} from './search-quality-metrics.js';
import {
  calculateKendallTau,
  loadGroundTruth,
  generateVectorOnlySearchResults,
  generateConsolidationSearchResults,
} from './vector-search-quality-metrics.js';
import {
  loadBenchmarkManifest,
  assertStrictBenchmark,
  buildBenchmarkQueryLookup,
  loadBenchmarkCorpus,
  loadBenchmarkQueries,
} from './search-quality-benchmark-fixtures.js';
import {
  normalizeBenchmarkGroundTruths,
  verifyReviewableBenchmark,
} from './search-quality-review-verifier.js';
import { HybridSearchFactory } from '../../../search/factories/hybrid-search.factory.js';
import type { HybridSearchResult } from '../../../search/algorithms/hybrid-search-engine.js';
import type { CollectedMetrics, SearchMetricsOptions } from './quality-metrics-types.js';

export function calculateMRR(
  queryResults: Map<string, SearchResult[]>,
  groundTruths: GroundTruth[]
): number {
  if (groundTruths.length === 0) return 0;

  let sumReciprocalRank = 0;
  let validQueries = 0;

  for (const groundTruth of groundTruths) {
    const results = queryResults.get(groundTruth.queryId);
    if (!results || results.length === 0) continue;

    const relevantSet = new Set(groundTruth.relevantIds);
    let firstRelevantRank = -1;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result && relevantSet.has(result.id)) {
        firstRelevantRank = i + 1; // 1-based rank
        break;
      }
    }

    if (firstRelevantRank > 0) {
      sumReciprocalRank += 1 / firstRelevantRank;
      validQueries++;
    }
  }

  return validQueries > 0 ? sumReciprocalRank / groundTruths.length : 0;
}

export class SearchMetricsCollector {
  constructor(private db: Database.Database) {}

  async collect(
    context: string = 'default',
    options?: SearchMetricsOptions
  ): Promise<CollectedMetrics> {
    const metrics: Record<string, number> = {};

    let groundTruths = options?.groundTruths;
    let memoryIdToBenchmarkId: Map<string, string> | undefined;
    let queryIdToQueryText: Map<string, string> | undefined;
    if (options?.strictBenchmark && !options.benchmarkDir) {
      throw new Error('Strict benchmark mode requires benchmarkDir');
    }
    if (options?.benchmarkDir) {
      const manifest = loadBenchmarkManifest(options.benchmarkDir);
      if (options.strictBenchmark) {
        assertStrictBenchmark(manifest);
        const verification = verifyReviewableBenchmark(options.benchmarkDir, { requireReviewed: true });
        if (!verification.ok) {
          throw new Error(`Strict benchmark verification failed: ${verification.errors.join('; ')}`);
        }
      }
      groundTruths = normalizeBenchmarkGroundTruths(options.benchmarkDir);
      try {
        const corpus = loadBenchmarkCorpus(options.benchmarkDir);
        memoryIdToBenchmarkId = new Map(corpus.map((e) => [e.source_memory_id, e.benchmark_id]));
      } catch (error) {
        throw new Error(
          `Benchmark corpus load failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      const queries = loadBenchmarkQueries(options.benchmarkDir);
      queryIdToQueryText = new Map(
        [...buildBenchmarkQueryLookup(queries).byId.entries()].map(([queryId, query]) => [queryId, query.query])
      );
    }

    if (options?.strictBenchmark && (!groundTruths || groundTruths.length === 0)) {
      throw new Error('Strict benchmark mode requires human-labeled ground truth');
    }

    // Ground Truth 자동 로드 (옵션에 없고 benchmarkDir도 없으면 파일에서 로드 시도)
    if (!groundTruths || groundTruths.length === 0) {
      try {
        const loaded = loadGroundTruth();
        if (loaded && loaded.length > 0) {
          groundTruths = loaded;
          logger.info('Ground Truth 자동 로드 완료', {
            context,
            count: groundTruths.length
          });
        }
      } catch (error) {
        logger.warn('Ground Truth 파일 로드 실패', {
          context,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // 검색 결과 자동 생성 (옵션에 없고 Ground Truth가 있으면 실제 검색 수행, 병렬로 한 번만)
    let queryResults = options?.queryResults;
    const fullResultsByQuery = new Map<string, { items: HybridSearchResult[] }>();

    if (queryResults) {
      queryResults = new Map(
        [...queryResults.entries()].map(([queryId, results]) => [
          queryIdToQueryText?.get(queryId) ?? queryId,
          results.map((result) => ({
            ...result,
            id: memoryIdToBenchmarkId?.get(result.id) ?? result.id,
          })),
        ])
      );
    }

    if (!queryResults && groundTruths && groundTruths.length > 0) {
      try {
        queryResults = new Map<string, SearchResult[]>();
        const searchEngine = HybridSearchFactory.createDefaultEngine(this.db);

        const searchPromises = groundTruths.map(async (groundTruth) => {
          try {
            const searchResult = await searchEngine.search(this.db, { query: groundTruth.queryId, limit: 20 });
            return { queryId: groundTruth.queryId, searchResult };
          } catch (error) {
            logger.warn('검색 수행 실패', { context, query: groundTruth.queryId, error: error instanceof Error ? error.message : String(error) });
            return { queryId: groundTruth.queryId, searchResult: { items: [] } };
          }
        });
        const resolved = await Promise.all(searchPromises);

        for (const { queryId, searchResult } of resolved) {
          const mapped = searchResult.items.map((item) => {
            const id = memoryIdToBenchmarkId?.get(item.id) ?? item.id;
            return { id, score: item.finalScore };
          });
          queryResults.set(queryId, mapped);
          fullResultsByQuery.set(queryId, searchResult);
        }

        logger.info('검색 결과 자동 생성 완료', { context, queryCount: queryResults.size });
      } catch (error) {
        logger.warn('검색 엔진 초기화 또는 검색 수행 실패', {
          context,
          error: error instanceof Error ? error.message : String(error)
        });
        queryResults = new Map<string, SearchResult[]>();
      }
    }

    // Ground Truth와 검색 결과가 제공된 경우 실제 측정 수행
    if (groundTruths && queryResults && groundTruths.length > 0) {
      // groundTruths와 queryResults는 위에서 로드/생성됨

      // Precision@K, Recall@K, NDCG@K 계산
      const kValues = [5, 10];
      for (const k of kValues) {
        let sumPrecision = 0;
        let sumRecall = 0;
        let sumNDCG = 0;
        let validQueries = 0;

        for (const groundTruth of groundTruths) {
          const results = queryResults.get(groundTruth.queryId);
          if (!results || results.length === 0) continue;

          const precision = calculatePrecisionAtK(results, groundTruth.relevantIds, k);
          const recall = calculateRecallAtK(results, groundTruth.relevantIds, k);
          const ndcg = calculateNDCGAtK(results, groundTruth.relevantIds, k);

          sumPrecision += precision;
          sumRecall += recall;
          sumNDCG += ndcg;
          validQueries++;
        }

        if (validQueries > 0) {
          metrics[`precision_at_${k}`] = sumPrecision / validQueries;
          metrics[`recall_at_${k}`] = sumRecall / validQueries;
          metrics[`ndcg_at_${k}`] = sumNDCG / validQueries;
        } else {
          metrics[`precision_at_${k}`] = 0;
          metrics[`recall_at_${k}`] = 0;
          metrics[`ndcg_at_${k}`] = 0;
        }
      }

      // MRR 계산
      metrics.mrr = calculateMRR(queryResults, groundTruths);

      // searchResultPairs 자동 생성 (제공되지 않은 경우, fullResultsByQuery 재사용)
      let searchResultPairs = options?.searchResultPairs;
      if (!searchResultPairs || searchResultPairs.length === 0) {
        try {
          searchResultPairs = [];

          for (const groundTruth of groundTruths) {
            let items: HybridSearchResult[] = fullResultsByQuery.get(groundTruth.queryId)?.items ?? [];
            if (items.length === 0) {
              const searchEngine = HybridSearchFactory.createDefaultEngine(this.db);
              const sr = await searchEngine.search(this.db, { query: groundTruth.queryId, limit: 20 });
              items = sr.items;
            }
            try {
              const vectorOnlyResults = generateVectorOnlySearchResults(items, 20);
              const consolidationResults = generateConsolidationSearchResults(items, 20);

              if (vectorOnlyResults.length >= 2 && consolidationResults.length >= 2) {
                searchResultPairs.push({
                  vectorOnly: vectorOnlyResults,
                  withConsolidation: consolidationResults
                });
              } else {
                logger.warn('검색 결과 쌍 생성 실패: 결과 부족', {
                  context,
                  query: groundTruth.queryId,
                  searchResultCount: items.length,
                  vectorOnlyCount: vectorOnlyResults.length,
                  consolidationCount: consolidationResults.length,
                  reason: vectorOnlyResults.length < 2
                    ? 'vectorOnlyResults 부족'
                    : consolidationResults.length < 2
                      ? 'consolidationResults 부족'
                      : '알 수 없음'
                });
              }

              logger.debug('검색 결과 쌍 생성 완료', {
                context,
                query: groundTruth.queryId,
                searchResultCount: items.length,
                vectorOnlyCount: vectorOnlyResults.length,
                consolidationCount: consolidationResults.length,
                added: vectorOnlyResults.length >= 2 && consolidationResults.length >= 2
              });
            } catch (error) {
              logger.warn('검색 결과 쌍 생성 실패', {
                context,
                query: groundTruth.queryId,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }

          if (searchResultPairs.length === 0) {
            logger.warn('검색 결과 쌍이 생성되지 않았습니다', {
              context,
              groundTruthCount: groundTruths.length,
              reason: '검색 결과가 부족하거나 vectorScore/finalScore가 없을 수 있습니다'
            });
          } else {
            logger.info('검색 결과 쌍 자동 생성 완료', {
              context,
              pairCount: searchResultPairs.length,
              groundTruthCount: groundTruths.length
            });
          }
        } catch (error) {
          logger.warn('검색 결과 쌍 자동 생성 실패', {
            context,
            error: error instanceof Error ? error.message : String(error)
          });
          searchResultPairs = [];
        }
      }

      // Kendall's Tau 및 순서 보존 지표 계산
      if (searchResultPairs && searchResultPairs.length > 0) {
        let sumKendallTau = 0;
        let sumTop5Retention = 0;
        let sumTop10Retention = 0;
        let validPairs = 0;

        for (const pair of searchResultPairs) {
          const vectorIds = pair.vectorOnly.map(r => r.id);
          const consolidationIds = pair.withConsolidation.map(r => r.id);
          
          const kendallTau = calculateKendallTau(vectorIds, consolidationIds);
          sumKendallTau += kendallTau;

          // Top-K 유지율 계산
          const top5Vector = new Set(vectorIds.slice(0, 5));
          const top10Vector = new Set(vectorIds.slice(0, 10));
          const top5Consolidation = new Set(consolidationIds.slice(0, 5));
          const top10Consolidation = new Set(consolidationIds.slice(0, 10));

          const top5Retention = Array.from(top5Vector).filter(id => top5Consolidation.has(id)).length / 5;
          const top10Retention = Array.from(top10Vector).filter(id => top10Consolidation.has(id)).length / 10;

          sumTop5Retention += top5Retention;
          sumTop10Retention += top10Retention;
          validPairs++;
        }

        if (validPairs > 0) {
          metrics.kendalls_tau = sumKendallTau / validPairs;
          metrics.top_5_retention = sumTop5Retention / validPairs;
          metrics.top_10_retention = sumTop10Retention / validPairs;
        } else {
          metrics.kendalls_tau = 0;
          metrics.top_5_retention = 0;
          metrics.top_10_retention = 0;
        }
      } else {
        metrics.kendalls_tau = 0;
        metrics.top_5_retention = 0;
        metrics.top_10_retention = 0;
        
        logger.warn('Kendall\'s Tau 계산 불가: searchResultPairs가 비어있습니다', {
          context,
          groundTruthCount: groundTruths.length,
          reason: '검색 결과가 부족하거나 vectorScore/finalScore가 없을 수 있습니다'
        });
      }

      logger.info('검색 품질 지표 수집 완료', {
        context,
        metrics_count: Object.keys(metrics).length,
        ground_truth_count: groundTruths.length,
        kendalls_tau: metrics.kendalls_tau,
        searchResultPairsCount: searchResultPairs?.length || 0
      });
    } else {
      // Ground Truth가 없으면 기본값 반환
      metrics.precision_at_5 = 0;
      metrics.precision_at_10 = 0;
      metrics.recall_at_5 = 0;
      metrics.recall_at_10 = 0;
      metrics.ndcg_at_5 = 0;
      metrics.ndcg_at_10 = 0;
      metrics.mrr = 0;
      metrics.kendalls_tau = 0;
      metrics.top_5_retention = 0;
      metrics.top_10_retention = 0;

      logger.info('검색 품질 지표 수집 완료 (기본값)', {
        context,
        note: 'Ground Truth 데이터가 없어 기본값을 반환했습니다. 실제 측정을 위해서는 Ground Truth 데이터가 필요합니다.'
      });
    }

      // has_ground_truth: 옵션으로 제공되었거나 benchmarkDir에서 로드된 경우 true
      const hasExplicitGroundTruth =
        (options?.groundTruths !== undefined && options.groundTruths.length > 0) ||
        (options?.benchmarkDir !== undefined && groundTruths !== undefined && groundTruths.length > 0);
      const hasAutoLoadedGroundTruth =
        !options?.groundTruths &&
        !options?.benchmarkDir &&
        groundTruths !== undefined &&
        groundTruths.length > 0;
      
      return {
        namespace: 'search',
        context,
        measured_at: new Date().toISOString(),
        metrics,
        metadata: {
          has_ground_truth: hasExplicitGroundTruth,
          ground_truth_count: hasExplicitGroundTruth ? (groundTruths?.length ?? 0) : 0,
          auto_loaded: hasAutoLoadedGroundTruth,
          auto_searched: !options?.queryResults && queryResults !== undefined
        }
      };
  }
}

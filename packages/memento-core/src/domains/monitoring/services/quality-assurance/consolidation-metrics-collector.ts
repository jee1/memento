import Database from 'better-sqlite3';
import { logger } from '../../../../shared/utils/logger.js';
import {
  generateOrderPreservationReport,
  loadGroundTruth,
  generateVectorOnlySearchResults,
  generateConsolidationSearchResults,
  type OrderPreservationReport,
} from './vector-search-quality-metrics.js';
import { HybridSearchFactory } from '../../../search/factories/hybrid-search.factory.js';
import type { HybridSearchQuery } from '../../../search/algorithms/hybrid-search-engine.js';
import type { CollectedMetrics, ConsolidationMetricsOptions } from './quality-metrics-types.js';

export class ConsolidationMetricsCollector {
  constructor(private db: Database.Database) {}

  async collect(
    context: string = 'default',
    options?: ConsolidationMetricsOptions
  ): Promise<CollectedMetrics> {
    const metrics: Record<string, number> = {};

    // searchResultPairs 자동 생성 (제공되지 않은 경우)
    let searchResultPairs = options?.searchResultPairs;
    if (!searchResultPairs || searchResultPairs.length === 0) {
      try {
        const groundTruths = loadGroundTruth();
        if (groundTruths && groundTruths.length > 0) {
          const searchEngine = HybridSearchFactory.createDefaultEngine(this.db);
          searchResultPairs = [];

          for (const groundTruth of groundTruths) {
            try {
              const searchQuery: HybridSearchQuery = {
                query: groundTruth.queryId,
                limit: 20
              };

              const searchResult = await searchEngine.search(this.db, searchQuery);
              
              // 벡터-only 결과 생성
              const vectorOnlyResults = generateVectorOnlySearchResults(
                searchResult.items,
                20
              );

              // Consolidation 반영 후 결과 생성
              const consolidationResults = generateConsolidationSearchResults(
                searchResult.items,
                20
              );

              // 결과가 충분한 경우에만 추가
              if (vectorOnlyResults.length >= 2 && consolidationResults.length >= 2) {
                searchResultPairs.push({
                  vectorOnly: vectorOnlyResults,
                  withConsolidation: consolidationResults
                });
              } else {
                logger.warn('검색 결과 쌍 생성 실패: 결과 부족', {
                  context,
                  query: groundTruth.queryId,
                  searchResultCount: searchResult.items.length,
                  vectorOnlyCount: vectorOnlyResults.length,
                  consolidationCount: consolidationResults.length
                });
              }
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
        }
      } catch (error) {
        logger.warn('검색 결과 쌍 자동 생성 실패', {
          context,
          error: error instanceof Error ? error.message : String(error)
        });
        searchResultPairs = [];
      }
    }

    // 검색 결과 쌍이 제공된 경우 순서 보존 지표 계산
    if (searchResultPairs && searchResultPairs.length > 0) {
      let sumKendallTau = 0;
      let sumTop5Retention = 0;
      let sumTop10Retention = 0;
      let validPairs = 0;

      for (const pair of searchResultPairs) {
        // 순서 보존 리포트 생성
        const report: OrderPreservationReport = generateOrderPreservationReport(pair);

        sumKendallTau += report.metrics.kendallTau;
        sumTop5Retention += report.metrics.top5Retention;
        sumTop10Retention += report.metrics.top10Retention;
        validPairs++;
      }

      if (validPairs > 0) {
        metrics.kendalls_tau = sumKendallTau / validPairs;
        metrics.order_preservation = (metrics.kendalls_tau + 1) / 2; // -1~1을 0~1로 정규화
        metrics.top_5_retention = sumTop5Retention / validPairs;
        metrics.top_10_retention = sumTop10Retention / validPairs;
      } else {
        metrics.kendalls_tau = 0;
        metrics.order_preservation = 0;
        metrics.top_5_retention = 0;
        metrics.top_10_retention = 0;
      }
    } else {
      metrics.kendalls_tau = 0;
      metrics.order_preservation = 0;
      metrics.top_5_retention = 0;
      metrics.top_10_retention = 0;
    }

    // Consolidation 점수 샘플이 제공된 경우 점수 분포 계산
    if (options?.consolidationScores && options.consolidationScores.length > 0) {
      const scores = options.consolidationScores.filter(s => s !== null && s !== undefined && !isNaN(s));
      
      if (scores.length > 0) {
        // 평균 계산
        const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
        metrics.score_mean = mean;

        // 표준편차 계산
        const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
        const std = Math.sqrt(variance);
        metrics.score_std = std;

        // 점수 안정성 계산 (분산의 역수, 0~1 범위로 정규화)
        // 분산이 작을수록 안정적이므로, 1 / (1 + variance)로 계산
        // 최대 분산은 0.25 (0~1 범위에서)이므로 이를 기준으로 정규화
        const maxVariance = 0.25; // 0~1 범위에서 최대 분산
        const normalizedVariance = Math.min(variance / maxVariance, 1.0);
        metrics.score_stability = 1.0 - normalizedVariance;
      } else {
        metrics.score_mean = 0;
        metrics.score_std = 0;
        metrics.score_stability = 0;
      }
    } else {
      // 데이터베이스에서 Consolidation 점수 조회 시도
      try {
        const scoresResult = this.db.prepare(`
          SELECT consolidation_score
          FROM memory_item
          WHERE consolidation_score IS NOT NULL
          LIMIT 1000
        `).all() as Array<{ consolidation_score: number | null }>;

        const scores = scoresResult
          .map(r => r.consolidation_score)
          .filter((s): s is number => s !== null && s !== undefined && !isNaN(s));

        if (scores.length > 0) {
          // 평균 계산
          const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
          metrics.score_mean = mean;

          // 표준편차 계산
          const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
          const std = Math.sqrt(variance);
          metrics.score_std = std;

          // 점수 안정성 계산
          const maxVariance = 0.25;
          const normalizedVariance = Math.min(variance / maxVariance, 1.0);
          metrics.score_stability = 1.0 - normalizedVariance;
        } else {
          metrics.score_mean = 0;
          metrics.score_std = 0;
          metrics.score_stability = 0;
        }
      } catch (error) {
        // 데이터베이스 조회 실패 시 기본값
        logger.warn('Consolidation 점수 조회 실패', { error: error instanceof Error ? error.message : String(error) });
        metrics.score_mean = 0;
        metrics.score_std = 0;
        metrics.score_stability = 0;
      }
    }

    const hasData = (options?.searchResultPairs && options.searchResultPairs.length > 0) ||
                    (options?.consolidationScores && options.consolidationScores.length > 0) ||
                    metrics.score_mean !== undefined;

    if (hasData) {
      logger.info('Consolidation 점수 품질 지표 수집 완료', {
        context,
        metrics_count: Object.keys(metrics).length,
        has_order_preservation: options?.searchResultPairs !== undefined,
        has_score_distribution: metrics.score_mean !== undefined
      });
    } else {
      logger.info('Consolidation 점수 품질 지표 수집 완료 (기본값)', {
        context,
        note: '검색 결과 쌍이나 점수 샘플이 없어 기본값을 반환했습니다. 실제 측정을 위해서는 검색 결과 쌍이나 점수 샘플이 필요합니다.'
      });
    }

    return {
      namespace: 'consolidation',
      context,
      measured_at: new Date().toISOString(),
      metrics,
      metadata: {
        has_search_result_pairs: options?.searchResultPairs !== undefined && (options.searchResultPairs.length > 0),
        has_score_samples: options?.consolidationScores !== undefined && (options.consolidationScores.length > 0),
        search_result_pairs_count: options?.searchResultPairs?.length || 0,
        score_samples_count: options?.consolidationScores?.length || 0
      }
    };
  }
}

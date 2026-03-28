/**
 * Quality Metrics Collector
 * 
 * 품질 지표 수집 서비스
 * 
 * 주요 기능:
 * - 기존 품질 검증 시스템들을 호출하여 지표 수집
 * - namespace 단위 수집 메서드 제공 (search, relation, consolidation, storage)
 * - 수집된 지표를 구조화된 형태로 반환
 * 
 * PRD FR-1.1: Collector 역할 - 품질 지표 수집 (기존 검증 시스템 호출)
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { logger } from '../../../../shared/utils/logger.js';
import {
  assertMacroCategory,
  BENCHMARK_OFFLINE_VECTOR_PROVIDER_FILTER,
  type CategoryQualityReport,
  type MacroCategory,
} from '../../../../shared/types/benchmark.types.js';
import {
  calculatePrecisionAtK,
  calculateRecallAtK,
  calculateNDCGAtK,
  type SearchResult,
  type GroundTruth
} from '../../../../test/helpers/search-quality-metrics.js';
import {
  calculateKendallTau,
  generateOrderPreservationReport,
  loadGroundTruth,
  generateVectorOnlySearchResults,
  generateConsolidationSearchResults,
  type SearchResultPair,
  type OrderPreservationReport
} from '../../../../test/helpers/vector-search-quality-metrics.js';
import {
  loadBenchmarkManifest,
  assertStrictBenchmark,
  buildBenchmarkQueryLookup,
  loadBenchmarkCorpus,
  loadBenchmarkQueries,
} from '../../../../test/helpers/search-quality-benchmark-fixtures.js';
import {
  normalizeBenchmarkGroundTruths,
  verifyReviewableBenchmark,
} from '../../../../test/helpers/search-quality-review-verifier.js';
import {
  RelationQualityValidator,
  type ExpectedRelation,
  type ExtractedRelation
} from '../../../relation/services/relation-quality-validator.js';
import { HybridSearchFactory } from '../../../search/factories/hybrid-search.factory.js';
import type { HybridSearchQuery, HybridSearchResult } from '../../../search/algorithms/hybrid-search-engine.js';

/**
 * 품질 지표 수집 결과
 */
export interface CollectedMetrics {
  /**
   * 네임스페이스 (예: 'search', 'relation', 'consolidation', 'storage')
   */
  namespace: string;

  /**
   * 컨텍스트 (예: 'default', 'ci', 'nightly')
   */
  context: string;

  /**
   * 측정 시간
   */
  measured_at: string;

  /**
   * 지표 데이터 (키-값 쌍)
   * 예: { 'precision_at_5': 0.85, 'recall_at_5': 0.72, ... }
   */
  metrics: Record<string, number>;

  /**
   * 메타데이터 (선택적)
   */
  metadata?: Record<string, any>;
}

/**
 * 검색 품질 지표
 */
export interface SearchQualityMetrics {
  // Precision@K
  precision_at_5?: number;
  precision_at_10?: number;

  // Recall@K
  recall_at_5?: number;
  recall_at_10?: number;

  // NDCG@K
  ndcg_at_5?: number;
  ndcg_at_10?: number;

  // MRR
  mrr?: number;

  // Kendall's Tau
  kendalls_tau?: number;

  // 상위 K개 결과 유지율
  top_5_retention?: number;
  top_10_retention?: number;

  // 벡터 유사도 분포 (평균, 표준편차)
  vector_similarity_mean?: number;
  vector_similarity_std?: number;

  // Consolidation 점수 분포 (평균, 표준편차)
  consolidation_score_mean?: number;
  consolidation_score_std?: number;
}

/**
 * 관계 추출 품질 지표
 */
export interface RelationQualityMetrics {
  // 전체 메트릭
  precision?: number;
  recall?: number;
  f1_score?: number;

  // 카운트
  true_positives?: number;
  false_positives?: number;
  false_negatives?: number;

  // 신뢰도 범위 준수율
  confidence_compliance_rate?: number;

  // 관계 유형별 정확도 (선택적)
  type_precision?: Record<string, number>;
  type_recall?: Record<string, number>;
  type_f1_score?: Record<string, number>;
}

/**
 * Consolidation 점수 품질 지표
 */
export interface ConsolidationQualityMetrics {
  // 점수 안정성 (분산의 역수 또는 일관성 지표)
  score_stability?: number;

  // 순서 보존율
  order_preservation?: number;

  // 점수 분포 (평균, 표준편차)
  score_mean?: number;
  score_std?: number;

  // Kendall's Tau (Consolidation 반영 전/후 순서 일치도)
  kendalls_tau?: number;
}

/**
 * 저장 품질 지표
 */
export interface StorageQualityMetrics {
  // 중복 비율
  duplication_rate?: number;

  // 데이터 무결성 (0-1, 1이 완벽)
  data_integrity?: number;

  // 스키마 준수율 (0-1, 1이 완벽)
  schema_compliance?: number;

  // 데이터 손실률 (0-1, 0이 완벽)
  data_loss_rate?: number;
}

/**
 * Quality Metrics Collector
 * 
 * PRD FR-1.1: Collector 역할 - 품질 지표 수집 (기존 검증 시스템 호출)
 */
export class QualityMetricsCollector {
  constructor(private db: Database.Database) {
    if (!db) {
      throw new Error('Database instance is required');
    }
  }

  /**
   * MRR (Mean Reciprocal Rank) 계산
   * 첫 번째 관련 결과의 역순위의 평균
   * 
   * @param queryResults 쿼리별 검색 결과
   * @param groundTruths 쿼리별 Ground Truth
   * @returns MRR (0-1)
   */
  private calculateMRR(
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

  /**
   * 검색 품질 지표 수집
   * 
   * PRD FR-2.1: 검색 품질 지표 정의
   * - Precision@K, Recall@K, NDCG@K, MRR, Kendall's Tau 등
   * 
   * @param context - 컨텍스트 (기본값: 'default')
   * @param options - 옵션 (Ground Truth 데이터, 검색 결과 등)
   * @returns 검색 품질 지표
   * 
   * Note: Ground Truth 데이터가 제공되면 실제 측정을 수행하고,
   * 없으면 기본값(0)을 반환합니다.
   */
  async collectSearchMetrics(
    context: string = 'default',
    options?: {
      /**
       * Ground Truth 데이터 (선택적)
       * 제공되면 실제 측정을 수행합니다.
       * 제공되지 않으면 파일에서 자동 로드 시도
       */
      groundTruths?: GroundTruth[];
      
      /**
       * 검색 결과 (선택적)
       * 쿼리 ID를 키로 하는 Map
       * 제공되지 않으면 Ground Truth를 기반으로 실제 검색 수행
       */
      queryResults?: Map<string, SearchResult[]>;
      
      /**
       * 순서 보존 검증용 검색 결과 쌍 (선택적)
       * 벡터-only와 Consolidation 반영 후 결과 비교
       */
      searchResultPairs?: SearchResultPair[];

      /**
       * Benchmark fixture 디렉터리 (지정 시 manifest/ground truth를 여기서 로드)
       */
      benchmarkDir?: string;

      /**
       * strict benchmark 모드: manifest.strict_ci 및 human-labeled ground truth 필수
       */
      strictBenchmark?: boolean;
    }
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
      metrics.mrr = this.calculateMRR(queryResults, groundTruths);

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

  /**
   * 관계 추출 품질 지표 수집
   * 
   * PRD FR-2.4: 관계 추출 품질 지표 정의
   * - Precision, Recall, F1-Score, 관계 유형별 정확도
   * 
   * @param context - 컨텍스트 (기본값: 'default')
   * @param options - 옵션 (예상 관계, 추출된 관계 등)
   * @returns 관계 추출 품질 지표
   * 
   * Note: 예상 관계와 추출된 관계가 제공되면 실제 측정을 수행하고,
   * 없으면 기본값(0)을 반환합니다.
   */
  async collectRelationMetrics(
    context: string = 'default',
    options?: {
      /**
       * 예상 관계 목록 (Ground Truth, 선택적)
       * 제공되면 실제 측정을 수행합니다.
       */
      expectedRelations?: ExpectedRelation[];
      
      /**
       * 추출된 관계 목록 (선택적)
       * 제공되지 않으면 데이터베이스에서 자동 조회 시도
       */
      extractedRelations?: ExtractedRelation[];
    }
  ): Promise<CollectedMetrics> {
    const metrics: Record<string, number> = {};

    // extractedRelations 자동 조회 (제공되지 않은 경우)
    let extractedRelations = options?.extractedRelations;
    if (!extractedRelations || extractedRelations.length === 0) {
      try {
        const relationsResult = this.db.prepare(`
          SELECT source_id, target_id, relation_type, confidence
          FROM memory_relation
          LIMIT 1000
        `).all() as Array<{
          source_id: string;
          target_id: string;
          relation_type: string;
          confidence: number | null;
        }>;

        extractedRelations = relationsResult.map(r => ({
          source_id: r.source_id,
          target_id: r.target_id,
          relation_type: r.relation_type as any,
          confidence: r.confidence || 0
        }));

        if (extractedRelations.length > 0) {
          logger.info('추출된 관계 자동 조회 완료', {
            context,
            count: extractedRelations.length
          });
        }
      } catch (error) {
        logger.warn('추출된 관계 조회 실패', {
          context,
          error: error instanceof Error ? error.message : String(error)
        });
        extractedRelations = [];
      }
    }

    // 예상 관계와 추출된 관계가 제공된 경우 실제 측정 수행
    if (options?.expectedRelations && extractedRelations && extractedRelations.length > 0) {
      const expectedRelations = options.expectedRelations;
      const validator = new RelationQualityValidator();

      // 전체 품질 메트릭 계산
      const qualityMetrics = validator.calculateQualityMetrics(
        expectedRelations,
        extractedRelations
      );

      // 전체 메트릭
      metrics.precision = qualityMetrics.precision;
      metrics.recall = qualityMetrics.recall;
      metrics.f1_score = qualityMetrics.f1Score;
      metrics.true_positives = qualityMetrics.truePositives;
      metrics.false_positives = qualityMetrics.falsePositives;
      metrics.false_negatives = qualityMetrics.falseNegatives;
      metrics.confidence_compliance_rate = qualityMetrics.confidenceComplianceRate;

      // 관계 유형별 정확도 (Precision, Recall, F1-Score)
      const typePrecision: Record<string, number> = {};
      const typeRecall: Record<string, number> = {};
      const typeF1Score: Record<string, number> = {};

      for (const [relationType, typeMetric] of Object.entries(qualityMetrics.typeMetrics)) {
        typePrecision[relationType] = typeMetric.precision;
        typeRecall[relationType] = typeMetric.recall;
        typeF1Score[relationType] = typeMetric.f1Score;
      }

      // 메타데이터에 관계 유형별 정확도 포함
      const metadata: Record<string, any> = {
        has_ground_truth: true,
        expected_relations_count: expectedRelations.length,
        extracted_relations_count: extractedRelations.length,
        type_precision: typePrecision,
        type_recall: typeRecall,
        type_f1_score: typeF1Score
      };

      logger.info('관계 추출 품질 지표 수집 완료', {
        context,
        precision: qualityMetrics.precision,
        recall: qualityMetrics.recall,
        f1_score: qualityMetrics.f1Score,
        expected_count: expectedRelations.length,
        extracted_count: extractedRelations.length
      });

      return {
        namespace: 'relation',
        context,
        measured_at: new Date().toISOString(),
        metrics,
        metadata
      };
    } else {
      // 예상 관계나 추출된 관계가 없으면 기본값 반환
      metrics.precision = 0;
      metrics.recall = 0;
      metrics.f1_score = 0;
      metrics.true_positives = 0;
      metrics.false_positives = 0;
      metrics.false_negatives = 0;
      metrics.confidence_compliance_rate = 0;

      const hasExtractedRelations = extractedRelations && extractedRelations.length > 0;
      const hasExpectedRelations = options?.expectedRelations && options.expectedRelations.length > 0;

      logger.info('관계 추출 품질 지표 수집 완료 (기본값)', {
        context,
        extracted_relations_count: extractedRelations?.length || 0,
        expected_relations_count: options?.expectedRelations?.length || 0,
        note: hasExtractedRelations && !hasExpectedRelations
          ? '추출된 관계는 있지만 Ground Truth가 없어 precision/recall을 계산할 수 없습니다.'
          : !hasExtractedRelations && hasExpectedRelations
          ? 'Ground Truth는 있지만 추출된 관계가 없어 측정할 수 없습니다.'
          : '예상 관계나 추출된 관계가 없어 기본값을 반환했습니다. 실제 측정을 위해서는 예상 관계와 추출된 관계가 필요합니다.'
      });

      return {
        namespace: 'relation',
        context,
        measured_at: new Date().toISOString(),
        metrics,
        metadata: {
          has_ground_truth: hasExpectedRelations || false,
          extracted_relations_count: extractedRelations?.length || 0,
          expected_relations_count: options?.expectedRelations?.length || 0,
          note: hasExtractedRelations && !hasExpectedRelations
            ? '추출된 관계는 있지만 Ground Truth가 없어 precision/recall을 계산할 수 없습니다.'
            : !hasExtractedRelations && hasExpectedRelations
            ? 'Ground Truth는 있지만 추출된 관계가 없어 측정할 수 없습니다.'
            : '예상 관계나 추출된 관계가 없어 기본값을 반환했습니다. 실제 측정을 위해서는 예상 관계와 추출된 관계가 필요합니다.'
        }
      };
    }
  }

  /**
   * Consolidation 점수 품질 지표 수집
   * 
   * PRD FR-2.5: Consolidation 점수 안정성 지표 정의
   * - 점수 분포, 순서 보존 검증
   * 
   * @param context - 컨텍스트 (기본값: 'default')
   * @param options - 옵션 (검색 결과 쌍, 점수 샘플 등)
   * @returns Consolidation 점수 품질 지표
   * 
   * Note: 검색 결과 쌍이나 점수 샘플이 제공되면 실제 측정을 수행하고,
   * 없으면 기본값(0)을 반환합니다.
   */
  async collectConsolidationMetrics(
    context: string = 'default',
    options?: {
      /**
       * 순서 보존 검증용 검색 결과 쌍 (선택적)
       * 벡터-only와 Consolidation 반영 후 결과 비교
       */
      searchResultPairs?: SearchResultPair[];
      
      /**
       * Consolidation 점수 샘플 (선택적)
       * 점수 분포 분석을 위한 샘플 데이터
       */
      consolidationScores?: number[];
    }
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

  /**
   * 저장 품질 지표 수집
   * 
   * PRD FR-2.5: 기억 저장 품질 지표 정의
   * - 중복 비율, 데이터 무결성, 스키마 준수율, 데이터 손실률
   * 
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 저장 품질 지표
   */
  async collectStorageMetrics(context: string = 'default'): Promise<CollectedMetrics> {
    const metrics: Record<string, number> = {};

    try {
      // 1. 중복 비율 계산 (memory_link 테이블에서 duplicates 관계 비율)
      const totalMemoryItems = this.db.prepare(`
        SELECT COUNT(*) as count FROM memory_item
      `).get() as { count: number };

      const duplicateLinks = this.db.prepare(`
        SELECT COUNT(*) as count FROM memory_link
        WHERE relation_type = 'duplicates'
      `).get() as { count: number };

      // 중복 비율 = (중복 관계 수 * 2) / (전체 메모리 아이템 수 * 2)
      // 각 중복 관계는 2개의 메모리를 연결하므로, 중복된 메모리 수는 관계 수 * 2
      // 전체 메모리 아이템이 0인 경우 0으로 처리
      if (totalMemoryItems.count > 0) {
        metrics.duplication_rate = Math.min(
          (duplicateLinks.count * 2) / totalMemoryItems.count,
          1.0
        );
      } else {
        metrics.duplication_rate = 0;
      }

      // 2. 데이터 무결성 검증
      let integrityScore = 1.0;
      let integrityChecks = 0;
      let integrityPassed = 0;

      // 2.1 PRAGMA integrity_check
      try {
        const integrityResult = this.db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        integrityChecks++;
        if (integrityResult.integrity_check === 'ok') {
          integrityPassed++;
        } else {
          integrityScore -= 0.3; // 무결성 검사 실패 시 큰 패널티
        }
      } catch (error) {
        integrityChecks++;
        integrityScore -= 0.3;
      }

      // 2.2 외래키 제약 조건 검증
      // memory_item_tag의 외래키 검증
      try {
        const orphanedTags = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_item_tag mit
          LEFT JOIN memory_item mi ON mit.memory_id = mi.id
          LEFT JOIN memory_tag mt ON mit.tag_id = mt.id
          WHERE mi.id IS NULL OR mt.id IS NULL
        `).get() as { count: number };
        integrityChecks++;
        if (orphanedTags.count === 0) {
          integrityPassed++;
        } else {
          integrityScore -= 0.2;
        }
      } catch (error) {
        integrityChecks++;
        integrityScore -= 0.1;
      }

      // memory_link의 외래키 검증
      try {
        const orphanedLinks = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_link ml
          LEFT JOIN memory_item mi1 ON ml.source_id = mi1.id
          LEFT JOIN memory_item mi2 ON ml.target_id = mi2.id
          WHERE mi1.id IS NULL OR mi2.id IS NULL
        `).get() as { count: number };
        integrityChecks++;
        if (orphanedLinks.count === 0) {
          integrityPassed++;
        } else {
          integrityScore -= 0.2;
        }
      } catch (error) {
        integrityChecks++;
        integrityScore -= 0.1;
      }

      // feedback_event의 외래키 검증
      try {
        const orphanedFeedback = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM feedback_event fe
          LEFT JOIN memory_item mi ON fe.memory_id = mi.id
          WHERE mi.id IS NULL
        `).get() as { count: number };
        integrityChecks++;
        if (orphanedFeedback.count === 0) {
          integrityPassed++;
        } else {
          integrityScore -= 0.1;
        }
      } catch (error) {
        integrityChecks++;
        integrityScore -= 0.05;
      }

      // memory_embedding의 외래키 검증
      try {
        const orphanedEmbeddings = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_embedding me
          LEFT JOIN memory_item mi ON me.memory_id = mi.id
          WHERE mi.id IS NULL
        `).get() as { count: number };
        integrityChecks++;
        if (orphanedEmbeddings.count === 0) {
          integrityPassed++;
        } else {
          integrityScore -= 0.2;
        }
      } catch (error) {
        integrityChecks++;
        integrityScore -= 0.1;
      }

      // 무결성 점수는 0 이상 1 이하로 정규화
      metrics.data_integrity = Math.max(0, Math.min(integrityScore, 1.0));

      // 3. 스키마 준수율 계산
      let schemaComplianceScore = 1.0;
      let schemaChecks = 0;
      let schemaPassed = 0;

      // 3.1 필수 필드 존재 여부 (id, type, content)
      try {
        const missingRequiredFields = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_item
          WHERE id IS NULL OR id = '' OR
                type IS NULL OR type = '' OR
                content IS NULL OR content = ''
        `).get() as { count: number };
        schemaChecks++;
        if (missingRequiredFields.count === 0) {
          schemaPassed++;
        } else {
          schemaComplianceScore -= 0.3;
        }
      } catch (error) {
        schemaChecks++;
        schemaComplianceScore -= 0.1;
      }

      // 3.2 타입 검증 (type은 enum 값)
      try {
        const invalidTypes = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_item
          WHERE type NOT IN ('working', 'episodic', 'semantic', 'procedural', 'core', 'vault')
        `).get() as { count: number };
        schemaChecks++;
        if (invalidTypes.count === 0) {
          schemaPassed++;
        } else {
          schemaComplianceScore -= 0.2;
        }
      } catch (error) {
        schemaChecks++;
        schemaComplianceScore -= 0.1;
      }

      // 3.3 importance 범위 검증 (0-1)
      try {
        const invalidImportance = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_item
          WHERE importance IS NOT NULL AND (importance < 0 OR importance > 1)
        `).get() as { count: number };
        schemaChecks++;
        if (invalidImportance.count === 0) {
          schemaPassed++;
        } else {
          schemaComplianceScore -= 0.1;
        }
      } catch (error) {
        schemaChecks++;
        schemaComplianceScore -= 0.05;
      }

      // 3.4 privacy_scope enum 검증
      try {
        const invalidPrivacyScope = this.db.prepare(`
          SELECT COUNT(*) as count
          FROM memory_item
          WHERE privacy_scope IS NOT NULL AND 
                privacy_scope NOT IN ('private', 'team', 'public')
        `).get() as { count: number };
        schemaChecks++;
        if (invalidPrivacyScope.count === 0) {
          schemaPassed++;
        } else {
          schemaComplianceScore -= 0.1;
        }
      } catch (error) {
        schemaChecks++;
        schemaComplianceScore -= 0.05;
      }

      // 스키마 준수율은 0 이상 1 이하로 정규화
      metrics.schema_compliance = Math.max(0, Math.min(schemaComplianceScore, 1.0));

      // 4. 데이터 손실률 계산
      // memory_embedding 테이블에 embedding이 없는 memory_item 비율
      try {
        const totalItems = totalMemoryItems.count;
        if (totalItems > 0) {
          const itemsWithoutEmbedding = this.db.prepare(`
            SELECT COUNT(*) as count
            FROM memory_item mi
            LEFT JOIN memory_embedding me ON mi.id = me.memory_id
            WHERE me.memory_id IS NULL
          `).get() as { count: number };
          metrics.data_loss_rate = itemsWithoutEmbedding.count / totalItems;
        } else {
          metrics.data_loss_rate = 0;
        }
      } catch (error) {
        metrics.data_loss_rate = 0;
      }

      logger.info('저장 품질 지표 수집 완료', {
        context,
        metrics_count: Object.keys(metrics).length,
        duplication_rate: metrics.duplication_rate,
        data_integrity: metrics.data_integrity,
        schema_compliance: metrics.schema_compliance,
        data_loss_rate: metrics.data_loss_rate,
        integrity_checks: integrityChecks,
        integrity_passed: integrityPassed,
        schema_checks: schemaChecks,
        schema_passed: schemaPassed
      });

    } catch (error) {
      logger.error('저장 품질 지표 수집 중 오류 발생', {
        context,
        error: error instanceof Error ? error.message : String(error)
      });
      // 오류 발생 시 기본값 반환
      metrics.duplication_rate = 0;
      metrics.data_integrity = 0;
      metrics.schema_compliance = 0;
      metrics.data_loss_rate = 0;
    }

    return {
      namespace: 'storage',
      context,
      measured_at: new Date().toISOString(),
      metrics,
      metadata: {
        note: '저장 품질 지표 수집 완료'
      }
    };
  }

  /**
   * 모든 네임스페이스의 품질 지표 수집
   * 
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 모든 네임스페이스의 품질 지표
   */
  async collectAllMetrics(context: string = 'default'): Promise<CollectedMetrics[]> {
    const results = await Promise.all([
      this.collectSearchMetrics(context),
      this.collectRelationMetrics(context),
      this.collectConsolidationMetrics(context),
      this.collectStorageMetrics(context)
    ]);

    return results;
  }

  /**
   * 특정 네임스페이스의 품질 지표 수집
   * 
   * @param namespace - 네임스페이스 ('search', 'relation', 'consolidation', 'storage')
   * @param context - 컨텍스트 (기본값: 'default')
   * @returns 품질 지표
   */
  async collectMetricsByNamespace(
    namespace: string,
    context: string = 'default'
  ): Promise<CollectedMetrics> {
    switch (namespace) {
      case 'search':
        return this.collectSearchMetrics(context);
      case 'relation':
        return this.collectRelationMetrics(context);
      case 'consolidation':
        return this.collectConsolidationMetrics(context);
      case 'storage':
        return this.collectStorageMetrics(context);
      default:
        throw new Error(`Unknown namespace: ${namespace}`);
    }
  }

  /**
   * macro_category별 MRR·NDCG 집계 (benchmark-v3 + category-mapping.json)
   */
  async collectCategoryMetrics(
    benchmarkDir: string,
    mappingPath: string
  ): Promise<CategoryQualityReport[]> {
    const raw = JSON.parse(readFileSync(mappingPath, 'utf8')) as {
      macro_categories: Record<string, string[]>;
      query_overrides?: Record<string, string>;
      /** FR-005: queries.json 변경 없이 query_id → 카테고리 라벨(사람 유지) */
      query_id_to_category: Record<string, string>;
    };
    const queries = loadBenchmarkQueries(benchmarkDir);
    const groundTruths = normalizeBenchmarkGroundTruths(benchmarkDir);
    const corpus = loadBenchmarkCorpus(benchmarkDir);
    const memoryIdToBenchmarkId = new Map(corpus.map((e) => [e.source_memory_id, e.benchmark_id]));

    const categoryToMacro = new Map<string, MacroCategory>();
    for (const [macro, cats] of Object.entries(raw.macro_categories)) {
      const macroKey = assertMacroCategory(macro, 'macro_categories key');
      for (const c of cats) {
        categoryToMacro.set(c, macroKey);
      }
    }

    if (raw.query_overrides) {
      for (const qid of Object.keys(raw.query_overrides)) {
        const v = raw.query_overrides[qid];
        if (v !== undefined) {
          assertMacroCategory(v, `query_overrides[${qid}]`);
        }
      }
    }

    const queryIdToMacro = new Map<string, MacroCategory>();
    for (const q of queries) {
      const categoryLabel = raw.query_id_to_category?.[q.query_id];
      if (!categoryLabel) {
        throw new Error(
          `Category mapping missing query_id_to_category for query ${q.query_id}`
        );
      }
      const overrideRaw = raw.query_overrides?.[q.query_id];
      const macro =
        overrideRaw !== undefined ? (overrideRaw as MacroCategory) : categoryToMacro.get(categoryLabel);
      if (!macro) {
        throw new Error(
          `Category mapping missing macro for query ${q.query_id} (category=${categoryLabel})`
        );
      }
      queryIdToMacro.set(q.query_id, macro);
      // normalizeBenchmarkGroundTruths가 queryId를 쿼리 본문으로 통일하므로 텍스트 키도 등록
      if (q.query) {
        queryIdToMacro.set(q.query, macro);
      }
    }

    const searchEngine = HybridSearchFactory.createDefaultEngine(this.db);
    const queryResultsByQueryId = new Map<string, SearchResult[]>();

    for (const gt of groundTruths) {
      const qrow = queries.find(q => q.query_id === gt.queryId);
      const queryText = qrow?.query ?? gt.queryId;
      const sr = await searchEngine.search(this.db, {
        query: queryText,
        limit: 20,
        provider_filter: BENCHMARK_OFFLINE_VECTOR_PROVIDER_FILTER,
      });
      const mapped: SearchResult[] = sr.items.map((item) => ({
        id: memoryIdToBenchmarkId.get(item.id) ?? item.id,
        score: item.finalScore
      }));
      queryResultsByQueryId.set(gt.queryId, mapped);
    }

    const ALL_MACROS: MacroCategory[] = [
      'episodic_recent',
      'procedural',
      'conceptual',
      'tag_filter'
    ];
    const MRR_THRESHOLD = 0.5;
    const reports: CategoryQualityReport[] = [];

    for (const macro of ALL_MACROS) {
      const subsetGts = groundTruths.filter(gt => queryIdToMacro.get(gt.queryId) === macro);
      const subMap = new Map<string, SearchResult[]>();
      for (const gt of subsetGts) {
        const r = queryResultsByQueryId.get(gt.queryId);
        if (r) {
          subMap.set(gt.queryId, r);
        }
      }

      const mrr = this.calculateMRR(subMap, subsetGts);

      let ndcg5 = 0;
      let ndcg10 = 0;
      const ndcgDenom = subsetGts.length;
      for (const gt of subsetGts) {
        const results = queryResultsByQueryId.get(gt.queryId);
        if (!results || results.length === 0) {
          continue;
        }
        ndcg5 += calculateNDCGAtK(results, gt.relevantIds, 5);
        ndcg10 += calculateNDCGAtK(results, gt.relevantIds, 10);
      }

      const mrrVal = mrr;
      reports.push({
        macro_category: macro,
        query_count: subsetGts.length,
        mrr: mrrVal,
        ndcg_at_5: ndcgDenom > 0 ? ndcg5 / ndcgDenom : 0,
        ndcg_at_10: ndcgDenom > 0 ? ndcg10 / ndcgDenom : 0,
        threshold_passed: mrrVal >= MRR_THRESHOLD
      });
    }

    return reports;
  }
}

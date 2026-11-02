import Database from 'better-sqlite3';
import { logger } from '../../../../shared/utils/logger.js';
import { getErrorMessage } from '../../../../shared/services/llm-client-initializer/shared-helpers.js';
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
import { HybridSearchFactory } from '../../../search/index.js';
import type { RepositoryProvider } from '../../../../shared/ports/repository-provider.port.js';
import type { HybridSearchResult } from '../../../search/index.js';
import type { CollectedMetrics, SearchMetricsOptions } from './quality-metrics-types.js';
import {
  QUALITY_METRIC_STATE,
  SEARCH_QUALITY_METRIC_KEYS,
  buildUniformMetricStates,
  mergeMeasuredStates,
} from './quality-metric-measurement.js';

type SearchResultPair = { vectorOnly: SearchResult[]; withConsolidation: SearchResult[] };
type FullResultsByQuery = Map<string, { items: HybridSearchResult[] }>;

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

/** Precision@K·Recall@K·NDCG@K (K=5,10) 의 쿼리 평균. 결과가 없는 쿼리는 빼고 센다. */
function computeRankingMetricsAtK(
  groundTruths: GroundTruth[],
  queryResults: Map<string, SearchResult[]>
): { metrics: Record<string, number>; metricStates: Record<string, typeof QUALITY_METRIC_STATE[keyof typeof QUALITY_METRIC_STATE]> } {
  const metrics: Record<string, number> = {};
  const metricStates: Record<string, typeof QUALITY_METRIC_STATE[keyof typeof QUALITY_METRIC_STATE]> = {};
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

    const keys = [`precision_at_${k}`, `recall_at_${k}`, `ndcg_at_${k}`] as const;
    if (validQueries > 0) {
      metrics[`precision_at_${k}`] = sumPrecision / validQueries;
      metrics[`recall_at_${k}`] = sumRecall / validQueries;
      metrics[`ndcg_at_${k}`] = sumNDCG / validQueries;
      for (const key of keys) {
        metricStates[key] = QUALITY_METRIC_STATE.MEASURED;
      }
    } else {
      for (const key of keys) {
        metricStates[key] = QUALITY_METRIC_STATE.UNMEASURED_INSUFFICIENT_SAMPLE;
      }
    }
  }
  return { metrics, metricStates };
}

/** 벡터 단독 대비 consolidation 결과의 Kendall's Tau·Top5/Top10 유지율 평균. */
function computeOrderPreservationMetrics(
  searchResultPairs: Array<{ vectorOnly: SearchResult[]; withConsolidation: SearchResult[] }>
): Record<string, number> {
  const metrics: Record<string, number> = {};
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
  return metrics;
}

/** Ground Truth 가 없을 때 숫자 0 대신 미측정 상태만 둔다 */
const UNMEASURED_SEARCH_METRIC_STATES = buildUniformMetricStates(
  SEARCH_QUALITY_METRIC_KEYS,
  QUALITY_METRIC_STATE.UNMEASURED_NO_GROUND_TRUTH
);


const SEARCH_LIMIT = 20;
const NO_PAIRS_REASON = '검색 결과가 부족하거나 vectorScore/finalScore가 없을 수 있습니다';

function hasItems<T>(values: T[] | null | undefined): values is T[] {
  return values != null && values.length > 0;
}

interface BenchmarkInputs {
  groundTruths: GroundTruth[];
  memoryIdToBenchmarkId: Map<string, string>;
  queryIdToQueryText: Map<string, string>;
}

/** manifest → (strict 면 검증) → ground truth 정규화 → corpus id 매핑 → query id→text 매핑 */
function loadBenchmarkInputs(benchmarkDir: string, strict: boolean): BenchmarkInputs {
  const manifest = loadBenchmarkManifest(benchmarkDir);
  if (strict) {
    assertStrictBenchmark(manifest);
    const verification = verifyReviewableBenchmark(benchmarkDir, { requireReviewed: true });
    if (!verification.ok) {
      throw new Error(`Strict benchmark verification failed: ${verification.errors.join('; ')}`);
    }
  }
  const groundTruths = normalizeBenchmarkGroundTruths(benchmarkDir);
  let memoryIdToBenchmarkId: Map<string, string>;
  try {
    const corpus = loadBenchmarkCorpus(benchmarkDir);
    memoryIdToBenchmarkId = new Map(corpus.map((e) => [e.source_memory_id, e.benchmark_id]));
  } catch (error) {
    throw new Error(`Benchmark corpus load failed: ${getErrorMessage(error)}`, { cause: error });
  }
  const queries = loadBenchmarkQueries(benchmarkDir);
  const queryIdToQueryText = new Map(
    [...buildBenchmarkQueryLookup(queries).byId.entries()].map(([queryId, query]) => [queryId, query.query])
  );
  return { groundTruths, memoryIdToBenchmarkId, queryIdToQueryText };
}

/** 옵션에도 benchmarkDir 에도 없을 때 파일에서 Ground Truth 를 읽는다. 없거나 실패하면 undefined. */
function autoLoadGroundTruths(context: string): GroundTruth[] | undefined {
  try {
    const loaded = loadGroundTruth();
    if (!hasItems(loaded)) return undefined;
    logger.info('Ground Truth 자동 로드 완료', {
      context,
      count: loaded.length
    });
    return loaded;
  } catch (error) {
    logger.warn('Ground Truth 파일 로드 실패', {
      context,
      error: getErrorMessage(error)
    });
    return undefined;
  }
}

/** 주어진 queryResults 의 query id 를 쿼리 본문으로, memory id 를 benchmark id 로 바꾼다. */
function remapQueryResults(
  queryResults: Map<string, SearchResult[]>,
  benchmark: BenchmarkInputs | undefined
): Map<string, SearchResult[]> {
  return new Map(
    [...queryResults.entries()].map(([queryId, results]) => [
      benchmark?.queryIdToQueryText.get(queryId) ?? queryId,
      results.map((result) => ({
        ...result,
        id: benchmark?.memoryIdToBenchmarkId.get(result.id) ?? result.id,
      })),
    ])
  );
}

/** 검색 결과로 vector-only / consolidation 쌍을 만든다. 둘 중 하나라도 2건 미만이면 null. */
function toSearchResultPair(
  items: HybridSearchResult[],
  context: string,
  query: string
): SearchResultPair | null {
  const vectorOnlyResults = generateVectorOnlySearchResults(items, SEARCH_LIMIT);
  const consolidationResults = generateConsolidationSearchResults(items, SEARCH_LIMIT);
  const added = vectorOnlyResults.length >= 2 && consolidationResults.length >= 2;

  if (!added) {
    logger.warn('검색 결과 쌍 생성 실패: 결과 부족', {
      context,
      query,
      searchResultCount: items.length,
      vectorOnlyCount: vectorOnlyResults.length,
      consolidationCount: consolidationResults.length,
      reason: vectorOnlyResults.length < 2 ? 'vectorOnlyResults 부족' : 'consolidationResults 부족'
    });
  }

  logger.debug('검색 결과 쌍 생성 완료', {
    context,
    query,
    searchResultCount: items.length,
    vectorOnlyCount: vectorOnlyResults.length,
    consolidationCount: consolidationResults.length,
    added
  });

  return added ? { vectorOnly: vectorOnlyResults, withConsolidation: consolidationResults } : null;
}

function logPairSummary(context: string, pairCount: number, groundTruthCount: number): void {
  if (pairCount === 0) {
    logger.warn('검색 결과 쌍이 생성되지 않았습니다', {
      context,
      groundTruthCount,
      reason: NO_PAIRS_REASON
    });
  } else {
    logger.info('검색 결과 쌍 자동 생성 완료', {
      context,
      pairCount,
      groundTruthCount
    });
  }
}

/** has_ground_truth: 옵션으로 제공되었거나 benchmarkDir 에서 로드된 경우 true */
function groundTruthMetadata(
  options: SearchMetricsOptions | undefined,
  groundTruths: GroundTruth[] | undefined,
  queryResults: Map<string, SearchResult[]> | undefined
): Record<string, unknown> {
  const loaded = hasItems(groundTruths);
  const hasExplicitGroundTruth =
    hasItems(options?.groundTruths) || (options?.benchmarkDir !== undefined && loaded);
  const hasAutoLoadedGroundTruth = !options?.groundTruths && !options?.benchmarkDir && loaded;
  return {
    has_ground_truth: hasExplicitGroundTruth,
    ground_truth_count: hasExplicitGroundTruth ? (groundTruths?.length ?? 0) : 0,
    auto_loaded: hasAutoLoadedGroundTruth,
    auto_searched: !options?.queryResults && queryResults !== undefined
  };
}

export class SearchMetricsCollector {
  constructor(
    private db: Database.Database,
    private repositories: RepositoryProvider
  ) {}

  async collect(
    context: string = 'default',
    options?: SearchMetricsOptions
  ): Promise<CollectedMetrics> {
    if (options?.strictBenchmark && !options.benchmarkDir) {
      throw new Error('Strict benchmark mode requires benchmarkDir');
    }
    const benchmark = options?.benchmarkDir
      ? loadBenchmarkInputs(options.benchmarkDir, options.strictBenchmark === true)
      : undefined;
    let groundTruths = benchmark ? benchmark.groundTruths : options?.groundTruths;

    if (options?.strictBenchmark && !hasItems(groundTruths)) {
      throw new Error('Strict benchmark mode requires human-labeled ground truth');
    }

    if (!hasItems(groundTruths)) {
      groundTruths = autoLoadGroundTruths(context) ?? groundTruths;
    }

    const fullResultsByQuery: FullResultsByQuery = new Map();
    let queryResults: Map<string, SearchResult[]> | undefined;
    if (options?.queryResults) {
      queryResults = remapQueryResults(options.queryResults, benchmark);
    } else if (hasItems(groundTruths)) {
      queryResults = await this.searchGroundTruths(groundTruths, benchmark, fullResultsByQuery, context);
    }

    const hasRankingInputs = hasItems(groundTruths) && queryResults;
    const hasOrderPairs = hasItems(options?.searchResultPairs);

    let metrics: {
      metrics: Record<string, number>;
      metric_states: Record<string, typeof QUALITY_METRIC_STATE[keyof typeof QUALITY_METRIC_STATE]>;
      metric_denominators?: Record<string, number | null>;
    };
    if (hasRankingInputs) {
      metrics = await this.measure(
        groundTruths!,
        queryResults!,
        fullResultsByQuery,
        options?.searchResultPairs,
        context
      );
    } else if (hasOrderPairs) {
      metrics = this.measureOrderPreservationOnly(options!.searchResultPairs!, context);
    } else {
      metrics = this.unmeasuredMetrics(context);
    }

    const metadata = groundTruthMetadata(options, groundTruths, queryResults);
    if (!hasItems(groundTruths)) {
      metadata.note =
        'Ground Truth 데이터가 없어 랭킹 지표를 미측정으로 기록했습니다. 실제 측정을 위해서는 Ground Truth 데이터가 필요합니다.';
    }

    return {
      namespace: 'search',
      context,
      measured_at: new Date().toISOString(),
      metrics: metrics.metrics,
      metric_states: metrics.metric_states,
      metric_denominators: metrics.metric_denominators,
      metadata,
    };
  }

  private measureOrderPreservationOnly(
    searchResultPairs: SearchResultPair[],
    context: string
  ): {
    metrics: Record<string, number>;
    metric_states: Record<string, typeof QUALITY_METRIC_STATE[keyof typeof QUALITY_METRIC_STATE]>;
  } {
    const orderMetrics = computeOrderPreservationMetrics(searchResultPairs);
    const metricStates = mergeMeasuredStates(orderMetrics, {
      kendalls_tau: QUALITY_METRIC_STATE.MEASURED,
      top_5_retention: QUALITY_METRIC_STATE.MEASURED,
      top_10_retention: QUALITY_METRIC_STATE.MEASURED,
    });
    for (const key of SEARCH_QUALITY_METRIC_KEYS) {
      if (!(key in metricStates)) {
        metricStates[key] = QUALITY_METRIC_STATE.UNMEASURED_NO_GROUND_TRUTH;
      }
    }
    logger.info('검색 순서 보존 지표만 수집', { context, pairCount: searchResultPairs.length });
    return { metrics: orderMetrics, metric_states: metricStates };
  }

  private unmeasuredMetrics(context: string): {
    metrics: Record<string, number>;
    metric_states: Record<string, typeof QUALITY_METRIC_STATE[keyof typeof QUALITY_METRIC_STATE]>;
    metric_denominators?: undefined;
  } {
    logger.info('검색 품질 지표 수집 완료 (미측정)', {
      context,
      note: 'Ground Truth 데이터가 없어 기본값(0) 대신 미측정 상태를 반환했습니다.',
    });
    return {
      metrics: {},
      metric_states: { ...UNMEASURED_SEARCH_METRIC_STATES },
    };
  }

  /**
   * Ground Truth 쿼리를 엔진 하나로 병렬 검색한다. 원본 결과는 fullResultsByQuery 에 남긴다.
   * 엔진 초기화가 실패하면 빈 Map. 쿼리 하나의 실패는 그 쿼리만 빈 결과로 둔다.
   */
  private async searchGroundTruths(
    groundTruths: GroundTruth[],
    benchmark: BenchmarkInputs | undefined,
    fullResultsByQuery: FullResultsByQuery,
    context: string
  ): Promise<Map<string, SearchResult[]>> {
    try {
      const queryResults = new Map<string, SearchResult[]>();
      const searchEngine = HybridSearchFactory.createDefaultEngine(this.repositories);

      const resolved = await Promise.all(groundTruths.map(async (groundTruth) => {
        try {
          const searchResult = await searchEngine.search(this.db, { query: groundTruth.queryId, limit: SEARCH_LIMIT });
          return { queryId: groundTruth.queryId, searchResult };
        } catch (error) {
          logger.warn('검색 수행 실패', { context, query: groundTruth.queryId, error: getErrorMessage(error) });
          return { queryId: groundTruth.queryId, searchResult: { items: [] as HybridSearchResult[] } };
        }
      }));

      for (const { queryId, searchResult } of resolved) {
        queryResults.set(queryId, searchResult.items.map((item) => ({
          id: benchmark?.memoryIdToBenchmarkId.get(item.id) ?? item.id,
          score: item.finalScore
        })));
        fullResultsByQuery.set(queryId, searchResult);
      }

      logger.info('검색 결과 자동 생성 완료', { context, queryCount: queryResults.size });
      return queryResults;
    } catch (error) {
      logger.warn('검색 엔진 초기화 또는 검색 수행 실패', {
        context,
        error: getErrorMessage(error)
      });
      return new Map<string, SearchResult[]>();
    }
  }

  private async measure(
    groundTruths: GroundTruth[],
    queryResults: Map<string, SearchResult[]>,
    fullResultsByQuery: FullResultsByQuery,
    givenPairs: SearchResultPair[] | undefined,
    context: string
  ): Promise<{
    metrics: Record<string, number>;
    metric_states: Record<string, typeof QUALITY_METRIC_STATE[keyof typeof QUALITY_METRIC_STATE]>;
    metric_denominators: Record<string, number | null>;
  }> {
    const ranking = computeRankingMetricsAtK(groundTruths, queryResults);
    const metrics: Record<string, number> = { ...ranking.metrics };
    const metricStates = { ...ranking.metricStates };

    const mrr = calculateMRR(queryResults, groundTruths);
    const hasAnyQueryResults = [...queryResults.values()].some(r => r.length > 0);
    if (hasAnyQueryResults) {
      metrics.mrr = mrr;
      metricStates.mrr = QUALITY_METRIC_STATE.MEASURED;
    } else {
      metricStates.mrr = QUALITY_METRIC_STATE.UNMEASURED_INSUFFICIENT_SAMPLE;
    }

    const searchResultPairs = hasItems(givenPairs)
      ? givenPairs
      : await this.buildSearchResultPairs(groundTruths, fullResultsByQuery, context);

    if (searchResultPairs.length > 0) {
      Object.assign(metrics, computeOrderPreservationMetrics(searchResultPairs));
      for (const key of ['kendalls_tau', 'top_5_retention', 'top_10_retention'] as const) {
        metricStates[key] = QUALITY_METRIC_STATE.MEASURED;
      }
    } else {
      metricStates.kendalls_tau = QUALITY_METRIC_STATE.UNMEASURED_INSUFFICIENT_SAMPLE;
      metricStates.top_5_retention = QUALITY_METRIC_STATE.UNMEASURED_INSUFFICIENT_SAMPLE;
      metricStates.top_10_retention = QUALITY_METRIC_STATE.UNMEASURED_INSUFFICIENT_SAMPLE;
      logger.warn('Kendall\'s Tau 계산 불가: searchResultPairs가 비어있습니다', {
        context,
        groundTruthCount: groundTruths.length,
        reason: NO_PAIRS_REASON
      });
    }

    logger.info('검색 품질 지표 수집 완료', {
      context,
      metrics_count: Object.keys(metrics).length,
      ground_truth_count: groundTruths.length,
      kendalls_tau: metrics.kendalls_tau,
      searchResultPairsCount: searchResultPairs.length
    });
    return {
      metrics,
      metric_states: mergeMeasuredStates(metrics, metricStates),
      metric_denominators: {
        mrr: groundTruths.length,
      },
    };
  }

  /**
   * fullResultsByQuery 를 재사용해 쌍을 만든다. 결과가 없는 쿼리(queryResults 를 옵션으로 받았거나
   * 0건이던 쿼리)는 다시 검색한다. 엔진은 처음 필요할 때 한 번만 만든다.
   * 검색·엔진 오류가 나면 전체를 빈 배열로 둔다.
   */
  private async buildSearchResultPairs(
    groundTruths: GroundTruth[],
    fullResultsByQuery: FullResultsByQuery,
    context: string
  ): Promise<SearchResultPair[]> {
    try {
      const pairs: SearchResultPair[] = [];
      let searchEngine: ReturnType<typeof HybridSearchFactory.createDefaultEngine> | undefined;

      for (const groundTruth of groundTruths) {
        let items = fullResultsByQuery.get(groundTruth.queryId)?.items ?? [];
        if (items.length === 0) {
          searchEngine ??= HybridSearchFactory.createDefaultEngine(this.repositories);
          items = (await searchEngine.search(this.db, { query: groundTruth.queryId, limit: SEARCH_LIMIT })).items;
        }
        try {
          const pair = toSearchResultPair(items, context, groundTruth.queryId);
          if (pair) pairs.push(pair);
        } catch (error) {
          logger.warn('검색 결과 쌍 생성 실패', {
            context,
            query: groundTruth.queryId,
            error: getErrorMessage(error)
          });
        }
      }

      logPairSummary(context, pairs.length, groundTruths.length);
      return pairs;
    } catch (error) {
      logger.warn('검색 결과 쌍 자동 생성 실패', {
        context,
        error: getErrorMessage(error)
      });
      return [];
    }
  }
}

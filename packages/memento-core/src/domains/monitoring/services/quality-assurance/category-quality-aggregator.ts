import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { logger } from '../../../../shared/utils/logger.js';
import {
  assertMacroCategory,
  getBenchmarkVectorProviderFilter,
  type CategoryQualityReport,
  type MacroCategory,
} from '../../../../shared/types/benchmark.types.js';
import {
  calculateNDCGAtK,
  type SearchResult,
} from './search-quality-metrics.js';
import {
  loadBenchmarkCorpus,
  loadBenchmarkQueries,
} from './search-quality-benchmark-fixtures.js';
import {
  normalizeBenchmarkGroundTruths,
} from './search-quality-review-verifier.js';
import { HybridSearchFactory } from '../../../search/factories/hybrid-search.factory.js';
import { calculateMRR } from './search-metrics-collector.js';

/** #961: arm/subset 옵션 — 미지정 시 기존 category-report 기본 경로와 동일 */
export interface CategoryMetricsOptions {
  /** GT 문서 최대 길이가 이 값 이하인 쿼리만 채점 (#961 short-only 서브셋). 미지정 시 전체. */
  maxGroundTruthLength?: number;
  /** 하이브리드 융합 가중치 강제 (#961 vector-dominant arm). 미지정 시 엔진 기본값. */
  vectorWeight?: number;
  textWeight?: number;
}

/** #934: top-10 content 길이 평균 — 길이 편향 무-GT 지표 (게이트 아님) */
export function meanTop10ContentLength(
  items: Array<{ content?: string | null }>
): number {
  const top = items.slice(0, 10);
  if (top.length === 0) {
    return 0;
  }
  const sum = top.reduce((acc, item) => acc + (item.content?.length ?? 0), 0);
  return sum / top.length;
}

/** #961: top-10 중 2,000자 초과 문서 비율 — 프로덕션이 4.0%→34.0% 로 보고한 것과 같은 정의 */
export function top10LongDocRatio(
  items: Array<{ content?: string | null }>,
  minLength = 2000
): number {
  const top = items.slice(0, 10);
  if (top.length === 0) {
    return 0;
  }
  return top.filter((i) => (i.content?.length ?? 0) > minLength).length / top.length;
}

export class CategoryQualityAggregator {
  constructor(private db: Database.Database) {}

  async collect(
    benchmarkDir: string,
    mappingPath: string,
    options?: CategoryMetricsOptions
  ): Promise<CategoryQualityReport[]> {
    const raw = JSON.parse(readFileSync(mappingPath, 'utf8')) as {
      macro_categories: Record<string, string[]>;
      query_overrides?: Record<string, string>;
      /** FR-005: queries.json 변경 없이 query_id → 카테고리 라벨(사람 유지) */
      query_id_to_category: Record<string, string>;
    };
    const queries = loadBenchmarkQueries(benchmarkDir);
    const corpus = loadBenchmarkCorpus(benchmarkDir);
    const benchmarkIdToLength = new Map(
      corpus.map((e) => [e.benchmark_id, (e.content ?? '').length])
    );
    const gtMaxLen = (ids: string[]): number =>
      ids.reduce((m, id) => Math.max(m, benchmarkIdToLength.get(id) ?? 0), 0);

    const groundTruths = normalizeBenchmarkGroundTruths(benchmarkDir)
      .filter((groundTruth) => {
        if (groundTruth.relevantIds.length > 0) {
          return true;
        }
        logger.warn('카테고리 품질 측정에서 Ground Truth 없는 쿼리 제외', {
          query: groundTruth.queryId,
        });
        return false;
      })
      .filter(
        (gt) =>
          options?.maxGroundTruthLength === undefined ||
          gtMaxLen(gt.relevantIds) <= options.maxGroundTruthLength
      );
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

    // #961: short-only 서브셋에서는 authored도 같은 술어로 걸러 coverage 게이트가 죽지 않게 한다
    const scoredQueryKeys = new Set(groundTruths.map((gt) => gt.queryId));
    const authoredByMacro = new Map<MacroCategory, number>();
    for (const q of queries) {
      if (
        options?.maxGroundTruthLength !== undefined &&
        !scoredQueryKeys.has(q.query_id) &&
        !scoredQueryKeys.has(q.query)
      ) {
        continue;
      }
      const macro = queryIdToMacro.get(q.query_id);
      if (macro) {
        authoredByMacro.set(macro, (authoredByMacro.get(macro) ?? 0) + 1);
      }
    }

    // #961 R4: AdaptiveWeightCalculator caches by query string — callers must use a fresh
    // engine per arm. createDefaultEngine here is per collect() call (sweep creates new collector).
    const searchEngine = HybridSearchFactory.createDefaultEngine(this.db);
    const queryResultsByQueryId = new Map<string, SearchResult[]>();
    const top10LenByQueryId = new Map<string, number>();
    const longDocRatioByQueryId = new Map<string, number>();

    for (const gt of groundTruths) {
      const qrow = queries.find(q => q.query_id === gt.queryId);
      const queryText = qrow?.query ?? gt.queryId;
      const sr = await searchEngine.search(this.db, {
        query: queryText,
        limit: 20,
        provider_filter: getBenchmarkVectorProviderFilter(),
        ...(options?.vectorWeight !== undefined ? { vectorWeight: options.vectorWeight } : {}),
        ...(options?.textWeight !== undefined ? { textWeight: options.textWeight } : {}),
      });
      const mapped: SearchResult[] = sr.items.map((item) => ({
        id: memoryIdToBenchmarkId.get(item.id) ?? item.id,
        score: item.finalScore
      }));
      queryResultsByQueryId.set(gt.queryId, mapped);
      top10LenByQueryId.set(gt.queryId, meanTop10ContentLength(sr.items));
      longDocRatioByQueryId.set(gt.queryId, top10LongDocRatio(sr.items));
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
      const authored = authoredByMacro.get(macro) ?? 0;
      // #934: empty scored bucket still emits a row so coverage denominator keeps authored count
      if (subsetGts.length === 0) {
        logger.warn('Ground Truth 없는 카테고리 — scored=0으로 리포트에 유지', {
          macro_category: macro,
          authored_query_count: authored,
        });
        reports.push({
          macro_category: macro,
          query_count: 0,
          authored_query_count: authored,
          mrr: 0,
          ndcg_at_5: 0,
          ndcg_at_10: 0,
          mean_top10_content_length: 0,
          mean_top10_long_doc_ratio: 0,
          threshold_passed: false,
        });
        continue;
      }
      const subMap = new Map<string, SearchResult[]>();
      for (const gt of subsetGts) {
        const r = queryResultsByQueryId.get(gt.queryId);
        if (r) {
          subMap.set(gt.queryId, r);
        }
      }

      const mrr = calculateMRR(subMap, subsetGts);

      let ndcg5 = 0;
      let ndcg10 = 0;
      const ndcgDenom = subsetGts.length;
      let top10LenSum = 0;
      let longDocRatioSum = 0;
      for (const gt of subsetGts) {
        const results = queryResultsByQueryId.get(gt.queryId);
        if (!results || results.length === 0) {
          continue;
        }
        ndcg5 += calculateNDCGAtK(results, gt.relevantIds, 5);
        ndcg10 += calculateNDCGAtK(results, gt.relevantIds, 10);
        top10LenSum += top10LenByQueryId.get(gt.queryId) ?? 0;
        longDocRatioSum += longDocRatioByQueryId.get(gt.queryId) ?? 0;
      }

      const mrrVal = mrr;
      reports.push({
        macro_category: macro,
        query_count: subsetGts.length,
        authored_query_count: authored,
        mrr: mrrVal,
        ndcg_at_5: ndcgDenom > 0 ? ndcg5 / ndcgDenom : 0,
        ndcg_at_10: ndcgDenom > 0 ? ndcg10 / ndcgDenom : 0,
        mean_top10_content_length: ndcgDenom > 0 ? top10LenSum / ndcgDenom : 0,
        mean_top10_long_doc_ratio: ndcgDenom > 0 ? longDocRatioSum / ndcgDenom : 0,
        threshold_passed: mrrVal >= MRR_THRESHOLD
      });
    }

    return reports;
  }
}

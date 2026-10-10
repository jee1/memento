/* eslint-disable security/detect-non-literal-fs-filename -- 품질 리포트·벤치마크 경로는 고정 디렉터리와 운영자 스크립트 인자에서 온다. HTTP·MCP 입력이 닿지 않는다. */
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
  type GroundTruth,
  type SearchResult,
} from './search-quality-metrics.js';
import {
  loadBenchmarkCorpus,
  loadBenchmarkQueries,
  type BenchmarkCorpusEntry,
  type BenchmarkQuery,
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

interface CategoryMapping {
  macro_categories: Record<string, string[]>;
  query_overrides?: Record<string, string>;
  /** FR-005: queries.json 변경 없이 query_id → 카테고리 라벨(사람 유지) */
  query_id_to_category: Record<string, string>;
}

/** 쿼리 하나의 검색 결과와 길이 편향 지표 */
interface CategorySearchOutcome {
  results: SearchResult[];
  top10Length: number;
  longDocRatio: number;
}

const ALL_MACROS: MacroCategory[] = [
  'incident_ops',
  'procedural',
  'conceptual',
  'tag_filter'
];
const MRR_THRESHOLD = 0.5;

/** relevantIds 가 있고, maxGroundTruthLength 가 있으면 GT 문서 최대 길이가 그 이하인 쿼리만 남긴다. */
function selectScoredGroundTruths(
  benchmarkDir: string,
  corpus: BenchmarkCorpusEntry[],
  maxGroundTruthLength: number | undefined
): GroundTruth[] {
  const benchmarkIdToLength = new Map(
    corpus.map((e) => [e.benchmark_id, (e.content ?? '').length])
  );
  const gtMaxLen = (ids: string[]): number =>
    ids.reduce((m, id) => Math.max(m, benchmarkIdToLength.get(id) ?? 0), 0);

  return normalizeBenchmarkGroundTruths(benchmarkDir)
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
        maxGroundTruthLength === undefined ||
        gtMaxLen(gt.relevantIds) <= maxGroundTruthLength
    );
}

/** query_id 와 쿼리 본문 → macro. 매핑이 빠졌거나 macro 가 잘못되면 throw. */
function buildQueryMacroMap(queries: BenchmarkQuery[], mapping: CategoryMapping): Map<string, MacroCategory> {
  const categoryToMacro = new Map<string, MacroCategory>();
  for (const [macro, cats] of Object.entries(mapping.macro_categories)) {
    const macroKey = assertMacroCategory(macro, 'macro_categories key');
    for (const c of cats) {
      categoryToMacro.set(c, macroKey);
    }
  }

  for (const [qid, v] of Object.entries(mapping.query_overrides ?? {})) {
    if (v !== undefined) {
      assertMacroCategory(v, `query_overrides[${qid}]`);
    }
  }

  const queryIdToMacro = new Map<string, MacroCategory>();
  for (const q of queries) {
    const categoryLabel = mapping.query_id_to_category?.[q.query_id];
    if (!categoryLabel) {
      throw new Error(
        `Category mapping missing query_id_to_category for query ${q.query_id}`
      );
    }
    const overrideRaw = mapping.query_overrides?.[q.query_id];
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
  return queryIdToMacro;
}

/** #961: short-only 서브셋에서는 authored도 같은 술어로 걸러 coverage 게이트가 죽지 않게 한다 */
function countAuthoredByMacro(
  queries: BenchmarkQuery[],
  queryIdToMacro: Map<string, MacroCategory>,
  groundTruths: GroundTruth[],
  maxGroundTruthLength: number | undefined
): Map<MacroCategory, number> {
  const scoredQueryKeys = new Set(groundTruths.map((gt) => gt.queryId));
  const authoredByMacro = new Map<MacroCategory, number>();
  for (const q of queries) {
    if (
      maxGroundTruthLength !== undefined &&
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
  return authoredByMacro;
}

function emptyMacroReport(macro: MacroCategory, authored: number): CategoryQualityReport {
  // #934: empty scored bucket still emits a row so coverage denominator keeps authored count
  logger.warn('Ground Truth 없는 카테고리 — scored=0으로 리포트에 유지', {
    macro_category: macro,
    authored_query_count: authored,
  });
  return {
    macro_category: macro,
    query_count: 0,
    authored_query_count: authored,
    mrr: 0,
    ndcg_at_5: 0,
    ndcg_at_10: 0,
    mean_top10_content_length: 0,
    mean_top10_long_doc_ratio: 0,
    threshold_passed: false,
  };
}

/** NDCG·길이 지표는 결과 없는 쿼리를 0 으로 세고 subset 전체 수로 나눈다. */
function buildMacroReport(
  macro: MacroCategory,
  subsetGts: GroundTruth[],
  authored: number,
  outcomes: Map<string, CategorySearchOutcome>
): CategoryQualityReport {
  if (subsetGts.length === 0) {
    return emptyMacroReport(macro, authored);
  }

  const subMap = new Map<string, SearchResult[]>();
  let ndcg5 = 0;
  let ndcg10 = 0;
  let top10LenSum = 0;
  let longDocRatioSum = 0;
  for (const gt of subsetGts) {
    const outcome = outcomes.get(gt.queryId);
    if (!outcome) continue;
    subMap.set(gt.queryId, outcome.results);
    if (outcome.results.length === 0) continue;
    ndcg5 += calculateNDCGAtK(outcome.results, gt.relevantIds, 5);
    ndcg10 += calculateNDCGAtK(outcome.results, gt.relevantIds, 10);
    top10LenSum += outcome.top10Length;
    longDocRatioSum += outcome.longDocRatio;
  }

  const mrr = calculateMRR(subMap, subsetGts);
  const n = subsetGts.length;
  return {
    macro_category: macro,
    query_count: n,
    authored_query_count: authored,
    mrr,
    ndcg_at_5: ndcg5 / n,
    ndcg_at_10: ndcg10 / n,
    mean_top10_content_length: top10LenSum / n,
    mean_top10_long_doc_ratio: longDocRatioSum / n,
    threshold_passed: mrr >= MRR_THRESHOLD
  };
}

export class CategoryQualityAggregator {
  constructor(private db: Database.Database) {}

  async collect(
    benchmarkDir: string,
    mappingPath: string,
    options?: CategoryMetricsOptions
  ): Promise<CategoryQualityReport[]> {
    const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as CategoryMapping;
    const queries = loadBenchmarkQueries(benchmarkDir);
    const corpus = loadBenchmarkCorpus(benchmarkDir);
    const groundTruths = selectScoredGroundTruths(benchmarkDir, corpus, options?.maxGroundTruthLength);
    const queryIdToMacro = buildQueryMacroMap(queries, mapping);
    const authoredByMacro = countAuthoredByMacro(queries, queryIdToMacro, groundTruths, options?.maxGroundTruthLength);
    const outcomes = await this.runCategorySearches(groundTruths, queries, corpus, options);

    return ALL_MACROS.map((macro) =>
      buildMacroReport(
        macro,
        groundTruths.filter(gt => queryIdToMacro.get(gt.queryId) === macro),
        authoredByMacro.get(macro) ?? 0,
        outcomes
      )
    );
  }

  /** ground truth 쿼리를 순서대로 검색한다. 결과 id 는 benchmark id 로 바꾼다. */
  private async runCategorySearches(
    groundTruths: GroundTruth[],
    queries: BenchmarkQuery[],
    corpus: BenchmarkCorpusEntry[],
    options: CategoryMetricsOptions | undefined
  ): Promise<Map<string, CategorySearchOutcome>> {
    const memoryIdToBenchmarkId = new Map(corpus.map((e) => [e.source_memory_id, e.benchmark_id]));
    const queryById = new Map<string, BenchmarkQuery>();
    for (const q of queries) {
      if (!queryById.has(q.query_id)) queryById.set(q.query_id, q);
    }

    // #961 R4: AdaptiveWeightCalculator caches by query string — callers must use a fresh
    // engine per arm. createDefaultEngine here is per collect() call (sweep creates new collector).
    const searchEngine = HybridSearchFactory.createDefaultEngine(this.db);
    const outcomes = new Map<string, CategorySearchOutcome>();

    for (const gt of groundTruths) {
      const queryText = queryById.get(gt.queryId)?.query ?? gt.queryId;
      const sr = await searchEngine.search(this.db, {
        query: queryText,
        limit: 20,
        provider_filter: getBenchmarkVectorProviderFilter(),
        ...(options?.vectorWeight !== undefined ? { vectorWeight: options.vectorWeight } : {}),
        ...(options?.textWeight !== undefined ? { textWeight: options.textWeight } : {}),
      });
      outcomes.set(gt.queryId, {
        results: sr.items.map((item) => ({
          id: memoryIdToBenchmarkId.get(item.id) ?? item.id,
          score: item.finalScore
        })),
        top10Length: meanTop10ContentLength(sr.items),
        longDocRatio: top10LongDocRatio(sr.items),
      });
    }
    return outcomes;
  }
}

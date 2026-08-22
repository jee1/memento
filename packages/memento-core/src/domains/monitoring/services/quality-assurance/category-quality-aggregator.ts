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

export class CategoryQualityAggregator {
  constructor(private db: Database.Database) {}

  async collect(
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
    const groundTruths = normalizeBenchmarkGroundTruths(benchmarkDir).filter((groundTruth) => {
      if (groundTruth.relevantIds.length > 0) {
        return true;
      }
      logger.warn('카테고리 품질 측정에서 Ground Truth 없는 쿼리 제외', {
        query: groundTruth.queryId,
      });
      return false;
    });
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
      if (subsetGts.length === 0) {
        logger.warn('Ground Truth 없는 카테고리는 품질 측정에서 제외', { macro_category: macro });
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

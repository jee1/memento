#!/usr/bin/env node
import { isMain } from './lib/cli.js';
/**
 * issue 1107: mean pooling vs max-sim 코사인 랭킹 비교 harness.
 * stdout은 JSON만; 게이트·non-zero exit 없음(측정 전용).
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { MiniLMEmbeddingService } from '@memento/core/domains/embedding/services/minilm-embedding-service.js';
import {
  loadBenchmarkGroundTruth,
  loadBenchmarkQueries,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import { calculateMRR } from '@memento/core/domains/monitoring/services/quality-assurance/search-metrics-collector.js';
import {
  calculateNDCGAtK,
  type GroundTruth,
  type SearchResult,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-metrics.js';
import {
  assertMacroCategory,
  resolveBenchmarkEmbeddingProvider,
  type MacroCategory,
} from '@memento/core/shared/types/benchmark.types.js';
import { createSeededBenchmarkDatabase } from './lib/benchmark-search-database.js';
import {
  loadCorpusWindowVectors,
  rankByScore,
  scoreCorpus,
  type MaxsimCorpusStats,
} from './lib/maxsim-measurement.js';
import { BENCHMARK_V3_DIR } from './lib/rejection-baseline-database.js';

const TOP_N = 20;
const MRR_THRESHOLD = 0.5;

const ALL_MACROS: MacroCategory[] = [
  'incident_ops',
  'procedural',
  'conceptual',
  'tag_filter',
];

/** issue 1107: macro별 mean·max-sim arm MRR·NDCG */
export interface MaxsimArmMetrics {
  mrr: number;
  ndcg_at_5: number;
  ndcg_at_10: number;
}

/** issue 1107: 쿼리별 mean pooling vs max-sim 순위 비교 행 */
export interface MaxsimQueryRow {
  query_id: string;
  query: string;
  macro_category: string;
  mean_rank: number | null;
  maxsim_rank: number | null;
  rank_delta: number | null;
}

/** issue 1107: macro_category 집계 행 */
export interface MaxsimMacroRow {
  macro_category: string;
  query_count: number;
  authored_query_count: number;
  mean: MaxsimArmMetrics;
  maxsim: MaxsimArmMetrics;
  mean_gate_passed: boolean;
  maxsim_gate_passed: boolean;
}

/** issue 1107: max-sim 벤치마크 JSON 리포트 */
export interface MaxsimReport {
  generated_at: string;
  model: string;
  benchmark_dir: string;
  corpus: MaxsimCorpusStats;
  queries: MaxsimQueryRow[];
  macro: MaxsimMacroRow[];
  overall: { mean_mrr: number; maxsim_mrr: number };
}

interface CategoryMappingJson {
  macro_categories: Record<string, string[]>;
  query_overrides?: Record<string, string>;
  query_id_to_category: Record<string, string>;
}

interface MaxsimPerQueryInput {
  queryId: string;
  queryText: string;
  meanRanking: Array<{ id: string; score: number }>;
  maxsimRanking: Array<{ id: string; score: number }>;
}

function loadCategoryMapping(benchmarkDir: string): CategoryMappingJson {
  const mappingPath = join(benchmarkDir, 'category-mapping.json');
  return JSON.parse(readFileSync(mappingPath, 'utf8')) as CategoryMappingJson;
}

function buildQueryIdToMacro(
  benchmarkDir: string,
  mapping: CategoryMappingJson
): Map<string, MacroCategory | 'unmapped'> {
  const queries = loadBenchmarkQueries(benchmarkDir);
  const categoryToMacro = new Map<string, MacroCategory>();
  for (const [macro, categories] of Object.entries(mapping.macro_categories)) {
    const macroKey = assertMacroCategory(macro, 'macro_categories key');
    for (const category of categories) {
      categoryToMacro.set(category, macroKey);
    }
  }

  const queryIdToMacro = new Map<string, MacroCategory | 'unmapped'>();
  for (const query of queries) {
    const categoryLabel = mapping.query_id_to_category?.[query.query_id];
    if (!categoryLabel) {
      throw new Error(
        `Category mapping missing query_id_to_category for query ${query.query_id}`
      );
    }
    const overrideRaw = mapping.query_overrides?.[query.query_id];
    const macro =
      overrideRaw !== undefined
        ? assertMacroCategory(overrideRaw, `query_overrides[${query.query_id}]`)
        : categoryToMacro.get(categoryLabel);
    if (!macro) {
      throw new Error(
        `Category mapping missing macro for query ${query.query_id} (category=${categoryLabel})`
      );
    }
    queryIdToMacro.set(query.query_id, macro);
    if (query.query) {
      queryIdToMacro.set(query.query, macro);
    }
  }
  return queryIdToMacro;
}

function buildAuthoredByMacro(
  benchmarkDir: string,
  queryIdToMacro: Map<string, MacroCategory | 'unmapped'>
): Map<MacroCategory | 'unmapped', number> {
  const queries = loadBenchmarkQueries(benchmarkDir);
  const authoredByMacro = new Map<MacroCategory | 'unmapped', number>();
  for (const query of queries) {
    const macro = queryIdToMacro.get(query.query_id);
    if (macro) {
      authoredByMacro.set(macro, (authoredByMacro.get(macro) ?? 0) + 1);
    }
  }
  return authoredByMacro;
}

function findBestRank(
  ranking: Array<{ id: string; score: number }>,
  relevantIds: string[],
  topN: number
): number | null {
  const relevantSet = new Set(relevantIds);
  const limit = Math.min(ranking.length, topN);
  for (let index = 0; index < limit; index++) {
    const row = ranking[index];
    if (row && relevantSet.has(row.id)) {
      return index + 1;
    }
  }
  return null;
}

function toSearchResults(
  ranking: Array<{ id: string; score: number }>
): SearchResult[] {
  return ranking.map((row) => ({ id: row.id, score: row.score }));
}

function computeArmMetrics(
  resultsMap: Map<string, SearchResult[]>,
  subsetGts: GroundTruth[]
): MaxsimArmMetrics {
  if (subsetGts.length === 0) {
    return { mrr: 0, ndcg_at_5: 0, ndcg_at_10: 0 };
  }

  const mrr = calculateMRR(resultsMap, subsetGts);
  let ndcg5 = 0;
  let ndcg10 = 0;
  for (const groundTruth of subsetGts) {
    const results = resultsMap.get(groundTruth.queryId) ?? [];
    ndcg5 += calculateNDCGAtK(results, groundTruth.relevantIds, 5);
    ndcg10 += calculateNDCGAtK(results, groundTruth.relevantIds, 10);
  }
  const denom = subsetGts.length;
  return {
    mrr,
    ndcg_at_5: ndcg5 / denom,
    ndcg_at_10: ndcg10 / denom,
  };
}

function emptyArmMetrics(): MaxsimArmMetrics {
  return { mrr: 0, ndcg_at_5: 0, ndcg_at_10: 0 };
}

/**
 * issue 1107: 벤치마크 픽스처·per-query 랭킹으로 max-sim 리포트를 순수 함수로 조립한다.
 * 모델·DB 없이 spec에서 호출 가능하다.
 */
export function buildMaxsimReport(input: {
  benchmarkDir: string;
  model: string;
  corpusStats: MaxsimCorpusStats;
  /** one entry per benchmark query that has ground truth */
  perQuery: MaxsimPerQueryInput[];
}): MaxsimReport {
  const mapping = loadCategoryMapping(input.benchmarkDir);
  const queries = loadBenchmarkQueries(input.benchmarkDir);
  const queryByText = new Map(queries.map((query) => [query.query, query]));
  const queryIdToMacro = buildQueryIdToMacro(input.benchmarkDir, mapping);
  const authoredByMacro = buildAuthoredByMacro(input.benchmarkDir, queryIdToMacro);

  const groundTruths = loadBenchmarkGroundTruth(input.benchmarkDir).filter(
    (groundTruth) => groundTruth.relevantIds.length > 0
  );

  const perQueryByText = new Map(input.perQuery.map((row) => [row.queryText, row]));
  const perQueryByQueryId = new Map(input.perQuery.map((row) => [row.queryId, row]));

  const meanResultsMap = new Map<string, SearchResult[]>();
  const maxsimResultsMap = new Map<string, SearchResult[]>();
  const queryRows: MaxsimQueryRow[] = [];
  let unmappedCount = 0;

  for (const groundTruth of groundTruths) {
    const queryRow = queryByText.get(groundTruth.queryId);
    const perQueryRow =
      perQueryByText.get(groundTruth.queryId) ??
      (queryRow ? perQueryByQueryId.get(queryRow.query_id) : undefined);

    const resolvedQueryId = queryRow?.query_id ?? groundTruth.queryId;
    const macroCategory = queryRow
      ? (queryIdToMacro.get(queryRow.query_id) ??
        queryIdToMacro.get(groundTruth.queryId) ??
        'unmapped')
      : 'unmapped';

    if (macroCategory === 'unmapped') {
      unmappedCount++;
    }

    let meanRank: number | null = null;
    let maxsimRank: number | null = null;
    if (perQueryRow) {
      meanRank = findBestRank(perQueryRow.meanRanking, groundTruth.relevantIds, TOP_N);
      maxsimRank = findBestRank(perQueryRow.maxsimRanking, groundTruth.relevantIds, TOP_N);
      meanResultsMap.set(groundTruth.queryId, toSearchResults(perQueryRow.meanRanking));
      maxsimResultsMap.set(groundTruth.queryId, toSearchResults(perQueryRow.maxsimRanking));
    }

    const rankDelta =
      meanRank !== null && maxsimRank !== null ? meanRank - maxsimRank : null;

    queryRows.push({
      query_id: resolvedQueryId,
      query: groundTruth.queryId,
      macro_category: macroCategory,
      mean_rank: meanRank,
      maxsim_rank: maxsimRank,
      rank_delta: rankDelta,
    });
  }

  const macroRows: MaxsimMacroRow[] = ALL_MACROS.map((macroCategory) => {
    const subsetGts = groundTruths.filter((groundTruth) => {
      const queryRow = queryByText.get(groundTruth.queryId);
      const resolvedMacro = queryRow
        ? (queryIdToMacro.get(queryRow.query_id) ??
          queryIdToMacro.get(groundTruth.queryId))
        : undefined;
      return resolvedMacro === macroCategory;
    });
    const authored = authoredByMacro.get(macroCategory) ?? 0;

    if (subsetGts.length === 0) {
      return {
        macro_category: macroCategory,
        query_count: 0,
        authored_query_count: authored,
        mean: emptyArmMetrics(),
        maxsim: emptyArmMetrics(),
        mean_gate_passed: false,
        maxsim_gate_passed: false,
      };
    }

    const meanMetrics = computeArmMetrics(meanResultsMap, subsetGts);
    const maxsimMetrics = computeArmMetrics(maxsimResultsMap, subsetGts);
    return {
      macro_category: macroCategory,
      query_count: subsetGts.length,
      authored_query_count: authored,
      mean: meanMetrics,
      maxsim: maxsimMetrics,
      mean_gate_passed: meanMetrics.mrr >= MRR_THRESHOLD,
      maxsim_gate_passed: maxsimMetrics.mrr >= MRR_THRESHOLD,
    };
  });

  if (unmappedCount > 0) {
    const subsetGts = groundTruths.filter((groundTruth) => !queryByText.get(groundTruth.queryId));
    const meanMetrics = computeArmMetrics(meanResultsMap, subsetGts);
    const maxsimMetrics = computeArmMetrics(maxsimResultsMap, subsetGts);
    macroRows.push({
      macro_category: 'unmapped',
      query_count: subsetGts.length,
      authored_query_count: authoredByMacro.get('unmapped') ?? 0,
      mean: meanMetrics,
      maxsim: maxsimMetrics,
      mean_gate_passed: meanMetrics.mrr >= MRR_THRESHOLD,
      maxsim_gate_passed: maxsimMetrics.mrr >= MRR_THRESHOLD,
    });
  }

  return {
    generated_at: new Date().toISOString(),
    model: input.model,
    benchmark_dir: input.benchmarkDir,
    corpus: input.corpusStats,
    queries: queryRows,
    macro: macroRows,
    overall: {
      mean_mrr: calculateMRR(meanResultsMap, groundTruths),
      maxsim_mrr: calculateMRR(maxsimResultsMap, groundTruths),
    },
  };
}

/** issue 1107: stdout에 JSON 한 줄을 쓴다(개행 포함). */
export function emitMaxsimJson(json: string): void {
  process.stdout.write(`${json}\n`);
}

async function openBenchmarkDatabase(benchmarkDir: string): Promise<{
  db: Database.Database;
  close: () => void;
}> {
  const reusePath = process.env.MEMENTO_BENCHMARK_DB_PATH?.trim();
  if (reusePath && existsSync(reusePath)) {
    process.stderr.write(`[maxsim] using existing database: ${reusePath}\n`);
    const db = new Database(reusePath, { readonly: true });
    return {
      db,
      close: () => {
        db.close();
      },
    };
  }

  process.stderr.write('[maxsim] seeding fresh benchmark database\n');
  const seeded = await createSeededBenchmarkDatabase(benchmarkDir);
  return {
    db: seeded.db,
    close: seeded.close,
  };
}

/** issue 1107: 코퍼스·쿼리 임베딩 측정 후 JSON 문자열을 반환한다. */
export async function runMaxsimMeasurement(options?: {
  benchmarkDir?: string;
  jsonOutPath?: string;
}): Promise<string> {
  const benchmarkDir = options?.benchmarkDir ?? BENCHMARK_V3_DIR;
  const model = resolveBenchmarkEmbeddingProvider();
  const { db, close } = await openBenchmarkDatabase(benchmarkDir);

  try {
    const { docs, stats } = await loadCorpusWindowVectors(db, benchmarkDir, {
      onProgress: (done, total) => {
        process.stderr.write(`[maxsim] corpus vectors ${done}/${total}\n`);
      },
    });

    if (stats.documentCount === 0) {
      throw new Error(
        'Seeded database has no minilm embeddings for this corpus'
      );
    }
    if (stats.reproductionMismatchCount > 0) {
      process.stderr.write(
        `[maxsim] warning: reproductionMismatchCount=${stats.reproductionMismatchCount}\n`
      );
    }

    const queries = loadBenchmarkQueries(benchmarkDir);
    const queryByText = new Map(queries.map((query) => [query.query, query]));
    const groundTruths = loadBenchmarkGroundTruth(benchmarkDir).filter(
      (groundTruth) => groundTruth.relevantIds.length > 0
    );
    const embeddingService = new MiniLMEmbeddingService();

    const perQuery: MaxsimPerQueryInput[] = [];
    for (const groundTruth of groundTruths) {
      const queryRow = queryByText.get(groundTruth.queryId);
      const embedding = await embeddingService.generateEmbedding(groundTruth.queryId);
      if (!embedding) {
        throw new Error(`Failed to embed query: ${groundTruth.queryId}`);
      }
      const queryVector = Float32Array.from(embedding.embedding);
      const scored = scoreCorpus(queryVector, docs);
      perQuery.push({
        queryId: queryRow?.query_id ?? groundTruth.queryId,
        queryText: groundTruth.queryId,
        meanRanking: rankByScore(scored, 'meanScore', TOP_N),
        maxsimRanking: rankByScore(scored, 'maxsimScore', TOP_N),
      });
    }

    const report = buildMaxsimReport({
      benchmarkDir,
      model,
      corpusStats: stats,
      perQuery,
    });
    const json = JSON.stringify(report, null, 2);
    if (options?.jsonOutPath) {
      writeFileSync(options.jsonOutPath, `${json}\n`, 'utf8');
    }
    return json;
  } finally {
    close();
  }
}

async function main(): Promise<void> {
  const jsonOut = process.env.MEMENTO_MAXSIM_JSON?.trim();
  const json = await runMaxsimMeasurement({
    jsonOutPath: jsonOut || undefined,
  });
  emitMaxsimJson(json);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

#!/usr/bin/env node
import { isMain, parseArgs as parseCliArgs, type CliDatabase } from './lib/cli.js';
/**
 * 두 랭킹 프로파일을 benchmark-v3로 비교 — MRR·NDCG·paired permutation test
 *
 * 사용: npm run quality -- benchmark compare-profiles -- --profile-a default --profile-b feedback-heavy
 *
 * DB는 운영 DB_PATH가 아니라 corpus.jsonl을 시드한 임시 DB만 사용한다.
 *
 * 출력은 JSON stdout에 통계 필드와 verdict(a_better | b_better | inconclusive)만 포함한다.
 * `config/ranking-weights.toml` 및 `config/ranking-profiles/*.toml`은 자동 갱신하지 않는다(오프라인 A/B).
 *
 * US4 / CI 기준선 반영(수동 운영):
 * 1) `mrr_significant`·`mrr_p_value`·`verdict` 확인
 * 2) 우승 프로파일 TOML 내용을 `config/ranking-weights.toml`에 반영(필요 시 `default.toml` 동기화)
 * 3) PR 머지 — CI는 머지된 커밋의 TOML을 읽는다
 * 상세: `https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/specs/004-recall-quality-feedback-loop/contracts/mcp-tools.md` §3.3
 */

import { existsSync } from 'fs';
import { join, dirname, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { createSeededBenchmarkDatabase } from './lib/benchmark-search-database.js';
import { HybridSearchFactory } from '@memento/core/domains/search/factories/hybrid-search.factory.js';
import { sqliteRepositoryProvider } from '@memento/core';
import {
  loadBenchmarkCorpus,
  loadBenchmarkQueries,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import { normalizeBenchmarkGroundTruths } from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-review-verifier.js';
import {
  calculateNDCGAtK,
  calculateRecallAtK,
  type SearchResult,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-metrics.js';
import { resetRankingWeightsCache } from '@memento/core/shared/config/ranking-weights-loader.js';
import { getBenchmarkVectorProviderFilter } from '@memento/core/shared/types/benchmark.types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BENCHMARK_DIR = join(ROOT, 'tests/fixtures/search-quality/benchmark-v3');
const PROFILES_DIR = join(ROOT, 'config/ranking-profiles');

const PERM_ITER = 10_000;

export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface ProfileEvalResult {
  mrr: number;
  ndcg_at_5: number;
  ndcg_at_10: number;
  recall_at_10: number;
  empty_result_rate: number;
  latency_ms: number[];
  p95_latency_ms: number;
  rr: number[];
  ndcg_at_10_per_query: number[];
  recall_at_10_per_query: number[];
  /** 아래 배열은 모두 query_ids 와 같은 순서(쿼리당 1개). */
  query_ids: string[];
  empty_per_query: number[];
  /** top-10 안에서 relevance 컴포넌트 점수가 같은(|차|<1e-9) 쌍 수 */
  relevance_tie_pairs: number[];
  /** top-10 안의 전체 쌍 수 */
  pairs: number[];
}

const RELEVANCE_TIE_EPSILON = 1e-9;

export function countRelevanceTies(scores: number[]): { tied: number; pairs: number } {
  let tied = 0;
  let pairs = 0;
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      pairs++;
      if (Math.abs(scores[i]! - scores[j]!) < RELEVANCE_TIE_EPSILON) tied++;
    }
  }
  return { tied, pairs };
}

/** 지정한 query_id 만 남긴 결과를 새로 집계한다 (explore/judge 부분집합 평가용). */
export function restrictEvalToQueries(r: ProfileEvalResult, ids: readonly string[]): ProfileEvalResult {
  const keep = new Set(ids);
  const idx = r.query_ids.flatMap((id, i) => (keep.has(id) ? [i] : []));
  const pick = <T,>(arr: T[]): T[] => idx.map((i) => arr[i]!);
  const rr = pick(r.rr);
  const ndcg = pick(r.ndcg_at_10_per_query);
  const recall = pick(r.recall_at_10_per_query);
  const empty = pick(r.empty_per_query);
  const latency = pick(r.latency_ms);
  return {
    ...r,
    mrr: mean(rr),
    ndcg_at_10: mean(ndcg),
    recall_at_10: mean(recall),
    empty_result_rate: mean(empty),
    latency_ms: latency,
    p95_latency_ms: calcP95(latency),
    rr,
    ndcg_at_10_per_query: ndcg,
    recall_at_10_per_query: recall,
    query_ids: pick(r.query_ids),
    empty_per_query: empty,
    relevance_tie_pairs: pick(r.relevance_tie_pairs),
    pairs: pick(r.pairs),
  };
}

export function calcP95(latencyMs: number[]): number {
  if (latencyMs.length === 0) return 0;
  const sorted = [...latencyMs].sort((a, b) => a - b);
  // nearest-rank method: ceil(n * 0.95) - 1
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)]!;
}

export function pairedPermutationPValue(
  rrA: number[],
  rrB: number[],
  iterations: number,
  rng: () => number = Math.random,
): number {
  const n = rrA.length;
  if (n === 0) {
    return 1;
  }
  const diff = rrA.map((a, i) => a - rrB[i]!);
  const observed = Math.abs(mean(diff));
  if (observed < 1e-12) {
    return 1;
  }
  let count = 0;
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const flip = rng() < 0.5 ? 1 : -1;
      s += diff[i]! * flip;
    }
    if (Math.abs(s / n) >= observed - 1e-12) {
      count++;
    }
  }
  return count / iterations;
}

export interface EvaluateProfileOptions {
  /** 주어지면 이 id 의 쿼리만 검색을 실행한다. 나머지는 실행하지 않는다(실행 뒤 거르지 않는다). */
  queryIds?: readonly string[];
}

export async function evaluateProfile(
  db: CliDatabase,
  profilePath: string,
  benchmarkDir: string = BENCHMARK_DIR,
  options: EvaluateProfileOptions = {},
): Promise<ProfileEvalResult> {
  // 랭킹 신호 대부분이 getRankingWeights()를 무인자로 읽으므로 경로 인자가 아니라 env로 프로파일 전체를 적용한다.
  const prevEnvPath = process.env.MEMENTO_RANKING_WEIGHTS_PATH;
  process.env.MEMENTO_RANKING_WEIGHTS_PATH = resolve(profilePath);
  resetRankingWeightsCache();
  try {
    return await evaluateProfileWithActiveWeights(db, benchmarkDir, options.queryIds);
  } finally {
    if (prevEnvPath === undefined) delete process.env.MEMENTO_RANKING_WEIGHTS_PATH;
    else process.env.MEMENTO_RANKING_WEIGHTS_PATH = prevEnvPath;
    resetRankingWeightsCache();
  }
}

function selectGroundTruths<T extends { queryId: string }>(
  all: T[],
  queryIds: readonly string[] | undefined,
  toQueryId: (gt: T) => string,
): T[] {
  if (!queryIds) return all;
  const wanted = new Set(queryIds);
  const picked = all.filter((gt) => wanted.has(toQueryId(gt)));
  if (picked.length !== wanted.size) {
    const known = new Set(picked.map(toQueryId));
    throw new Error(`ground truth 에 없는 query id: ${[...wanted].filter((id) => !known.has(id)).join(', ')}`);
  }
  return picked;
}

async function evaluateProfileWithActiveWeights(
  db: CliDatabase,
  benchmarkDir: string,
  queryIds?: readonly string[],
): Promise<ProfileEvalResult> {
  const queries = loadBenchmarkQueries(benchmarkDir);
  const corpus = loadBenchmarkCorpus(benchmarkDir);
  const memoryIdToBenchmarkId = new Map(corpus.map((e) => [e.source_memory_id, e.benchmark_id]));
  const qById = new Map(queries.map((q) => [q.query_id, q]));
  const queryTextToId = new Map(queries.map((q) => [q.query, q.query_id]));
  const groundTruths = selectGroundTruths(
    normalizeBenchmarkGroundTruths(benchmarkDir),
    queryIds,
    (gt) => queryTextToId.get(gt.queryId) ?? gt.queryId,
  );

  const searchEngine = HybridSearchFactory.createDefaultEngine(sqliteRepositoryProvider);
  const queryResults = new Map<string, SearchResult[]>();
  const tieByQuery = new Map<string, { tied: number; pairs: number }>();
  const latencyMs: number[] = [];

  for (const gt of groundTruths) {
    const qrow = qById.get(gt.queryId);
    const queryText = qrow?.query ?? gt.queryId;
    const t0 = performance.now();
    const sr = await searchEngine.search(db, {
      query: queryText,
      limit: 20,
      include_score_breakdown: true,
      provider_filter: getBenchmarkVectorProviderFilter(),
    });
    latencyMs.push(performance.now() - t0);
    const mapped: SearchResult[] = sr.items.map((item) => ({
      id: memoryIdToBenchmarkId.get(item.id) ?? item.id,
      score: item.finalScore,
    }));
    queryResults.set(gt.queryId, mapped);
    tieByQuery.set(
      gt.queryId,
      countRelevanceTies(sr.items.slice(0, 10).map((item) => item.score_breakdown?.relevance.score ?? Number.NaN)),
    );
  }

  const rr: number[] = [];
  for (const gt of groundTruths) {
    const results = queryResults.get(gt.queryId) ?? [];
    const relevantSet = new Set(gt.relevantIds);
    let rank = -1;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result && relevantSet.has(result.id)) {
        rank = i + 1;
        break;
      }
    }
    rr.push(rank > 0 ? 1 / rank : 0);
  }

  const denom = groundTruths.length > 0 ? groundTruths.length : 1;
  const mrr = rr.reduce((a, b) => a + b, 0) / denom;

  let ndcg5 = 0;
  let ndcg10 = 0;
  let recall10 = 0;
  let emptyCount = 0;
  const ndcgDenom = groundTruths.length;
  const ndcgAt10PerQuery: number[] = [];
  const recallAt10PerQuery: number[] = [];
  const emptyPerQuery: number[] = [];

  for (const gt of groundTruths) {
    const results = queryResults.get(gt.queryId) ?? [];
    if (results.length === 0) {
      emptyCount++;
      emptyPerQuery.push(1);
      ndcgAt10PerQuery.push(0);
      recallAt10PerQuery.push(0);
      continue;
    }
    const q10 = calculateNDCGAtK(results, gt.relevantIds, 10);
    const r10 = calculateRecallAtK(results, gt.relevantIds, 10);
    ndcg5 += calculateNDCGAtK(results, gt.relevantIds, 5);
    ndcg10 += q10;
    recall10 += r10;
    ndcgAt10PerQuery.push(q10);
    recallAt10PerQuery.push(r10);
    emptyPerQuery.push(0);
  }

  return {
    mrr,
    ndcg_at_5: ndcgDenom > 0 ? ndcg5 / ndcgDenom : 0,
    ndcg_at_10: ndcgDenom > 0 ? ndcg10 / ndcgDenom : 0,
    recall_at_10: ndcgDenom > 0 ? recall10 / ndcgDenom : 0,
    empty_result_rate: ndcgDenom > 0 ? emptyCount / ndcgDenom : 0,
    latency_ms: latencyMs,
    p95_latency_ms: calcP95(latencyMs),
    rr,
    ndcg_at_10_per_query: ndcgAt10PerQuery,
    recall_at_10_per_query: recallAt10PerQuery,
    query_ids: groundTruths.map((gt) => queryTextToId.get(gt.queryId) ?? gt.queryId),
    empty_per_query: emptyPerQuery,
    relevance_tie_pairs: groundTruths.map((gt) => tieByQuery.get(gt.queryId)?.tied ?? 0),
    pairs: groundTruths.map((gt) => tieByQuery.get(gt.queryId)?.pairs ?? 0),
  };
}

/**
 * --profile-a / --profile-b 로 지정한 TOML 경로가 실제로 있어야 한다.
 * 없으면 getRankingWeights()가 기본값으로만 동작해 A/B가 둘 다 default처럼 보일 수 있다.
 */
export function assertRankingProfileFilesExist(pathA: string, pathB: string): void {
  if (!existsSync(pathA)) {
    throw new Error(`랭킹 프로파일 파일을 찾을 수 없습니다: ${pathA}`);
  }
  if (!existsSync(pathB)) {
    throw new Error(`랭킹 프로파일 파일을 찾을 수 없습니다: ${pathB}`);
  }
}

export function parseArgs(argv: string[]): { profileA: string; profileB: string } {
  let profileA = 'default';
  let profileB = 'feedback-heavy';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile-a' && argv[i + 1]) {
      profileA = argv[i + 1]!;
      i++;
    } else if (argv[i] === '--profile-b' && argv[i + 1]) {
      profileB = argv[i + 1]!;
      i++;
    }
  }
  return { profileA, profileB };
}

async function main(): Promise<void> {
  const { profileA, profileB } = parseArgs(parseCliArgs().args);
  const resolveProfile = (nameOrPath: string) =>
    isAbsolute(nameOrPath)
      ? nameOrPath.endsWith('.toml') ? nameOrPath : `${nameOrPath}.toml`
      : join(PROFILES_DIR, `${nameOrPath}.toml`);
  const pathA = resolveProfile(profileA);
  const pathB = resolveProfile(profileB);
  assertRankingProfileFilesExist(pathA, pathB);

  const { db, close } = await createSeededBenchmarkDatabase(BENCHMARK_DIR);
  try {
    const a = await evaluateProfile(db, pathA);
    const b = await evaluateProfile(db, pathB);
    const pVal = pairedPermutationPValue(a.rr, b.rr, PERM_ITER);
    const mrrDelta = b.mrr - a.mrr;

    let verdict: 'a_better' | 'b_better' | 'inconclusive';
    if (pVal > 0.05) {
      verdict = 'inconclusive';
    } else if (mrrDelta < 0) {
      verdict = 'a_better';
    } else if (mrrDelta > 0) {
      verdict = 'b_better';
    } else {
      verdict = 'inconclusive';
    }

    const report = {
      profile_a: profileA,
      profile_b: profileB,
      profile_a_mrr: a.mrr,
      profile_b_mrr: b.mrr,
      profile_a_ndcg_at_5: a.ndcg_at_5,
      profile_b_ndcg_at_5: b.ndcg_at_5,
      profile_a_ndcg_at_10: a.ndcg_at_10,
      profile_b_ndcg_at_10: b.ndcg_at_10,
      mrr_delta: mrrDelta,
      mrr_p_value: pVal,
      mrr_significant: pVal < 0.05,
      verdict,
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    close();
  }
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

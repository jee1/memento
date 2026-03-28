#!/usr/bin/env node
/**
 * 두 랭킹 프로파일을 benchmark-v3로 비교 — MRR·NDCG·paired permutation test
 *
 * 사용: npm run quality:benchmark:compare-profiles -- --profile-a default --profile-b feedback-heavy
 *
 * DB는 운영 DB_PATH가 아니라 corpus.jsonl을 시드한 임시 DB만 사용한다.
 *
 * 출력은 JSON stdout에 통계 필드와 verdict(a_better | b_better | inconclusive)만 포함한다.
 * `config/ranking-weights.toml` 및 `config/ranking-profiles/*.toml`은 자동 갱신하지 않는다(오프라인 A/B).
 *
 * US4 / CI 기준선 반영(수동 운영):
 * 1) `significant`·`p_value`·`verdict` 확인
 * 2) 우승 프로파일 TOML 내용을 `config/ranking-weights.toml`에 반영(필요 시 `default.toml` 동기화)
 * 3) PR 머지 — CI는 머지된 커밋의 TOML을 읽는다
 * 상세: `specs/004-recall-quality-feedback-loop/contracts/mcp-tools.md` §3.3
 */

import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import type Database from 'better-sqlite3';
import { createSeededBenchmarkDatabase } from '@memento/core/test/helpers/benchmark-search-database.js';
import { HybridSearchFactory } from '@memento/core/domains/search/factories/hybrid-search.factory.js';
import {
  loadBenchmarkCorpus,
  loadBenchmarkQueries,
} from '@memento/core/test/helpers/search-quality-benchmark-fixtures.js';
import { normalizeBenchmarkGroundTruths } from '@memento/core/test/helpers/search-quality-review-verifier.js';
import {
  calculateNDCGAtK,
  type SearchResult,
} from '@memento/core/test/helpers/search-quality-metrics.js';
import { resetRankingWeightsCache } from '@memento/core/shared/config/ranking-weights-loader.js';
import { BENCHMARK_OFFLINE_VECTOR_PROVIDER_FILTER } from '@memento/core/shared/types/benchmark.types.js';

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

export function pairedPermutationPValue(rrA: number[], rrB: number[], iterations: number): number {
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
      const flip = Math.random() < 0.5 ? 1 : -1;
      s += diff[i]! * flip;
    }
    if (Math.abs(s / n) >= observed - 1e-12) {
      count++;
    }
  }
  return count / iterations;
}

async function runProfile(
  db: Database.Database,
  profilePath: string
): Promise<{ mrr: number; ndcg5: number; ndcg10: number; rr: number[] }> {
  resetRankingWeightsCache();

  const queries = loadBenchmarkQueries(BENCHMARK_DIR);
  const groundTruths = normalizeBenchmarkGroundTruths(BENCHMARK_DIR);
  const corpus = loadBenchmarkCorpus(BENCHMARK_DIR);
  const memoryIdToBenchmarkId = new Map(corpus.map((e) => [e.source_memory_id, e.benchmark_id]));
  const qById = new Map(queries.map((q) => [q.query_id, q]));

  const searchEngine = HybridSearchFactory.createDefaultEngine(db, undefined, {
    rankingWeightsPath: resolve(profilePath),
  });
  const queryResults = new Map<string, SearchResult[]>();

  for (const gt of groundTruths) {
    const qrow = qById.get(gt.queryId);
    const queryText = qrow?.query ?? gt.queryId;
    const sr = await searchEngine.search(db, {
      query: queryText,
      limit: 20,
      provider_filter: BENCHMARK_OFFLINE_VECTOR_PROVIDER_FILTER,
    });
    const mapped: SearchResult[] = sr.items.map((item) => ({
      id: memoryIdToBenchmarkId.get(item.id) ?? item.id,
      score: item.finalScore,
    }));
    queryResults.set(gt.queryId, mapped);
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
  const ndcgDenom = groundTruths.length;
  for (const gt of groundTruths) {
    const results = queryResults.get(gt.queryId);
    if (!results || results.length === 0) {
      continue;
    }
    ndcg5 += calculateNDCGAtK(results, gt.relevantIds, 5);
    ndcg10 += calculateNDCGAtK(results, gt.relevantIds, 10);
  }

  return {
    mrr,
    ndcg5: ndcgDenom > 0 ? ndcg5 / ndcgDenom : 0,
    ndcg10: ndcgDenom > 0 ? ndcg10 / ndcgDenom : 0,
    rr,
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
  const { profileA, profileB } = parseArgs(process.argv.slice(2));
  const pathA = join(PROFILES_DIR, `${profileA}.toml`);
  const pathB = join(PROFILES_DIR, `${profileB}.toml`);
  assertRankingProfileFilesExist(pathA, pathB);

  const { db, close } = await createSeededBenchmarkDatabase(BENCHMARK_DIR);
  try {
    const a = await runProfile(db, pathA);
    const b = await runProfile(db, pathB);
    const pVal = pairedPermutationPValue(a.rr, b.rr, PERM_ITER);
    /** B − A (리포트 `mrr_delta`와 동일 부호 — 양수면 B가 MRR 우위) */
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
      profile_a_ndcg_at_5: a.ndcg5,
      profile_b_ndcg_at_5: b.ndcg5,
      profile_a_ndcg_at_10: a.ndcg10,
      profile_b_ndcg_at_10: b.ndcg10,
      mrr_delta: mrrDelta,
      p_value: pVal,
      significant: pVal < 0.05,
      verdict,
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    close();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

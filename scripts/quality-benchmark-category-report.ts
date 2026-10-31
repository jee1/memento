#!/usr/bin/env node
import { isMain } from './lib/cli.js';
import { BENCHMARK_REFERENCE_TIME, withBenchmarkClock } from './lib/benchmark-clock.js';
/**
 * macro_category별 MRR·NDCG 리포트.
 * 게이트는 커밋된 baseline 대비 상대 MRR이다. threshold_passed 는 종료에 쓰지 않는다.
 *
 * SC-006: `started` 이후 구간(시드 완료 후 collect~stdout)이 WALL_MS 초과 시 non-zero exit.
 * DB는 DB_PATH가 아니라 benchmark-v3 corpus를 시드한 SQLite만 사용한다.
 * 시드·검색 provider는 EMBEDDING_PROVIDER(unset→minilm)를 따른다(#905).
 *
 * --scope nightly|pr (default nightly)  --write-baseline  --baseline <path>
 * PR은 MEMENTO_BENCHMARK_DB_PATH 를 무시하고 subset 을 시드한다.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { closeDatabase, initializeDatabase, sqliteRepositoryProvider } from '@memento/core';
import type { RankingScopeName, ResolvedRankingScope } from '../packages/memento-core/src/shared/types/benchmark.types.js';
import { resolveBenchmarkEmbeddingProvider } from '../packages/memento-core/src/shared/types/benchmark.types.js';
import { QualityMetricsCollector } from '../packages/memento-core/src/domains/monitoring/services/quality-assurance/quality-metrics-collector.js';
import type { CategoryQualityReport } from '../packages/memento-core/src/shared/types/benchmark.types.js';
import { createSeededBenchmarkDatabase, type BenchmarkSeedOptions } from './lib/benchmark-search-database.js';
import {
  evaluateRanking,
  MIN_QUERY_COVERAGE,
  planRankingRun,
  RANKING_BASELINE_PATH,
  WALL_MS,
} from './lib/quality-baseline.js';

export { MIN_QUERY_COVERAGE, WALL_MS };

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const BENCHMARK_DIR = join(ROOT, 'tests/fixtures/search-quality/benchmark-v3');
const MAPPING_PATH = join(BENCHMARK_DIR, 'category-mapping.json');

export interface CategoryReportArgs {
  readonly scope: RankingScopeName;
  readonly writeBaseline: boolean;
  readonly baselinePath?: string;
}

export function parseCategoryReportArgs(argv: readonly string[]): CategoryReportArgs {
  let scope: RankingScopeName = 'nightly';
  let writeBaseline = false;
  let baselinePath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write-baseline') {
      writeBaseline = true;
      continue;
    }
    if (arg === '--scope') {
      const value = argv[++i];
      if (value !== 'nightly' && value !== 'pr') {
        throw new Error('--scope must be nightly or pr');
      }
      scope = value;
      continue;
    }
    if (arg === '--baseline') {
      const value = argv[++i];
      if (!value) {
        throw new Error('--baseline requires a path');
      }
      baselinePath = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ''}`);
  }
  return { scope, writeBaseline, baselinePath };
}

export function formatCoverageLine(reports: readonly CategoryQualityReport[]): string {
  const scored = reports.reduce((s, r) => s + r.query_count, 0);
  const authored = reports.reduce((s, r) => s + r.authored_query_count, 0);
  const coverage = authored > 0 ? scored / authored : 0;
  return `queries_authored=${authored} queries_scored=${scored} coverage=${coverage.toFixed(3)}`;
}

export function coverageBelowThreshold(reports: readonly CategoryQualityReport[]): boolean {
  const scored = reports.reduce((s, r) => s + r.query_count, 0);
  const authored = reports.reduce((s, r) => s + r.authored_query_count, 0);
  return authored === 0 || scored / authored < MIN_QUERY_COVERAGE;
}

/** #905 contract: embedding_provider=<name> vector_dims=<n> */
export function formatEmbeddingRunHeader(provider: string, vectorDims: number): string {
  return `embedding_provider=${provider} vector_dims=${vectorDims}`;
}

function seedOptionsForScope(scope: ResolvedRankingScope): BenchmarkSeedOptions {
  if (scope.name === 'pr') {
    return { mode: 'subset', corpusBenchmarkIds: scope.corpusBenchmarkIds };
  }
  return { mode: 'fixture' };
}

async function main(): Promise<void> {
  const parsed = parseCategoryReportArgs(process.argv.slice(2));
  const scope = planRankingRun(parsed.scope, BENCHMARK_DIR);
  const reusePath = process.env.MEMENTO_BENCHMARK_DB_PATH?.trim();
  const reuse = scope.name === 'nightly' && !!reusePath && existsSync(reusePath);
  const seeded = reuse
    ? undefined
    : await createSeededBenchmarkDatabase(BENCHMARK_DIR, seedOptionsForScope(scope));
  const db = seeded?.db ?? (await initializeDatabase(reusePath!));
  const close = seeded?.close ?? (() => closeDatabase(db));
  const embeddingProvider = seeded?.embeddingProvider ?? resolveBenchmarkEmbeddingProvider();
  const vectorDims = seeded?.vectorDims ?? 384;
  /** SC-006: 코퍼스 시드 시간은 제외하고 집계·검색 구간만 측정 */
  const started = performance.now();
  try {
    const collector = new QualityMetricsCollector(db, sqliteRepositoryProvider);
    const measurement = await collector.collectCategoryMeasurement(BENCHMARK_DIR, MAPPING_PATH, {
      scope,
    });
    const outcome = evaluateRanking({
      measurement,
      scope,
      seededBenchmarkIds: seeded?.seededBenchmarkIds,
      embeddingProvider,
      baselinePath: parsed.baselinePath ?? RANKING_BASELINE_PATH[scope.name],
      elapsedMs: performance.now() - started,
      writeBaseline: parsed.writeBaseline,
    });
    console.log(formatEmbeddingRunHeader(embeddingProvider, vectorDims));
    console.log(`reference_time=${BENCHMARK_REFERENCE_TIME}`);
    for (const line of outcome.stdout) {
      console.log(line);
    }
    for (const line of outcome.stderr) {
      console.error(line);
    }
    if (outcome.mode === 'fail') {
      process.exitCode = 1;
    }
  } finally {
    close();
  }
}

if (isMain(import.meta.url)) {
  withBenchmarkClock(main).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

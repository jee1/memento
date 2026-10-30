#!/usr/bin/env node
import { isMain } from './lib/cli.js';
/**
 * Search-wall p95 and post-warmup RSS against a committed perf baseline.
 * Does not score MRR. Corpus is benchmark-v3 cloned to PERF_CORPUS_ROWS.
 *
 * --write-baseline  --baseline <path>
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqliteRepositoryProvider } from '@memento/core';
import { HybridSearchFactory } from '@memento/core/domains/search/factories/hybrid-search.factory.js';
import { normalizeBenchmarkGroundTruths } from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-review-verifier.js';
import { getBenchmarkVectorProviderFilter } from '@memento/core/shared/types/benchmark.types.js';
import type Database from 'better-sqlite3';
import type { RepositoryProvider } from '@memento/core/shared/ports/repository-provider.port.js';
import { createSeededBenchmarkDatabase } from './lib/benchmark-search-database.js';
import { evaluatePerf, PERF_BASELINE_PATH, PERF_CORPUS_ROWS } from './lib/quality-baseline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BENCHMARK_DIR = join(ROOT, 'tests/fixtures/search-quality/benchmark-v3');

export interface PerfSmokeArgs {
  readonly writeBaseline: boolean;
  readonly baselinePath?: string;
}

export function parsePerfSmokeArgs(argv: readonly string[]): PerfSmokeArgs {
  let writeBaseline = false;
  let baselinePath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write-baseline') {
      writeBaseline = true;
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
  return { writeBaseline, baselinePath };
}

function scoredQueryTexts(benchmarkDir: string): string[] {
  return normalizeBenchmarkGroundTruths(benchmarkDir)
    .filter((groundTruth) => groundTruth.relevantIds.length > 0)
    .map((groundTruth) => groundTruth.queryId);
}

async function measureSearchWall(
  db: Database.Database,
  repositories: RepositoryProvider,
  queryTexts: readonly string[],
): Promise<{ readonly searchWallMs: readonly number[]; readonly rssBytes: number }> {
  const searchEngine = HybridSearchFactory.createDefaultEngine(repositories);
  const providerFilter = getBenchmarkVectorProviderFilter();
  for (const query of queryTexts) {
    await searchEngine.search(db, { query, limit: 20, provider_filter: providerFilter });
  }
  const rssBytes = process.memoryUsage().rss;
  const searchWallMs: number[] = [];
  for (const query of queryTexts) {
    const started = performance.now();
    await searchEngine.search(db, { query, limit: 20, provider_filter: providerFilter });
    searchWallMs.push(performance.now() - started);
  }
  return { searchWallMs, rssBytes };
}

async function main(): Promise<void> {
  const parsed = parsePerfSmokeArgs(process.argv.slice(2));
  const seeded = await createSeededBenchmarkDatabase(BENCHMARK_DIR, {
    mode: 'scale',
    scaleTo: PERF_CORPUS_ROWS,
  });
  try {
    const samples = await measureSearchWall(seeded.db, sqliteRepositoryProvider, scoredQueryTexts(BENCHMARK_DIR));
    const outcome = evaluatePerf({
      embeddingProvider: seeded.embeddingProvider,
      corpusRowCount: seeded.seededBenchmarkIds.length,
      searchWallMs: samples.searchWallMs,
      rssBytes: samples.rssBytes,
      baselinePath: parsed.baselinePath ?? PERF_BASELINE_PATH,
      writeBaseline: parsed.writeBaseline,
    });
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
    seeded.close();
  }
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

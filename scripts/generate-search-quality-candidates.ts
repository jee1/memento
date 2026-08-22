#!/usr/bin/env node
import { parseArgs as parseCliArgs, type CliDatabase } from './lib/cli.js';

import { writeFileSync, mkdirSync } from 'fs';
import { isAbsolute, join } from 'path';
import { initializeDatabase, closeDatabase } from '@memento/core';
import { HybridSearchFactory } from '@memento/core/domains/search/factories/hybrid-search.factory.js';
import {
  loadBenchmarkQueries,
  loadBenchmarkCorpus,
  type BenchmarkQuery,
  type BenchmarkCorpusEntry,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import { mergeCandidateIds } from './lib/search-quality-candidate-builder.js';

interface CliOptions {
  benchmarkDir: string;
  limit: number;
  randomNegatives: number;
  help: boolean;
}

function parseArgs(): CliOptions {
  const args = parseCliArgs().args;
  const options: CliOptions = {
    benchmarkDir: join(process.cwd(), 'tests', 'fixtures', 'search-quality', 'benchmark-v3'),
    limit: 30,
    randomNegatives: 10,
    help: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === '--benchmark-dir' && args[index + 1]) {
      options.benchmarkDir = isAbsolute(args[index + 1])
        ? args[index + 1]
        : join(process.cwd(), args[index + 1]);
      index++;
      continue;
    }

    if (arg === '--limit' && args[index + 1]) {
      options.limit = parseInt(args[index + 1], 10);
      index++;
      continue;
    }

    if (arg === '--random-negatives' && args[index + 1]) {
      options.randomNegatives = parseInt(args[index + 1], 10);
      index++;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Search quality labeling candidate generator

Reads queries.json, runs hybrid search for each query, merges top results
with random negatives, and writes label-candidates.json. Does NOT write
ground-truth.json (human labeling only).

Usage:
  npm run quality -- benchmark candidates
  npm run quality -- benchmark candidates -- --benchmark-dir tests/fixtures/search-quality/benchmark-v3 --limit 30 --random-negatives 10

Options:
  --benchmark-dir <dir>   Benchmark directory (default: tests/fixtures/search-quality/benchmark-v3)
  --limit <n>             Max number of queries to process (default: 30)
  --random-negatives <n>  Number of random negative candidate IDs per query (default: 10)
  --help, -h              Show this help
`);
}

function buildMemoryIdToBenchmarkIdMap(corpus: BenchmarkCorpusEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of corpus) {
    map.set(entry.source_memory_id, entry.benchmark_id);
  }
  return map;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sampleDeterministicNegatives(
  allBenchmarkIds: string[],
  exclude: Set<string>,
  count: number,
  seedSource: string
): string[] {
  const pool = allBenchmarkIds.filter((id) => !exclude.has(id));
  if (pool.length === 0 || count <= 0) return [];
  return [...pool]
    .sort((left, right) => {
      const leftHash = hashString(`${seedSource}:${left}`);
      const rightHash = hashString(`${seedSource}:${right}`);
      return leftHash - rightHash || left.localeCompare(right);
    })
    .slice(0, count);
}

export interface LabelCandidateEntry {
  query_id: string;
  query: string;
  candidate_benchmark_ids: string[];
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    return;
  }

  let db: CliDatabase | null = null;

  try {
    const queries = loadBenchmarkQueries(options.benchmarkDir);
    const limitedQueries = queries.slice(0, options.limit);

    let corpus: BenchmarkCorpusEntry[] = [];
    try {
      corpus = loadBenchmarkCorpus(options.benchmarkDir);
    } catch {
      console.warn('Corpus not found or empty; random negatives will be skipped.');
    }

    const memoryToBenchmark = buildMemoryIdToBenchmarkIdMap(corpus);
    const allBenchmarkIds = corpus.map((e) => e.benchmark_id);

    db = await initializeDatabase();
    const searchEngine = HybridSearchFactory.createDefaultEngine(db);

    const entries: LabelCandidateEntry[] = [];

    for (const q of limitedQueries) {
      const hybridTop: string[] = [];
      try {
        const result = await searchEngine.search(db!, { query: q.query, limit: 20 });
        for (const item of result.items) {
          const bid = memoryToBenchmark.get(item.id);
          if (bid) hybridTop.push(bid);
        }
      } catch (err) {
        console.warn(`Search failed for query_id=${q.query_id}: ${err instanceof Error ? err.message : String(err)}`);
      }

      const excludeSet = new Set(hybridTop);
      const negatives = sampleDeterministicNegatives(
        allBenchmarkIds,
        excludeSet,
        options.randomNegatives,
        q.query_id
      );
      const candidate_benchmark_ids = mergeCandidateIds([hybridTop, negatives]);

      entries.push({
        query_id: q.query_id,
        query: q.query,
        candidate_benchmark_ids,
      });
    }

    const outPath = join(options.benchmarkDir, 'label-candidates.json');
    mkdirSync(options.benchmarkDir, { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');

    console.log(`Queries processed: ${entries.length}`);
    console.log(`Written: ${outPath}`);
  } finally {
    if (db) {
      closeDatabase(db);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

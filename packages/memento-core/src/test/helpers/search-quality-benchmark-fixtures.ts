import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GroundTruth } from './search-quality-metrics.js';

export interface BenchmarkManifest {
  benchmark_version: string;
  created_at: string;
  corpus_size: number;
  query_count: number;
  ground_truth_count: number;
  source: 'full-memory-snapshot' | 'auto-generated' | string;
  labeling_policy: 'binary-human-labeled' | string;
  strict_ci: boolean;
  ground_truth_reviewed?: boolean;
  notes?: string[];
}

export interface BenchmarkQuery {
  query_id: string;
  query: string;
  language?: string;
  category?: string;
  notes?: string;
}

export interface BenchmarkCorpusEntry {
  benchmark_id: string;
  source_memory_id: string;
  type: string;
  tags?: string[];
  created_at?: string;
  content: string;
}

export interface BenchmarkQueryLookup {
  byId: Map<string, BenchmarkQuery>;
  byQueryText: Map<string, BenchmarkQuery>;
}

export const DEFAULT_SEARCH_BENCHMARK_DIR = join(
  process.cwd(),
  'tests',
  'fixtures',
  'search-quality',
  'benchmark-v3'
);

function resolveBenchmarkDir(benchmarkDir?: string): string {
  return benchmarkDir || process.env.MEMENTO_SEARCH_BENCHMARK_DIR || DEFAULT_SEARCH_BENCHMARK_DIR;
}

function readJsonFile<T>(filePath: string, label: string): T {
  if (!existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch (error) {
    throw new Error(`${label} load failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function loadBenchmarkManifest(benchmarkDir?: string): BenchmarkManifest {
  const manifest = readJsonFile<BenchmarkManifest>(
    join(resolveBenchmarkDir(benchmarkDir), 'manifest.json'),
    'Benchmark manifest'
  );

  if (!manifest.benchmark_version || typeof manifest.strict_ci !== 'boolean') {
    throw new Error('Invalid benchmark manifest: required fields are missing');
  }

  return manifest;
}

export function assertStrictBenchmark(manifest: BenchmarkManifest): void {
  const failures: string[] = [];

  if (!manifest.strict_ci) {
    failures.push('strict_ci=false');
  }

  if (manifest.source !== 'full-memory-snapshot') {
    failures.push(`source=${manifest.source}`);
  }

  if (manifest.labeling_policy !== 'binary-human-labeled') {
    failures.push(`labeling_policy=${manifest.labeling_policy}`);
  }

  if (manifest.ground_truth_reviewed !== true) {
    failures.push('ground_truth_reviewed!=true');
  }

  if (failures.length > 0) {
    throw new Error(`Strict benchmark requirements not met: ${failures.join(', ')}`);
  }
}

export function loadBenchmarkQueries(benchmarkDir?: string): BenchmarkQuery[] {
  const queries = readJsonFile<BenchmarkQuery[]>(
    join(resolveBenchmarkDir(benchmarkDir), 'queries.json'),
    'Benchmark queries'
  );

  if (!Array.isArray(queries)) {
    throw new Error('Invalid benchmark queries: expected an array');
  }

  return queries;
}

export function buildBenchmarkQueryLookup(queries: BenchmarkQuery[]): BenchmarkQueryLookup {
  return {
    byId: new Map(queries.map((query) => [query.query_id, query])),
    byQueryText: new Map(queries.map((query) => [query.query, query])),
  };
}

export function loadBenchmarkGroundTruth(benchmarkDir?: string): GroundTruth[] {
  const groundTruths = readJsonFile<GroundTruth[]>(
    join(resolveBenchmarkDir(benchmarkDir), 'ground-truth.json'),
    'Benchmark ground truth'
  );

  if (!Array.isArray(groundTruths)) {
    throw new Error('Invalid benchmark ground truth: expected an array');
  }

  for (const groundTruth of groundTruths) {
    if (!groundTruth.queryId || !Array.isArray(groundTruth.relevantIds)) {
      throw new Error('Invalid benchmark ground truth: queryId/relevantIds are required');
    }
  }

  return groundTruths;
}

export function loadBenchmarkCorpus(benchmarkDir?: string): BenchmarkCorpusEntry[] {
  const corpusPath = join(resolveBenchmarkDir(benchmarkDir), 'corpus.jsonl');

  if (!existsSync(corpusPath)) {
    throw new Error(`Benchmark corpus not found: ${corpusPath}`);
  }

  const content = readFileSync(corpusPath, 'utf-8').trim();
  if (content.length === 0) {
    return [];
  }

  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parsed = JSON.parse(line) as BenchmarkCorpusEntry;
      if (!parsed.benchmark_id || !parsed.source_memory_id || !parsed.content) {
        throw new Error('Invalid benchmark corpus entry: benchmark_id/source_memory_id/content are required');
      }
      return parsed;
    });
}

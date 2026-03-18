#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import Database from 'better-sqlite3';
import { initializeDatabase, closeDatabase } from '../src/infrastructure/database/database/init.js';
import { DatabaseUtils } from '../src/shared/utils/database.js';
import {
  buildBenchmarkCorpus,
  type BenchmarkCorpusEntry,
  type BenchmarkSourceMemory,
} from '../src/test/helpers/search-quality-benchmark-builder.js';
import { loadBenchmarkCorpus, type BenchmarkManifest } from '../src/test/helpers/search-quality-benchmark-fixtures.js';

interface CliOptions {
  outputDir: string;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    outputDir: join('tests', 'fixtures', 'search-quality', 'benchmark-v3'),
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === '--output-dir' && args[index + 1]) {
      options.outputDir = args[index + 1];
      index++;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
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
Search quality benchmark corpus exporter

Requires an already-initialized Memento database (memory_item table must exist).
Use DB_PATH to point to your existing database if it is not in the default location.

Usage:
  npm run quality:benchmark:export
  DB_PATH=/path/to/memory.db npm run quality:benchmark:export
  npm run quality:benchmark:export -- --dry-run
  npm run quality:benchmark:export -- --output-dir tests/fixtures/search-quality/benchmark-v3

Options:
  --output-dir <dir>   Export directory (default: tests/fixtures/search-quality/benchmark-v3)
  --dry-run            Print summary without writing files
  --help, -h           Show this help

Environment:
  DB_PATH              Path to SQLite database (default: from config, often ./data/memory.db)
`);
}

function loadJsonArrayLength(filePath: string): number {
  if (!existsSync(filePath)) {
    return 0;
  }

  const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
  return Array.isArray(parsed) ? parsed.length : 0;
}

function deriveBenchmarkVersion(outputDir: string): string {
  const directoryName = basename(resolve(outputDir));
  const match = directoryName.match(/^benchmark-(.+)$/);
  return match?.[1] ?? directoryName;
}

function createManifest(outputDir: string, corpus: BenchmarkCorpusEntry[]): BenchmarkManifest {
  return {
    benchmark_version: deriveBenchmarkVersion(outputDir),
    created_at: new Date().toISOString(),
    corpus_size: corpus.length,
    query_count: loadJsonArrayLength(join(outputDir, 'queries.json')),
    ground_truth_count: loadJsonArrayLength(join(outputDir, 'ground-truth.json')),
    source: 'full-memory-snapshot',
    labeling_policy: 'binary-human-labeled',
    strict_ci: true,
    ground_truth_reviewed: false,
    notes: [
      'Exported from current memory_item snapshot',
      'Human-labeled queries and ground truth must be added separately',
      'Set ground_truth_reviewed=true only after manual review is complete',
    ],
  };
}

async function loadSourceMemories(db: Database.Database): Promise<BenchmarkSourceMemory[]> {
  return DatabaseUtils.all(
    db,
    `SELECT id, type, content, tags, created_at
       FROM memory_item
      ORDER BY created_at ASC, id ASC`
  ) as BenchmarkSourceMemory[];
}

function writeCorpus(outputDir: string, corpus: BenchmarkCorpusEntry[]): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    join(outputDir, 'corpus.jsonl'),
    corpus.map((entry) => JSON.stringify(entry)).join('\n') + (corpus.length > 0 ? '\n' : ''),
    'utf-8'
  );
}

function writeManifest(outputDir: string, manifest: BenchmarkManifest): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    return;
  }

  let db: Database.Database | null = null;

  try {
    db = await initializeDatabase();

    const hasMemoryItem = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_item'`)
      .get();
    if (!hasMemoryItem) {
      console.error(
        'Error: memory_item table not found. The database must be initialized first.\n' +
          '  - Use DB_PATH to point to an existing Memento database, e.g.:\n' +
          '    DB_PATH=./data/memory.db npm run quality:benchmark:export\n' +
          '  - Or run "npm run db:init -w @memento/core" first (then export will have 0 memories until you add data).'
      );
      process.exitCode = 1;
      return;
    }

    const sourceRows = await loadSourceMemories(db);
    const existingCorpus = existsSync(join(options.outputDir, 'corpus.jsonl'))
      ? loadBenchmarkCorpus(options.outputDir)
      : [];
    const corpus = buildBenchmarkCorpus(sourceRows, existingCorpus);
    const manifest = createManifest(options.outputDir, corpus);

    console.log(`source memories: ${sourceRows.length}`);
    console.log(`benchmark corpus: ${corpus.length}`);
    console.log(`dropped empty content: ${sourceRows.length - corpus.length}`);
    console.log(`output directory: ${options.outputDir}`);

    if (options.dryRun) {
      console.log('dry run complete (no files written)');
      return;
    }

    writeCorpus(options.outputDir, corpus);
    writeManifest(options.outputDir, manifest);

    console.log(`wrote: ${join(options.outputDir, 'corpus.jsonl')}`);
    console.log(`wrote: ${join(options.outputDir, 'manifest.json')}`);
  } finally {
    if (db) {
      closeDatabase(db);
    }
  }
}

function printDatabaseHint(error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('no such table') && msg.includes('memory_item')) {
    console.error(
      '\nHint: Use an already-initialized Memento database (memory_item must exist).\n' +
        '  DB_PATH=/path/to/your/memory.db npm run quality:benchmark:export\n' +
        'Example (main repo data): DB_PATH=../data/memory.db npm run quality:benchmark:export'
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  printDatabaseHint(error);
  process.exitCode = 1;
});

#!/usr/bin/env node
import { parseArgs as parseCliArgs } from './lib/cli.js';
/**
 * Export memory_item rows (+ optional relations) to JSONL with manifest header.
 *
 * Usage:
 *   npm run memory:export -- --output ./backup/memories.jsonl
 *   DB_PATH=./data/memory.db npm run memory:export -- --output ./backup/memories.jsonl --include-relations
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { closeDatabase, initializeDatabase, exportMemoryJsonl } from '@memento/core';

interface CliOptions {
  output: string;
  includeRelations: boolean;
  help: boolean;
}

function parseArgs(): CliOptions {
  const args = parseCliArgs().args;
  const options: CliOptions = {
    output: `memory-export-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
    includeRelations: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--output' || arg === '-o') && args[i + 1]) {
      options.output = args[i + 1]!;
      i++;
      continue;
    }
    if (arg === '--include-relations') {
      options.includeRelations = true;
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
JSONL memory export

Usage:
  npm run memory:export -- --output ./backup/memories.jsonl
  DB_PATH=./data/memory.db npm run memory:export -- --include-relations

Options:
  --output, -o <path>   Output JSONL file (default: memory-export-<timestamp>.jsonl)
  --include-relations   Also export memory_relation rows
  --help, -h            Show this help

Environment:
  DB_PATH               Source SQLite database path
`);
}

async function main(): Promise<void> {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  const outputPath = resolve(options.output);
  let db = null;

  try {
    db = await initializeDatabase();
    const hasMemoryItem = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_item'`)
      .get();
    if (!hasMemoryItem) {
      console.error('Error: memory_item table not found. Initialize DB first (npm run db:init).');
      process.exitCode = 1;
      return;
    }

    const jsonl = await exportMemoryJsonl(db, {
      includeRelations: options.includeRelations,
    });

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, jsonl, 'utf-8');

    const manifest = JSON.parse(jsonl.split('\n')[0] ?? '{}') as {
      schema_version?: string;
      record_counts?: { memory_item?: number; memory_relation?: number };
      checksum?: string;
    };

    console.log(JSON.stringify({
      ok: true,
      output: outputPath,
      schema_version: manifest.schema_version,
      memory_item: manifest.record_counts?.memory_item ?? 0,
      memory_relation: manifest.record_counts?.memory_relation ?? 0,
      checksum: manifest.checksum,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
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

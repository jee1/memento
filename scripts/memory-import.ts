#!/usr/bin/env node
/**
 * Import JSONL memory export into a fresh (or empty) database.
 *
 * Usage:
 *   npm run memory:import -- --input ./backup/memories.jsonl --target ./data/restored.db
 *   npm run memory:import -- --input ./backup/memories.jsonl --allow-legacy
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  closeDatabase,
  initializeDatabase,
  importMemoryJsonl,
  MemoryJsonlChecksumError,
  MemoryJsonlSchemaError,
} from '@memento/core';

interface CliOptions {
  input: string;
  target: string | null;
  allowLegacy: boolean;
  help: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    input: '',
    target: null,
    allowLegacy: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--input' || arg === '-i') && args[i + 1]) {
      options.input = args[i + 1]!;
      i++;
      continue;
    }
    if ((arg === '--target' || arg === '-t') && args[i + 1]) {
      options.target = args[i + 1]!;
      i++;
      continue;
    }
    if (arg === '--allow-legacy') {
      options.allowLegacy = true;
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
JSONL memory import

Usage:
  npm run memory:import -- --input ./backup/memories.jsonl --target ./data/restored.db
  DB_PATH=./data/restored.db npm run memory:import -- --input ./backup/memories.jsonl

Options:
  --input, -i <path>    Source JSONL export file (required)
  --target, -t <path>   Target SQLite DB path (default: DB_PATH env or config default)
  --allow-legacy        Accept exports from older schema_version values
  --help, -h            Show this help

Environment:
  DB_PATH               Target database when --target is omitted
`);
}

async function main(): Promise<void> {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  if (!options.input) {
    console.error('Error: --input is required');
    process.exitCode = 1;
    return;
  }

  const inputPath = resolve(options.input);
  if (!existsSync(inputPath)) {
    console.error(`Error: input file not found: ${inputPath}`);
    process.exitCode = 1;
    return;
  }

  const targetPath = options.target ? resolve(options.target) : undefined;
  let db = null;

  try {
    db = await initializeDatabase(targetPath);
    const content = readFileSync(inputPath, 'utf-8');
    const result = importMemoryJsonl(db, content, {
      allowLegacySchema: options.allowLegacy,
    });

    console.log(JSON.stringify({
      ok: true,
      input: inputPath,
      target: targetPath ?? process.env.DB_PATH ?? '(default)',
      schema_version: result.schemaVersion,
      imported: {
        memory_item: result.memoryItems,
        memory_relation: result.memoryRelations,
      },
    }, null, 2));
  } catch (error) {
    const payload: Record<string, unknown> = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    if (error instanceof MemoryJsonlSchemaError || error instanceof MemoryJsonlChecksumError) {
      payload.code = error.name;
    }
    console.error(JSON.stringify(payload));
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

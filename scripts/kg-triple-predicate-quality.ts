#!/usr/bin/env node
/**
 * Read-only kg_triple predicate quality report (#813 / FR-005).
 *
 *   DB_PATH=/path/to/memento.db npm run memory:kg-triple-predicate-quality
 *   DB_PATH=/path/to/memento.db npm run memory:kg-triple-predicate-quality -- --sample-limit 20
 *
 * Stdout: JSON `{ ok: true, report }` — never prints absolute DB_PATH (FR-006).
 */
import os from 'node:os';
import path from 'node:path';
import { isMain, openDb, parseArgs } from './lib/cli.js';
import {
  DEFAULT_SAMPLE_LIMIT,
  buildKgTriplePredicateQualityReport,
} from './lib/kg-triple-predicate-quality.js';

function resolveDbPath(): string {
  if (process.env.DB_PATH) {
    return path.resolve(process.env.DB_PATH);
  }
  return path.join(os.homedir(), '.memento', 'data', 'memory.db');
}

function printHelp(): void {
  process.stdout.write(`Usage:
  npm run memory:kg-triple-predicate-quality
  npm run memory:kg-triple-predicate-quality -- --sample-limit 20

Options:
  --sample-limit <n>  Cap sample arrays (default ${DEFAULT_SAMPLE_LIMIT}, max ${DEFAULT_SAMPLE_LIMIT})
  -h, --help          Show this help

Environment:
  DB_PATH             SQLite database path (default: ~/.memento/data/memory.db)

Output is JSON { ok: true, report }. Absolute DB_PATH is never printed.
`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'sample-limit': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    return 0;
  }

  const rawLimit = values['sample-limit'];
  const sampleLimit =
    rawLimit === undefined || rawLimit === ''
      ? DEFAULT_SAMPLE_LIMIT
      : Number(rawLimit);

  if (!Number.isFinite(sampleLimit) || sampleLimit < 0) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: 'invalid --sample-limit' })}\n`,
    );
    return 1;
  }

  const dbPath = resolveDbPath();
  const db = openDb(dbPath, { readonly: true });

  try {
    const report = buildKgTriplePredicateQualityReport(db, { sampleLimit });
    // FR-006: report only — do not echo dbPath
    process.stdout.write(`${JSON.stringify({ ok: true, report }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    return 1;
  } finally {
    db.close();
  }
}

if (isMain(import.meta.url)) {
  main().then(code => {
    process.exitCode = code;
  });
}

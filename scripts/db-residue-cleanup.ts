#!/usr/bin/env node
import { parseArgs, openDb, isMain } from './lib/cli.js';
import {
  applyDimensionsZeroCleanup,
  buildDbResidueReport,
  previewDimensionsZeroCleanup,
} from './lib/db-residue.js';
import os from 'node:os';
import path from 'node:path';

function resolveDbPath(): string {
  if (process.env.DB_PATH) {
    return path.resolve(process.env.DB_PATH);
  }
  return path.join(os.homedir(), '.memento', 'data', 'memory.db');
}

function printHelp(): void {
  process.stdout.write(`Usage:
  npm run db:residue -- report
  npm run db:residue -- cleanup-embeddings [--apply]

Options:
  --apply   Delete memory_embedding rows where dimensions = 0 (default: preview only)
`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    options: {
      apply: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) {
    printHelp();
    return values.help ? 0 : 1;
  }

  const subcommand = positionals[0];
  const dbPath = resolveDbPath();
  const db = openDb(dbPath);

  try {
    if (subcommand === 'report') {
      const report = buildDbResidueReport(db);
      process.stdout.write(`${JSON.stringify({ ok: true, report }, null, 2)}\n`);
      return 0;
    }

    if (subcommand === 'cleanup-embeddings') {
      const preview = previewDimensionsZeroCleanup(db);
      if (!values.apply) {
        process.stdout.write(
          `${JSON.stringify({ ok: true, mode: 'preview', ...preview }, null, 2)}\n`,
        );
        return 0;
      }
      const deleted = applyDimensionsZeroCleanup(db);
      process.stdout.write(
        `${JSON.stringify({ ok: true, mode: 'apply', deleted, preview_ids: preview.ids }, null, 2)}\n`,
      );
      return 0;
    }

    printHelp();
    return 1;
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

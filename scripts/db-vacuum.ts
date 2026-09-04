#!/usr/bin/env node
import { openDb, isMain } from './lib/cli.js';
import { vacuumAndMeasure } from './lib/quarantine-run.js';
import os from 'node:os';
import path from 'node:path';

function resolveDbPath(): string {
  if (process.env.DB_PATH) {
    return path.resolve(process.env.DB_PATH);
  }
  return path.join(os.homedir(), '.memento', 'data', 'memory.db');
}

export async function main(): Promise<number> {
  const dbPath = resolveDbPath();
  const db = openDb(dbPath);
  try {
    const result = vacuumAndMeasure(db, dbPath);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
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

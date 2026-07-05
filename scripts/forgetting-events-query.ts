#!/usr/bin/env node
/**
 * Query forgetting event audit log from CLI.
 *
 * Usage:
 *   npm run forgetting:events
 *   npm run forgetting:events -- --memory-id mem_123 --action soft --limit 20
 */

import { closeDatabase, initializeDatabase, listForgettingEvents } from '@memento/core';
import type { ForgettingEventAction } from '@memento/core';

interface CliOptions {
  memoryId?: string;
  action?: ForgettingEventAction;
  limit: number;
  help: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = { limit: 50, help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--memory-id' && args[i + 1]) {
      options.memoryId = args[i + 1];
      i++;
      continue;
    }
    if (arg === '--action' && args[i + 1]) {
      options.action = args[i + 1] as ForgettingEventAction;
      i++;
      continue;
    }
    if (arg === '--limit' && args[i + 1]) {
      options.limit = Number.parseInt(args[i + 1]!, 10);
      i++;
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
Forgetting event log query

Usage:
  npm run forgetting:events
  npm run forgetting:events -- --memory-id mem_abc --action hard --limit 20

Options:
  --memory-id <id>   Filter by memory ID
  --action <soft|hard|review>
  --limit <n>        Max rows (default 50)
  --help, -h
`);
}

async function main(): Promise<void> {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  let db = null;
  try {
    db = await initializeDatabase();
    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_forgetting_event'`)
      .get();
    if (!table) {
      console.error(JSON.stringify({
        ok: false,
        error: 'memory_forgetting_event table not found. Run npm run db:migrate first.',
      }));
      process.exitCode = 1;
      return;
    }

    const events = listForgettingEvents(db, {
      memory_id: options.memoryId,
      action: options.action,
      limit: options.limit,
    });

    console.log(JSON.stringify({ ok: true, count: events.length, events }, null, 2));
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

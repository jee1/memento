import os from 'node:os';
import path from 'node:path';
import {
  bulkUpdatePendingMemoryReviewCandidates,
  countPendingMemoryReviewCandidatesBySelector,
  type BulkMemoryReviewCandidateAction,
  type BulkMemoryReviewCandidateSelector,
} from '@memento/core';
import Database from 'better-sqlite3';

interface ReviewQueueCleanupOptions {
  dbPath?: string;
  now?: () => Date;
  stdout?: (message: string) => void | Promise<void>;
  stderr?: (message: string) => void | Promise<void>;
}

interface ParsedReviewQueueCleanupArgs {
  action: BulkMemoryReviewCandidateAction;
  selector: BulkMemoryReviewCandidateSelector;
  execute: boolean;
}

export type ReviewQueueCleanupParseResult =
  | { ok: true; help: true }
  | ({ ok: true; help: false } & ParsedReviewQueueCleanupArgs)
  | { ok: false; error: string };

const HELP_TEXT = `Usage:
  memento review-queue cleanup (--older-than-days <days> | --all-pending)
    (--dismiss | --expire) [--dry-run | --execute --yes]

Safety:
  Dry-run is the default. Mutations require both --execute and --yes.
`;

function parsePositiveInteger(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 3650 ? value : null;
}

export function parseReviewQueueCleanupArgs(args: string[]): ReviewQueueCleanupParseResult {
  if (args.includes('--help') || args.includes('-h')) {
    return { ok: true, help: true };
  }

  let olderThanDays: number | undefined;
  let allPending = false;
  let dismiss = false;
  let expire = false;
  let execute = false;
  let dryRun = false;
  let yes = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--older-than-days') {
      if (olderThanDays !== undefined) {
        return { ok: false, error: '--older-than-days may only be specified once.' };
      }
      const value = parsePositiveInteger(args[index + 1]);
      if (value === null) {
        return { ok: false, error: '--older-than-days requires an integer from 1 to 3650.' };
      }
      olderThanDays = value;
      index += 1;
    } else if (arg === '--all-pending') {
      if (allPending) return { ok: false, error: '--all-pending may only be specified once.' };
      allPending = true;
    } else if (arg === '--dismiss') {
      if (dismiss) return { ok: false, error: '--dismiss may only be specified once.' };
      dismiss = true;
    } else if (arg === '--expire') {
      if (expire) return { ok: false, error: '--expire may only be specified once.' };
      expire = true;
    } else if (arg === '--execute') {
      if (execute) return { ok: false, error: '--execute may only be specified once.' };
      execute = true;
    } else if (arg === '--dry-run') {
      if (dryRun) return { ok: false, error: '--dry-run may only be specified once.' };
      dryRun = true;
    } else if (arg === '--yes') {
      if (yes) return { ok: false, error: '--yes may only be specified once.' };
      yes = true;
    } else {
      return { ok: false, error: `Unknown option: ${arg}` };
    }
  }

  if (Number(olderThanDays !== undefined) + Number(allPending) !== 1) {
    return {
      ok: false,
      error: 'Specify exactly one selector: --older-than-days <days> or --all-pending.',
    };
  }
  if (Number(dismiss) + Number(expire) !== 1) {
    return { ok: false, error: 'Specify exactly one action: --dismiss or --expire.' };
  }
  if (execute && dryRun) {
    return { ok: false, error: '--execute and --dry-run cannot be used together.' };
  }
  if (execute && !yes) {
    return { ok: false, error: '--execute requires --yes.' };
  }
  if (!execute && yes) {
    return { ok: false, error: '--yes is only valid with --execute.' };
  }

  return {
    ok: true,
    help: false,
    action: dismiss ? 'dismiss' : 'expire',
    selector: olderThanDays !== undefined
      ? { older_than_days: olderThanDays }
      : { all_pending: true },
    execute,
  };
}

function resolveDatabasePath(explicitPath: string | undefined): string {
  const configuredPath = explicitPath?.trim()
    || process.env.DB_PATH?.trim()
    || path.join(os.homedir(), '.memento', 'memory.db');
  const expandedPath = configuredPath === '~'
    ? os.homedir()
    : configuredPath.startsWith('~/')
      ? path.join(os.homedir(), configuredPath.slice(2))
      : configuredPath;
  return path.resolve(expandedPath);
}

function assertReviewQueueSchema(db: Database.Database): void {
  const requiredObjects = [
    ['table', 'memory_review_candidate'],
    ['index', 'idx_memory_review_candidate_pending_memory_id'],
    ['index', 'idx_memory_review_candidate_queue'],
  ] as const;
  for (const [type, name] of requiredObjects) {
    const found = db.prepare<[string, string]>(
      `SELECT 1 FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1`,
    ).get(type, name);
    if (!found) {
      throw new Error(
        `Required review queue migration is missing (${name}). Apply database migrations first.`,
      );
    }
  }
}

export async function runReviewQueueCleanup(
  args: string[],
  options: ReviewQueueCleanupOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? ((message: string) => process.stdout.write(message));
  const stderr = options.stderr ?? ((message: string) => process.stderr.write(message));
  const parsed = parseReviewQueueCleanupArgs(args);

  if (parsed.ok === false) {
    await stderr(`${parsed.error}\n${HELP_TEXT}`);
    return 1;
  }
  if (parsed.help === true) {
    await stdout(HELP_TEXT);
    return 0;
  }

  const databasePath = resolveDatabasePath(options.dbPath);
  let db: Database.Database | undefined;
  try {
    db = new Database(databasePath, {
      fileMustExist: true,
      readonly: !parsed.execute,
    });
    assertReviewQueueSchema(db);
    const now = (options.now ?? (() => new Date()))().toISOString();

    if (!parsed.execute) {
      const targetCount = countPendingMemoryReviewCandidatesBySelector(
        db,
        parsed.selector,
        now,
      );
      await stdout(`${JSON.stringify({
        ok: true,
        dry_run: true,
        action: parsed.action,
        selector: parsed.selector,
        database_path: databasePath,
        target_count: targetCount,
        updated_count: 0,
      })}\n`);
      return 0;
    }

    const result = bulkUpdatePendingMemoryReviewCandidates(
      db,
      parsed.action,
      parsed.selector,
      now,
    );
    await stdout(`${JSON.stringify({
      ok: true,
      dry_run: false,
      action: parsed.action,
      selector: parsed.selector,
      database_path: databasePath,
      target_count: result.matched,
      updated_count: result.updated,
    })}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await stderr(`Review queue cleanup failed: ${message}\n`);
    return 1;
  } finally {
    db?.close();
  }
}

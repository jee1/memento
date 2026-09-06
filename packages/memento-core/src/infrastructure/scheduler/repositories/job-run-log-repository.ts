/**
 * Structured per-run log lines for Jobs Dashboard Phase 3 (Issue #834).
 * Stateless, db-per-call — mirrors job-run-repository pattern.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { DatabaseUtils } from '../../../shared/utils/database.js';

export type JobRunLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface JobRunLogInsert {
  run_id: string;
  ts: string;
  level: JobRunLogLevel;
  message: string;
  context_json?: string | null;
}

export interface JobRunLogRow {
  id: string;
  run_id: string;
  ts: string;
  level: JobRunLogLevel;
  message: string;
  context_json: string | null;
}

export interface ListJobRunLogsOptions {
  limit?: number;
}

const MESSAGE_MAX = 2 * 1024;
const CONTEXT_MAX = 16 * 1024;

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max);
}

function clampLimit(raw: number | undefined): number {
  return Math.min(Math.max(Math.floor(raw ?? 200), 1), 500);
}

export class JobRunLogRepository {
  append(db: Database.Database, input: JobRunLogInsert): JobRunLogRow {
    const id = `jrl_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const message = truncate(input.message, MESSAGE_MAX);
    const context_json =
      input.context_json == null ? null : truncate(input.context_json, CONTEXT_MAX);

    DatabaseUtils.run(
      db,
      `INSERT INTO job_run_log (id, run_id, ts, level, message, context_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.run_id, input.ts, input.level, message, context_json],
    );

    return this.getById(db, id)!;
  }

  appendMany(db: Database.Database, runId: string, lines: Omit<JobRunLogInsert, 'run_id'>[]): number {
    if (lines.length === 0) {
      return 0;
    }
    let count = 0;
    const insert = db.transaction((rows: Omit<JobRunLogInsert, 'run_id'>[]) => {
      for (const line of rows) {
        this.append(db, { ...line, run_id: runId });
        count += 1;
      }
    });
    insert(lines);
    return count;
  }

  getById(db: Database.Database, id: string): JobRunLogRow | null {
    const row = DatabaseUtils.get(
      db,
      `SELECT id, run_id, ts, level, message, context_json FROM job_run_log WHERE id = ?`,
      [id],
    ) as JobRunLogRow | undefined;
    return row ?? null;
  }

  /** Chronological ASC (ts, id); limit clamped to 1..500 (default 200). */
  listByRunId(db: Database.Database, runId: string, options: ListJobRunLogsOptions = {}): JobRunLogRow[] {
    const limit = clampLimit(options.limit);
    return DatabaseUtils.all(
      db,
      `SELECT id, run_id, ts, level, message, context_json
         FROM job_run_log
         WHERE run_id = ?
         ORDER BY ts ASC, id ASC
         LIMIT ?`,
      [runId, limit],
    ) as JobRunLogRow[];
  }
}

/**
 * Soft-fail append helper — never throws; must not flip primary job outcome (FR-010).
 */
export function appendJobRunLogSafe(
  db: Database.Database | null | undefined,
  input: JobRunLogInsert,
  log: (message: string, data?: unknown) => void = () => {},
): void {
  if (!db) {
    return;
  }
  try {
    new JobRunLogRepository().append(db, input);
  } catch (error) {
    log('job_run_log append failed (soft-fail)', {
      runId: input.run_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Soft-fail batch append — never throws.
 */
export function appendJobRunLogsManySafe(
  db: Database.Database | null | undefined,
  runId: string,
  lines: Omit<JobRunLogInsert, 'run_id'>[],
  log: (message: string, data?: unknown) => void = () => {},
): void {
  if (!db || lines.length === 0) {
    return;
  }
  try {
    new JobRunLogRepository().appendMany(db, runId, lines);
  } catch (error) {
    log('job_run_log appendMany failed (soft-fail)', {
      runId,
      count: lines.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

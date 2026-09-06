/**
 * Durable batch job execution history repository (Issue #833).
 * Stateless, db-per-call — follows forgetting-event-repository pattern.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { DatabaseUtils } from '../../../shared/utils/database.js';

export type JobRunTrigger = 'schedule' | 'manual';

export interface JobRunInsert {
  job_name: string;
  trigger: JobRunTrigger;
  started_at: string;
  ended_at: string;
  success: boolean;
  duration_ms: number;
  processed?: number | null;
  error_count?: number | null;
  details_json?: string | null;
}

export interface JobRunRow {
  id: string;
  job_name: string;
  trigger: JobRunTrigger;
  started_at: string;
  ended_at: string;
  success: number;
  duration_ms: number;
  processed: number | null;
  error_count: number | null;
  details_json: string | null;
}

export interface ListJobRunsOptions {
  jobName?: string;
  limit?: number;
}

export class JobRunRepository {
  append(db: Database.Database, input: JobRunInsert): JobRunRow {
    const id = `jr_${Date.now()}_${randomUUID().slice(0, 8)}`;
    DatabaseUtils.run(
      db,
      `INSERT INTO job_run (
        id, job_name, trigger, started_at, ended_at, success, duration_ms, processed, error_count, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.job_name,
        input.trigger,
        input.started_at,
        input.ended_at,
        input.success ? 1 : 0,
        input.duration_ms,
        input.processed ?? null,
        input.error_count ?? null,
        input.details_json ?? null,
      ],
    );
    return this.getById(db, id)!;
  }

  getById(db: Database.Database, id: string): JobRunRow | null {
    const row = DatabaseUtils.get(
      db,
      `SELECT id, job_name, trigger, started_at, ended_at, success, duration_ms, processed, error_count, details_json
         FROM job_run WHERE id = ?`,
      [id],
    ) as JobRunRow | undefined;
    return row ?? null;
  }

  /** Newest-first; limit clamped to 1..100 (default 50). */
  list(db: Database.Database, options: ListJobRunsOptions = {}): JobRunRow[] {
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), 100);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.jobName) {
      clauses.push('job_name = ?');
      params.push(options.jobName);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);

    return DatabaseUtils.all(
      db,
      `SELECT id, job_name, trigger, started_at, ended_at, success, duration_ms, processed, error_count, details_json
         FROM job_run
         ${where}
         ORDER BY started_at DESC, id DESC
         LIMIT ?`,
      params,
    ) as JobRunRow[];
  }

  /** Issue #833 (aligned with #810): ISO cutoff computed in JS, never raw SQL CURRENT_TIMESTAMP. */
  deleteExpired(db: Database.Database, retentionDays: number): number {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const result = DatabaseUtils.run(db, `DELETE FROM job_run WHERE started_at < ?`, [cutoff]);
    return result.changes;
  }
}

/**
 * Soft-fail append helper for callers (schedule coordinator, manual admin route).
 * Never throws — append failures must not flip the primary job success/failure outcome (FR-004).
 */
export function appendJobRunSafe(
  db: Database.Database | null | undefined,
  input: JobRunInsert,
  log: (message: string, data?: unknown) => void = () => {},
): void {
  if (!db) {
    return;
  }
  try {
    new JobRunRepository().append(db, input);
  } catch (error) {
    log('job_run append failed (soft-fail)', {
      jobName: input.job_name,
      trigger: input.trigger,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

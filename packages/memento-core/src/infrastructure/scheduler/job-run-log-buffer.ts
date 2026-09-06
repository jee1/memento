/**
 * In-execution structured log buffer for Jobs Dashboard Phase 3 (Issue #834).
 * Lines are flushed to job_run_log after job_run append returns an id.
 */

import type Database from 'better-sqlite3';
import {
  appendJobRunLogsManySafe,
  type JobRunLogInsert,
  type JobRunLogLevel,
} from './repositories/job-run-log-repository.js';

export interface JobRunLogBufferLine {
  ts: string;
  level: JobRunLogLevel;
  message: string;
  context_json?: string | null;
}

export class JobRunLogBuffer {
  private readonly lines: JobRunLogBufferLine[] = [];

  append(input: {
    level: JobRunLogLevel;
    message: string;
    context?: Record<string, unknown> | null;
    ts?: string;
  }): void {
    let context_json: string | null = null;
    if (input.context != null) {
      try {
        context_json = JSON.stringify(input.context);
      } catch {
        context_json = null;
      }
    }
    this.lines.push({
      ts: input.ts ?? new Date().toISOString(),
      level: input.level,
      message: input.message,
      context_json,
    });
  }

  get size(): number {
    return this.lines.length;
  }

  /** Drain buffered lines (clears buffer). */
  drain(): JobRunLogBufferLine[] {
    return this.lines.splice(0, this.lines.length);
  }

  peek(): readonly JobRunLogBufferLine[] {
    return this.lines;
  }
}

/** Soft-fail flush of buffer lines into job_run_log for a known run id. */
export function flushJobRunLogBufferSafe(
  db: Database.Database | null | undefined,
  runId: string,
  buffer: JobRunLogBuffer,
  log: (message: string, data?: unknown) => void = () => {},
): void {
  const lines = buffer.drain();
  if (lines.length === 0) {
    return;
  }
  const inserts: Omit<JobRunLogInsert, 'run_id'>[] = lines.map(line => ({
    ts: line.ts,
    level: line.level,
    message: line.message,
    context_json: line.context_json ?? null,
  }));
  appendJobRunLogsManySafe(db, runId, inserts, log);
}

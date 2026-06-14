import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseReviewQueueCleanupArgs,
  runReviewQueueCleanup,
} from './review-queue-cleanup.js';

const tempPaths: string[] = [];

function createReviewQueueDatabase(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memento-review-cleanup-'));
  tempPaths.push(directory);
  const dbPath = path.join(directory, 'memory.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE memory_review_candidate (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      status TEXT NOT NULL,
      priority REAL NOT NULL,
      reason TEXT NOT NULL,
      due_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewed_at TEXT,
      dismissed_at TEXT,
      metadata_json TEXT,
      FOREIGN KEY(memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX idx_memory_review_candidate_pending_memory_id
      ON memory_review_candidate(memory_id)
      WHERE status = 'pending';
    CREATE INDEX idx_memory_review_candidate_queue
      ON memory_review_candidate(status, priority DESC, due_at ASC);
    INSERT INTO memory_item (id) VALUES ('old'), ('new');
    INSERT INTO memory_review_candidate (
      id, memory_id, status, priority, reason, due_at, created_at, updated_at
    ) VALUES
      ('candidate-old', 'old', 'pending', 1, 'old', '2026-05-01T00:00:00.000Z',
       '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'),
      ('candidate-new', 'new', 'pending', 1, 'new', '2026-06-10T00:00:00.000Z',
       '2026-06-10T00:00:00.000Z', '2026-06-10T00:00:00.000Z');
  `);
  db.close();
  return dbPath;
}

function pendingCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare<[], { count: number }>(
      `SELECT COUNT(*) AS count FROM memory_review_candidate WHERE status = 'pending'`,
    ).get()?.count ?? 0;
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const tempPath of tempPaths.splice(0)) {
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe('review queue cleanup CLI', () => {
  it('requires exactly one selector and one action', () => {
    expect(parseReviewQueueCleanupArgs(['--dismiss'])).toMatchObject({ ok: false });
    expect(
      parseReviewQueueCleanupArgs(['--all-pending', '--older-than-days', '30', '--dismiss']),
    ).toMatchObject({ ok: false });
    expect(parseReviewQueueCleanupArgs(['--all-pending'])).toMatchObject({ ok: false });
    expect(
      parseReviewQueueCleanupArgs(['--all-pending', '--dismiss', '--expire']),
    ).toMatchObject({ ok: false });
  });

  it('requires --yes when execute mode is requested', () => {
    expect(
      parseReviewQueueCleanupArgs(['--all-pending', '--expire', '--execute']),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/--yes/),
    });
  });

  it('dry-runs by default and does not mutate the database', async () => {
    const dbPath = createReviewQueueDatabase();
    const stdout: string[] = [];

    const code = await runReviewQueueCleanup(
      ['--older-than-days', '30', '--expire'],
      {
        dbPath,
        now: () => new Date('2026-06-14T00:00:00.000Z'),
        stdout: (message) => stdout.push(message),
      },
    );

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('').trim())).toMatchObject({
      ok: true,
      dry_run: true,
      action: 'expire',
      selector: { older_than_days: 30 },
      target_count: 1,
      updated_count: 0,
    });
    expect(pendingCount(dbPath)).toBe(2);
  });

  it('executes the same selector only with --execute --yes', async () => {
    const dbPath = createReviewQueueDatabase();
    const stdout: string[] = [];

    const code = await runReviewQueueCleanup(
      ['--older-than-days', '30', '--expire', '--execute', '--yes'],
      {
        dbPath,
        now: () => new Date('2026-06-14T00:00:00.000Z'),
        stdout: (message) => stdout.push(message),
      },
    );

    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('').trim())).toMatchObject({
      ok: true,
      dry_run: false,
      target_count: 1,
      updated_count: 1,
    });
    expect(pendingCount(dbPath)).toBe(1);
  });

  it('rejects a database that has not applied the review queue migration', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memento-review-cleanup-empty-'));
    tempPaths.push(directory);
    const dbPath = path.join(directory, 'memory.db');
    new Database(dbPath).close();
    const stderr: string[] = [];

    const code = await runReviewQueueCleanup(
      ['--all-pending', '--dismiss'],
      { dbPath, stderr: (message) => stderr.push(message) },
    );

    expect(code).toBe(1);
    expect(stderr.join('')).toMatch(/migration|memory_review_candidate/i);
  });
});

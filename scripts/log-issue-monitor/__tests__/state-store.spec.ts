import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendOccurrence, loadState, saveState, upsertOccurrence } from '../state-store.js';
import type { LogIssueOccurrence } from '../types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memento-log-monitor-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const occurrence: LogIssueOccurrence = {
  fingerprint: 'abc123',
  source: 'app-log',
  severity: 'error',
  title: 'App error: DB failed',
  normalizedMessage: 'DB failed',
  excerpt: 'DB failed',
  observedAt: '2026-05-02T00:00:00.000Z',
  context: { component: 'db' },
};

describe('state-store', () => {
  it('creates an empty state when no file exists', async () => {
    await expect(loadState(dir)).resolves.toEqual({ version: 1, cursors: {}, fingerprints: {} });
  });

  it('upserts occurrence count and caps recent occurrences', async () => {
    let state = await loadState(dir);
    for (let i = 0; i < 12; i += 1) {
      state = upsertOccurrence(state, { ...occurrence, observedAt: `2026-05-02T00:${String(i).padStart(2, '0')}:00.000Z` });
    }

    expect(state.fingerprints.abc123.occurrenceCount).toBe(12);
    expect(state.fingerprints.abc123.recentOccurrences).toHaveLength(10);
    expect(state.fingerprints.abc123.firstSeenAt).toBe('2026-05-02T00:00:00.000Z');
    expect(state.fingerprints.abc123.lastSeenAt).toBe('2026-05-02T00:11:00.000Z');
  });

  it('saves state atomically and appends occurrence JSONL', async () => {
    const state = upsertOccurrence(await loadState(dir), occurrence);
    await saveState(dir, state);
    await appendOccurrence(dir, occurrence);

    const saved = await loadState(dir);
    const jsonl = await readFile(join(dir, 'occurrences.jsonl'), 'utf8');

    expect(saved.fingerprints.abc123.occurrenceCount).toBe(1);
    expect(jsonl).toContain('"fingerprint":"abc123"');
  });
});

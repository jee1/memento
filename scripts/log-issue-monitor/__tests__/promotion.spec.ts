import { describe, expect, it } from 'vitest';
import { shouldSyncToGitHub } from '../promotion.js';
import type { LogIssueFingerprintState } from '../types.js';

const baseState: LogIssueFingerprintState = {
  fingerprint: 'abc',
  source: 'app-log',
  severity: 'warn',
  normalizedTitle: 'warning',
  firstSeenAt: '2026-05-02T00:00:00.000Z',
  lastSeenAt: '2026-05-02T00:05:00.000Z',
  occurrenceCount: 3,
  recentOccurrences: [
    { observedAt: '2026-05-02T00:00:00.000Z', excerpt: 'a', context: {} },
    { observedAt: '2026-05-02T00:03:00.000Z', excerpt: 'b', context: {} },
    { observedAt: '2026-05-02T00:05:00.000Z', excerpt: 'c', context: {} },
  ],
  status: 'local_only',
};

describe('shouldSyncToGitHub', () => {
  it('syncs errors immediately', () => {
    expect(shouldSyncToGitHub({ ...baseState, severity: 'error', occurrenceCount: 1, recentOccurrences: [] }, 3, 600)).toBe(true);
  });

  it('syncs warnings only after threshold within window', () => {
    expect(shouldSyncToGitHub(baseState, 3, 600)).toBe(true);
    expect(shouldSyncToGitHub({ ...baseState, occurrenceCount: 2, recentOccurrences: baseState.recentOccurrences.slice(0, 2) }, 3, 600)).toBe(false);
  });
});

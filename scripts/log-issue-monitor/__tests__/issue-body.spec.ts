import { describe, expect, it } from 'vitest';
import { renderManagedIssueBody, upsertManagedIssueBody } from '../issue-body.js';
import type { LogIssueFingerprintState } from '../types.js';

const state: LogIssueFingerprintState = {
  fingerprint: 'abc123',
  source: 'app-log',
  severity: 'error',
  normalizedTitle: 'App error: DB failed',
  firstSeenAt: '2026-05-02T00:00:00.000Z',
  lastSeenAt: '2026-05-02T00:01:00.000Z',
  occurrenceCount: 2,
  recentOccurrences: [{ observedAt: '2026-05-02T00:01:00.000Z', excerpt: 'DB failed', context: { component: 'db' } }],
  status: 'local_only',
};

describe('issue body', () => {
  it('renders a managed fingerprint marker and counts', () => {
    const body = renderManagedIssueBody(state);

    expect(body).toContain('<!-- memento-log-monitor:fingerprint=abc123 -->');
    expect(body).toContain('- Occurrences: 2');
    expect(body).toContain('DB failed');
  });

  it('replaces only the managed block and preserves human text', () => {
    const original = 'Human note\n\n<!-- memento-log-monitor:fingerprint=abc123 -->\nold\n<!-- /memento-log-monitor -->\n\nMore text';
    const updated = upsertManagedIssueBody(original, state);

    expect(updated).toContain('Human note');
    expect(updated).toContain('More text');
    expect(updated).toContain('- Occurrences: 2');
    expect(updated).not.toContain('\nold\n');
  });
});

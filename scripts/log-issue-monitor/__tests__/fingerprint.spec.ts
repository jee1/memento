import { describe, expect, it } from 'vitest';
import { createFingerprint, normalizeMessage } from '../fingerprint.js';

describe('normalizeMessage', () => {
  it('removes unstable IDs, timestamps, durations, and byte counts', () => {
    const normalized = normalizeMessage('request req_123 failed at 2026-05-02T00:00:00.000Z after 345ms using 12345 bytes');

    expect(normalized).toBe('request <request-id> failed at <timestamp> after <duration> using <bytes>');
  });
});

describe('createFingerprint', () => {
  it('returns the same fingerprint for equivalent unstable messages', () => {
    const first = createFingerprint({
      source: 'app-log',
      severity: 'error',
      normalizedMessage: 'request req_123 failed after 10ms',
      context: { component: 'db' },
    });
    const second = createFingerprint({
      source: 'app-log',
      severity: 'error',
      normalizedMessage: 'request req_999 failed after 20ms',
      context: { component: 'db' },
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{16}$/);
  });
});

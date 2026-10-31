import { describe, expect, it } from 'vitest';
import { pacificDateFromUtcIso } from './llm-usage-pacific-date.js';

describe('pacificDateFromUtcIso', () => {
  it('maps UTC instant to America/Los_Angeles calendar date', () => {
    expect(pacificDateFromUtcIso('2026-03-08T09:30:00.000Z')).toBe('2026-03-08');
  });

  it('rolls date back across Pacific midnight in PST (UTC-8)', () => {
    expect(pacificDateFromUtcIso('2026-01-15T07:59:00.000Z')).toBe('2026-01-14');
    expect(pacificDateFromUtcIso('2026-01-15T08:00:00.000Z')).toBe('2026-01-15');
  });

  it('rolls date back across Pacific midnight in PDT (UTC-7)', () => {
    expect(pacificDateFromUtcIso('2026-06-15T06:59:00.000Z')).toBe('2026-06-14');
    expect(pacificDateFromUtcIso('2026-06-15T07:00:00.000Z')).toBe('2026-06-15');
  });

  it('uses PDT offset after spring forward (2026-03-08)', () => {
    expect(pacificDateFromUtcIso('2026-03-08T09:59:00.000Z')).toBe('2026-03-08');
    expect(pacificDateFromUtcIso('2026-03-08T10:00:00.000Z')).toBe('2026-03-08');
    expect(pacificDateFromUtcIso('2026-03-09T06:59:00.000Z')).toBe('2026-03-08');
    expect(pacificDateFromUtcIso('2026-03-09T07:00:00.000Z')).toBe('2026-03-09');
  });

  it('uses PST offset after fall back (2026-11-01)', () => {
    expect(pacificDateFromUtcIso('2026-11-01T06:59:00.000Z')).toBe('2026-10-31');
    expect(pacificDateFromUtcIso('2026-11-01T07:00:00.000Z')).toBe('2026-11-01');
    expect(pacificDateFromUtcIso('2026-11-02T07:59:00.000Z')).toBe('2026-11-01');
    expect(pacificDateFromUtcIso('2026-11-02T08:00:00.000Z')).toBe('2026-11-02');
  });
});

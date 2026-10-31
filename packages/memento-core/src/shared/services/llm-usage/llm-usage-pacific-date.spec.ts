import { describe, expect, it } from 'vitest';
import { pacificDateFromUtcIso } from './llm-usage-pacific-date.js';

describe('pacificDateFromUtcIso', () => {
  it('maps UTC instant to America/Los_Angeles calendar date', () => {
    expect(pacificDateFromUtcIso('2026-03-08T09:30:00.000Z')).toBe('2026-03-08');
  });

  it('rolls date back across Pacific midnight', () => {
    expect(pacificDateFromUtcIso('2026-01-15T07:59:00.000Z')).toBe('2026-01-14');
    expect(pacificDateFromUtcIso('2026-01-15T08:00:00.000Z')).toBe('2026-01-15');
  });
});

import { describe, expect, it } from 'vitest';
import { parseOwnerScopeMode } from './owner-scope-mode.js';

describe('parseOwnerScopeMode', () => {
  it('defaults to strict when unset', () => {
    expect(parseOwnerScopeMode(undefined)).toBe('strict');
    expect(parseOwnerScopeMode('')).toBe('strict');
  });

  it('accepts strict, warn, off (case-insensitive)', () => {
    expect(parseOwnerScopeMode('strict')).toBe('strict');
    expect(parseOwnerScopeMode('WARN')).toBe('warn');
    expect(parseOwnerScopeMode('  off  ')).toBe('off');
  });

  it('falls back to strict for invalid values', () => {
    expect(parseOwnerScopeMode('legacy')).toBe('strict');
  });
});

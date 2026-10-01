import { describe, expect, it } from 'vitest';
import { optionalEnvNumber } from './optional-env-number.js';

describe('optionalEnvNumber', () => {
  it('returns undefined for unset key', () => {
    expect(optionalEnvNumber('MISSING', {})).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(optionalEnvNumber('KEY', { KEY: '' })).toBeUndefined();
  });

  it('returns undefined for whitespace-only', () => {
    expect(optionalEnvNumber('KEY', { KEY: '  ' })).toBeUndefined();
  });

  it('returns undefined for non-numeric value', () => {
    expect(optionalEnvNumber('KEY', { KEY: 'abc' })).toBeUndefined();
  });

  it('parses integer string', () => {
    expect(optionalEnvNumber('KEY', { KEY: '1500' })).toBe(1500);
  });

  it('trims and parses', () => {
    expect(optionalEnvNumber('KEY', { KEY: ' 42 ' })).toBe(42);
  });
});

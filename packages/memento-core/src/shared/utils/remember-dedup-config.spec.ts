import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  parseRememberDedupLexicalFloor,
  parseRememberDedupMergeLexicalFloor,
  parseRememberDedupMode,
  parseRememberDedupThreshold,
} from './remember-dedup-config.js';

describe('parseRememberDedupThreshold', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to 0.85 when unset', () => {
    expect(parseRememberDedupThreshold(undefined)).toBe(0.85);
    expect(parseRememberDedupThreshold('')).toBe(0.85);
  });

  it('accepts valid values in (0, 1]', () => {
    expect(parseRememberDedupThreshold('0.85')).toBe(0.85);
    expect(parseRememberDedupThreshold('1')).toBe(1);
    expect(parseRememberDedupThreshold('  0.5  ')).toBe(0.5);
  });

  it('falls back to 0.85 for invalid values', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(parseRememberDedupThreshold('0')).toBe(0.85);
    expect(parseRememberDedupThreshold('1.5')).toBe(0.85);
    expect(parseRememberDedupThreshold('abc')).toBe(0.85);
    expect(stderrSpy).toHaveBeenCalled();
  });
});

describe('parseRememberDedupMode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to warn when unset', () => {
    expect(parseRememberDedupMode(undefined)).toBe('warn');
    expect(parseRememberDedupMode('')).toBe('warn');
  });

  it('accepts warn, strict, off (case-insensitive)', () => {
    expect(parseRememberDedupMode('warn')).toBe('warn');
    expect(parseRememberDedupMode('STRICT')).toBe('strict');
    expect(parseRememberDedupMode('  off  ')).toBe('off');
  });

  it('falls back to warn for invalid values', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(parseRememberDedupMode('legacy')).toBe('warn');
    expect(stderrSpy).toHaveBeenCalled();
  });
});

describe('parseRememberDedupLexicalFloor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to 0.3 when unset', () => {
    expect(parseRememberDedupLexicalFloor(undefined)).toBe(0.3);
    expect(parseRememberDedupLexicalFloor('')).toBe(0.3);
  });

  it('accepts valid values in [0, 1] including 0', () => {
    expect(parseRememberDedupLexicalFloor('0')).toBe(0);
    expect(parseRememberDedupLexicalFloor('0.3')).toBe(0.3);
    expect(parseRememberDedupLexicalFloor('1')).toBe(1);
  });

  it('falls back to 0.3 for invalid values', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(parseRememberDedupLexicalFloor('-0.1')).toBe(0.3);
    expect(parseRememberDedupLexicalFloor('1.5')).toBe(0.3);
    expect(parseRememberDedupLexicalFloor('abc')).toBe(0.3);
    expect(stderrSpy).toHaveBeenCalled();
  });
});

describe('parseRememberDedupMergeLexicalFloor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to 0.7 when unset', () => {
    expect(parseRememberDedupMergeLexicalFloor(undefined)).toBe(0.7);
    expect(parseRememberDedupMergeLexicalFloor('')).toBe(0.7);
  });

  it('accepts valid values in [0, 1] including 0', () => {
    expect(parseRememberDedupMergeLexicalFloor('0')).toBe(0);
    expect(parseRememberDedupMergeLexicalFloor('0.7')).toBe(0.7);
    expect(parseRememberDedupMergeLexicalFloor('1')).toBe(1);
  });

  it('falls back to 0.7 for invalid values', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(parseRememberDedupMergeLexicalFloor('-0.1')).toBe(0.7);
    expect(parseRememberDedupMergeLexicalFloor('2')).toBe(0.7);
    expect(parseRememberDedupMergeLexicalFloor('abc')).toBe(0.7);
    expect(stderrSpy).toHaveBeenCalled();
  });
});

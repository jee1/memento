import { describe, expect, it } from 'vitest';
import {
  isLegacyMcpServiceEnabled,
  isModernMcpServiceEnabled,
  parseMcpEraMode,
} from './mcp-era-mode.js';

describe('mcp-era-mode', () => {
  it('defaults to dual', () => {
    expect(parseMcpEraMode(undefined)).toBe('dual');
  });

  it('parses dual|legacy|modern', () => {
    expect(parseMcpEraMode('dual')).toBe('dual');
    expect(parseMcpEraMode('LEGACY')).toBe('legacy');
    expect(parseMcpEraMode(' modern ')).toBe('modern');
  });

  it('warns and falls back to dual on invalid values', () => {
    expect(parseMcpEraMode('both')).toBe('dual');
  });

  it('gates modern and legacy service flags', () => {
    expect(isModernMcpServiceEnabled('dual')).toBe(true);
    expect(isModernMcpServiceEnabled('modern')).toBe(true);
    expect(isModernMcpServiceEnabled('legacy')).toBe(false);
    expect(isLegacyMcpServiceEnabled('dual')).toBe(true);
    expect(isLegacyMcpServiceEnabled('legacy')).toBe(true);
    expect(isLegacyMcpServiceEnabled('modern')).toBe(false);
  });
});

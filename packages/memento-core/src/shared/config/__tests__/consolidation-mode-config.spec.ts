import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getConsolidationMode,
  resetConsolidationModeConfigForTests
} from '../consolidation-mode-config.js';

describe('consolidation-mode-config', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetConsolidationModeConfigForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetConsolidationModeConfigForTests();
  });

  it('defaults to summarize when unset', () => {
    delete process.env.CONSOLIDATION_MODE;
    expect(getConsolidationMode()).toBe('summarize');
  });

  it('returns link when set', () => {
    vi.stubEnv('CONSOLIDATION_MODE', 'link');
    expect(getConsolidationMode()).toBe('link');
  });

  it('warns once and falls back to summarize for invalid values', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('CONSOLIDATION_MODE', 'bogus');
    expect(getConsolidationMode()).toBe('summarize');
    expect(getConsolidationMode()).toBe('summarize');
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toContain('[CONFIG WARN]');
  });
});

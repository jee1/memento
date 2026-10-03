import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAutoTripleExtractionEnabled } from '../triple-extraction-enabled.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isAutoTripleExtractionEnabled (#1230)', () => {
  it('returns true when TRIPLE_EXTRACTION_ENABLED is unset', () => {
    vi.stubEnv('TRIPLE_EXTRACTION_ENABLED', undefined);
    expect(isAutoTripleExtractionEnabled()).toBe(true);
  });

  it('returns true when TRIPLE_EXTRACTION_ENABLED is "true"', () => {
    vi.stubEnv('TRIPLE_EXTRACTION_ENABLED', 'true');
    expect(isAutoTripleExtractionEnabled()).toBe(true);
  });

  it('returns false when TRIPLE_EXTRACTION_ENABLED is "false"', () => {
    vi.stubEnv('TRIPLE_EXTRACTION_ENABLED', 'false');
    expect(isAutoTripleExtractionEnabled()).toBe(false);
  });

  it('returns false when TRIPLE_EXTRACTION_ENABLED is "FALSE"', () => {
    vi.stubEnv('TRIPLE_EXTRACTION_ENABLED', 'FALSE');
    expect(isAutoTripleExtractionEnabled()).toBe(false);
  });

  it('returns false when TRIPLE_EXTRACTION_ENABLED is " false " (trimmed)', () => {
    vi.stubEnv('TRIPLE_EXTRACTION_ENABLED', ' false ');
    expect(isAutoTripleExtractionEnabled()).toBe(false);
  });

  it('returns true when TRIPLE_EXTRACTION_ENABLED is "0" (only "false" turns it off)', () => {
    vi.stubEnv('TRIPLE_EXTRACTION_ENABLED', '0');
    expect(isAutoTripleExtractionEnabled()).toBe(true);
  });
});

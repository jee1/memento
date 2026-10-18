import { describe, expect, it } from 'vitest';
import { parsePerfSmokeArgs } from './quality-benchmark-perf-smoke.js';

describe('parsePerfSmokeArgs', () => {
  it('defaults to compare mode', () => {
    expect(parsePerfSmokeArgs([])).toEqual({ writeBaseline: false, baselinePath: undefined });
  });

  it('accepts write-baseline and a baseline path', () => {
    expect(parsePerfSmokeArgs(['--write-baseline', '--baseline', 'perf.json'])).toEqual({
      writeBaseline: true,
      baselinePath: 'perf.json',
    });
  });

  it('rejects an unknown flag', () => {
    expect(() => parsePerfSmokeArgs(['--scope', 'pr'])).toThrow(/Unknown argument/);
  });
});

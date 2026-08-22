import { describe, expect, it } from 'vitest';
import { resolveQualityCommand } from './quality.js';

describe('quality command dispatcher', () => {
  it('routes nested benchmark commands and preserves trailing arguments', () => {
    expect(resolveQualityCommand(['benchmark', 'export', '--', '--dry-run'])).toEqual({
      script: 'export-search-quality-benchmark.ts',
      args: ['--dry-run'],
    });
  });

  it('routes colon-separated dataset commands', () => {
    expect(resolveQualityCommand(['longmemeval:validate', '--dataset', 'sample.json'])).toEqual({
      script: 'longmemeval-validation.ts',
      args: ['--dataset', 'sample.json'],
    });
  });

  it('supplies the canonical LoCoMo dataset for the benchmark command', () => {
    expect(resolveQualityCommand(['locomo', 'benchmark'])).toEqual({
      script: 'agent-memory-benchmark.ts',
      args: ['--locomo', '.local/locomo/locomo10.json'],
    });
  });

  it('rejects unknown commands with the supported command list', () => {
    expect(() => resolveQualityCommand(['unknown'])).toThrow(/benchmark:export/);
  });
});

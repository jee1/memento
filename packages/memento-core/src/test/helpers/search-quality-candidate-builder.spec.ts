import { describe, expect, it } from 'vitest';
import { mergeCandidateIds } from './search-quality-candidate-builder.js';

describe('mergeCandidateIds', () => {
  it('deduplicates ranked ids while preserving first-seen order', () => {
    const ids = mergeCandidateIds([
      ['bench_mem_000003', 'bench_mem_000001'],
      ['bench_mem_000001', 'bench_mem_000002'],
      ['bench_mem_000004'],
    ]);

    expect(ids).toEqual([
      'bench_mem_000003',
      'bench_mem_000001',
      'bench_mem_000002',
      'bench_mem_000004',
    ]);
  });
});

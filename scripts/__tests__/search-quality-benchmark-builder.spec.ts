import { describe, expect, it } from 'vitest';
import { buildBenchmarkCorpus } from '../lib/search-quality-benchmark-builder.js';

describe('buildBenchmarkCorpus', () => {
  it('입력 순서대로 안정적인 benchmark id를 부여한다', () => {
    const corpus = buildBenchmarkCorpus([
      { id: 'mem_b', type: 'semantic', content: 'B' },
      { id: 'mem_a', type: 'episodic', content: 'A' },
    ]);

    expect(corpus[0]?.benchmark_id).toBe('bench_mem_000001');
    expect(corpus[1]?.benchmark_id).toBe('bench_mem_000002');
    expect(corpus[0]?.source_memory_id).toBe('mem_b');
  });

  it('내용이 비어 있는 기억은 제외한다', () => {
    const corpus = buildBenchmarkCorpus([
      { id: 'mem_1', type: 'semantic', content: '   ' },
      { id: 'mem_2', type: 'semantic', content: 'kept' },
    ]);

    expect(corpus).toHaveLength(1);
    expect(corpus[0]?.source_memory_id).toBe('mem_2');
  });

  it('기존 corpus가 있으면 source_memory_id 기준으로 benchmark id를 재사용한다', () => {
    const corpus = buildBenchmarkCorpus(
      [
        { id: 'mem_b', type: 'semantic', content: 'B updated' },
        { id: 'mem_c', type: 'episodic', content: 'C' },
      ],
      [
        { benchmark_id: 'bench_mem_000002', source_memory_id: 'mem_b', type: 'semantic', tags: [], content: 'B' },
        { benchmark_id: 'bench_mem_000007', source_memory_id: 'mem_x', type: 'semantic', tags: [], content: 'X' },
      ]
    );

    expect(corpus[0]?.benchmark_id).toBe('bench_mem_000002');
    expect(corpus[1]?.benchmark_id).toBe('bench_mem_000008');
  });
});

import { describe, it, expect } from 'vitest';
import { join } from 'path';
import {
  loadBenchmarkCorpus,
  loadBenchmarkGroundTruth,
} from './search-quality-benchmark-fixtures.js';

const BENCHMARK_DIR = join(
  process.cwd(),
  'tests/fixtures/search-quality/benchmark-v3'
);

describe('benchmark-v3 corpus shape (#934)', () => {
  it('코퍼스에 5,000자 초과 문서가 최소 5건 있다', () => {
    const corpus = loadBenchmarkCorpus(BENCHMARK_DIR);
    const longDocs = corpus.filter((e) => e.content.length > 5000);
    expect(longDocs.length).toBeGreaterThanOrEqual(5);
  });

  it('최소 1개 쿼리의 정답이 5,000자 초과 문서다', () => {
    const corpus = loadBenchmarkCorpus(BENCHMARK_DIR);
    const byId = new Map(corpus.map((e) => [e.benchmark_id, e]));
    const gts = loadBenchmarkGroundTruth(BENCHMARK_DIR);
    const hasLongAnswer = gts.some((gt) =>
      gt.relevantIds.some((id) => (byId.get(id)?.content.length ?? 0) > 5000)
    );
    expect(hasLongAnswer).toBe(true);
  });

  it('모든 relevantIds가 코퍼스에 존재한다', () => {
    const corpusIds = new Set(loadBenchmarkCorpus(BENCHMARK_DIR).map((e) => e.benchmark_id));
    for (const gt of loadBenchmarkGroundTruth(BENCHMARK_DIR)) {
      for (const id of gt.relevantIds) {
        expect(corpusIds.has(id)).toBe(true);
      }
    }
  });

  it('bench_mem_* 스냅샷 문서는 3,440건이다', () => {
    const snapshot = loadBenchmarkCorpus(BENCHMARK_DIR).filter((e) =>
      e.benchmark_id.startsWith('bench_mem_')
    );
    expect(snapshot).toHaveLength(3440);
  });
});

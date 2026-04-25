import { describe, expect, it } from 'vitest';
import {
  assertStrictBenchmark,
  loadBenchmarkManifest,
} from './search-quality-benchmark-fixtures.js';

describe('search-quality-benchmark-fixtures', () => {
  it('manifest 파일이 없으면 예외를 던진다', () => {
    expect(() => loadBenchmarkManifest('/tmp/does-not-exist')).toThrow(/manifest/i);
  });

  it('strict benchmark 조건을 만족하지 않으면 예외를 던진다', () => {
    expect(() => assertStrictBenchmark({
      benchmark_version: 'v1',
      created_at: '2026-03-17T00:00:00.000Z',
      corpus_size: 0,
      query_count: 0,
      ground_truth_count: 0,
      source: 'auto-generated',
      labeling_policy: 'binary-human-labeled',
      strict_ci: false,
    })).toThrow(/strict benchmark/i);
  });

  it('ground truth review가 없으면 strict benchmark에서 실패한다', () => {
    expect(() => assertStrictBenchmark({
      benchmark_version: 'v1',
      created_at: '2026-03-17T00:00:00.000Z',
      corpus_size: 1,
      query_count: 1,
      ground_truth_count: 1,
      source: 'full-memory-snapshot',
      labeling_policy: 'binary-human-labeled',
      strict_ci: true,
      ground_truth_reviewed: false,
    })).toThrow(/ground_truth_reviewed/i);
  });
});

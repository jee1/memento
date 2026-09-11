import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { verifyReviewableBenchmark } from './search-quality-review-verifier.js';

function writeMinimalFixture(
  dir: string,
  options: {
    relevantIds: string[];
    ground_truth_reviewed: boolean;
  }
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      benchmark_version: 'v3-test',
      created_at: '2026-09-11T00:00:00.000Z',
      corpus_size: 1,
      query_count: 1,
      ground_truth_count: 1,
      source: 'full-memory-snapshot',
      labeling_policy: 'binary-human-labeled',
      strict_ci: true,
      ground_truth_reviewed: options.ground_truth_reviewed,
    })
  );
  writeFileSync(
    join(dir, 'queries.json'),
    JSON.stringify([
      { query_id: 'q_t1', query: '테스트 질의', language: 'ko', category: 'testing' },
    ])
  );
  writeFileSync(
    join(dir, 'ground-truth.json'),
    JSON.stringify([{ queryId: '테스트 질의', relevantIds: options.relevantIds }])
  );
  writeFileSync(
    join(dir, 'corpus.jsonl'),
    `${JSON.stringify({
      benchmark_id: 'bench_syn_test_0001',
      source_memory_id: 'syn_test_000001',
      type: 'semantic',
      tags: ['test'],
      created_at: '2026-09-11T00:00:00.000Z',
      content: '테스트 코퍼스 본문',
    })}\n`
  );
}

describe('verifyReviewableBenchmark (#934 empty relevantIds)', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `bm-review-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('relevantIds가 빈 GT가 있으면 ground_truth_reviewed=true에서 에러', () => {
    writeMinimalFixture(dir, { relevantIds: [], ground_truth_reviewed: true });
    const result = verifyReviewableBenchmark(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('non-empty relevantIds'))).toBe(true);
  });

  it('relevantIds가 모두 채워져 있으면 ok:true', () => {
    writeMinimalFixture(dir, {
      relevantIds: ['bench_syn_test_0001'],
      ground_truth_reviewed: true,
    });
    const result = verifyReviewableBenchmark(dir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('ground_truth_reviewed=false면 빈 relevantIds를 허용한다', () => {
    writeMinimalFixture(dir, { relevantIds: [], ground_truth_reviewed: false });
    const result = verifyReviewableBenchmark(dir);
    expect(result.ok).toBe(true);
  });
});

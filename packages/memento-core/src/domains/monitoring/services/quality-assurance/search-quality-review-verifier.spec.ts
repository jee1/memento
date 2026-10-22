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

function writeKnowledgeUpdateFixture(
  dir: string,
  freshCreatedAt: string,
  staleCreatedAt: string,
  options: { staleIds?: string[] } = {},
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      benchmark_version: 'v3-test',
      created_at: '2026-09-11T00:00:00.000Z',
      corpus_size: 2,
      query_count: 1,
      ground_truth_count: 1,
      source: 'full-memory-snapshot',
      labeling_policy: 'binary-human-labeled',
      strict_ci: true,
      ground_truth_reviewed: true,
    }),
  );
  writeFileSync(
    join(dir, 'queries.json'),
    JSON.stringify([{ query_id: 'q_ku_01', query: '합성지식 현재 값', language: 'ko', category: 'knowledge_update' }]),
  );
  writeFileSync(
    join(dir, 'ground-truth.json'),
    JSON.stringify([{
      queryId: '합성지식 현재 값',
      relevantIds: ['bench_syn_ku_fresh_0001'],
      ...(options.staleIds === undefined ? { staleIds: ['bench_syn_ku_stale_0001'] } : { staleIds: options.staleIds }),
    }]),
  );
  const row = (benchmarkId: string, sourceMemoryId: string, createdAt: string, content: string) =>
    JSON.stringify({
      benchmark_id: benchmarkId,
      source_memory_id: sourceMemoryId,
      type: 'semantic',
      tags: ['synthetic', 'knowledge-update'],
      created_at: createdAt,
      content,
    });
  writeFileSync(
    join(dir, 'corpus.jsonl'),
    `${row('bench_syn_ku_fresh_0001', 'syn_ku_fresh_0001', freshCreatedAt, '합성지식 현재 값은 50MB이다.')}\n${row('bench_syn_ku_stale_0001', 'syn_ku_stale_0001', staleCreatedAt, '합성지식 현재 값은 10MB이다.')}\n`,
  );
  writeFileSync(
    join(dir, 'category-mapping.json'),
    JSON.stringify({
      macro_categories: { knowledge_update: ['knowledge_update'] },
      query_overrides: {},
      query_id_to_category: { q_ku_01: 'knowledge_update' },
    }),
  );
}

describe('verifyReviewableBenchmark knowledge_update chronology', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `bm-ku-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a fresh timestamp later than stale, including the corpus space form', () => {
    writeKnowledgeUpdateFixture(dir, '2026-01-01T00:00:00.000Z', '2020-01-01 00:00:00');
    const result = verifyReviewableBenchmark(dir);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects a fresh timestamp that is not strictly later', () => {
    writeKnowledgeUpdateFixture(dir, '2020-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    const result = verifyReviewableBenchmark(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('fresh created_at must be later'))).toBe(true);
  });

  it('rejects a knowledge_update row without exactly one stale id', () => {
    writeKnowledgeUpdateFixture(dir, '2026-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', { staleIds: [] });
    const result = verifyReviewableBenchmark(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('exactly one fresh id and one stale id'))).toBe(true);
  });
});

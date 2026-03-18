import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { normalizeBenchmarkGroundTruths, verifyReviewableBenchmark } from './search-quality-review-verifier.js';

function writeFixtureDir(options: {
  manifest?: Record<string, unknown>;
  queries?: unknown[];
  groundTruth?: unknown[];
  corpusLines?: unknown[];
}): string {
  const fixtureDir = join(tmpdir(), `memento-review-verify-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(fixtureDir, { recursive: true });

  writeFileSync(
    join(fixtureDir, 'manifest.json'),
    `${JSON.stringify({
      benchmark_version: 'v1',
      created_at: '2026-03-17T00:00:00.000Z',
      corpus_size: 1,
      query_count: 1,
      ground_truth_count: 1,
      source: 'full-memory-snapshot',
      labeling_policy: 'binary-human-labeled',
      strict_ci: true,
      ground_truth_reviewed: false,
      ...options.manifest,
    }, null, 2)}\n`,
    'utf-8'
  );
  writeFileSync(
    join(fixtureDir, 'queries.json'),
    `${JSON.stringify(options.queries ?? [{ query_id: 'q_001', query: '사용자 언어 선호' }], null, 2)}\n`,
    'utf-8'
  );
  writeFileSync(
    join(fixtureDir, 'ground-truth.json'),
    `${JSON.stringify(options.groundTruth ?? [{ queryId: 'q_001', relevantIds: ['bench_mem_000001'] }], null, 2)}\n`,
    'utf-8'
  );
  writeFileSync(
    join(fixtureDir, 'corpus.jsonl'),
    `${(options.corpusLines ?? [{
      benchmark_id: 'bench_mem_000001',
      source_memory_id: 'mem_001',
      type: 'semantic',
      content: '사용자는 항상 한국어로 답변받기를 선호한다.',
    }]).map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf-8'
  );

  return fixtureDir;
}

describe('verifyReviewableBenchmark', () => {
  it('정상 fixture면 검증을 통과한다', () => {
    const fixtureDir = writeFixtureDir({});

    try {
      const result = verifyReviewableBenchmark(fixtureDir);

      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.summary.queryCount).toBe(1);
      expect(result.summary.groundTruthCount).toBe(1);
    } finally {
      if (existsSync(fixtureDir)) {
        rmSync(fixtureDir, { recursive: true });
      }
    }
  });

  it('reviewed=true인데 corpus에 없는 relevant id가 있으면 실패한다', () => {
    const fixtureDir = writeFixtureDir({
      manifest: { ground_truth_reviewed: true },
      groundTruth: [{ queryId: 'q_001', relevantIds: ['bench_mem_missing'] }],
    });

    try {
      const result = verifyReviewableBenchmark(fixtureDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some((error) => error.includes('bench_mem_missing'))).toBe(true);
    } finally {
      if (existsSync(fixtureDir)) {
        rmSync(fixtureDir, { recursive: true });
      }
    }
  });

  it('reviewed=true인데 query별 ground truth가 없으면 실패한다', () => {
    const fixtureDir = writeFixtureDir({
      manifest: { ground_truth_reviewed: true },
      groundTruth: [],
    });

    try {
      const result = verifyReviewableBenchmark(fixtureDir);

      expect(result.ok).toBe(false);
      expect(result.errors.some((error) => error.includes('ground_truth_reviewed=true'))).toBe(true);
    } finally {
      if (existsSync(fixtureDir)) {
        rmSync(fixtureDir, { recursive: true });
      }
    }
  });

  it('requireReviewed 옵션이 켜져 있으면 reviewed=false에서 실패한다', () => {
    const fixtureDir = writeFixtureDir({
      manifest: { ground_truth_reviewed: false },
    });

    try {
      const result = verifyReviewableBenchmark(fixtureDir, { requireReviewed: true });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain('Benchmark is not marked as reviewed (ground_truth_reviewed=false)');
    } finally {
      if (existsSync(fixtureDir)) {
        rmSync(fixtureDir, { recursive: true });
      }
    }
  });

  it('query_id 기반 ground truth는 query text로 정규화된다', () => {
    const fixtureDir = writeFixtureDir({
      queries: [{ query_id: 'q_001', query: '사용자 언어 선호' }],
      groundTruth: [{ queryId: 'q_001', relevantIds: ['bench_mem_000001'] }],
    });

    try {
      const normalized = normalizeBenchmarkGroundTruths(fixtureDir);
      expect(normalized[0]?.queryId).toBe('사용자 언어 선호');
    } finally {
      if (existsSync(fixtureDir)) {
        rmSync(fixtureDir, { recursive: true });
      }
    }
  });

  it('reviewed=true에서 같은 query ground truth가 중복되면 실패한다', () => {
    const fixtureDir = writeFixtureDir({
      manifest: { ground_truth_reviewed: true, ground_truth_count: 2 },
      groundTruth: [
        { queryId: 'q_001', relevantIds: ['bench_mem_000001'] },
        { queryId: '사용자 언어 선호', relevantIds: ['bench_mem_000001'] },
      ],
    });

    try {
      const result = verifyReviewableBenchmark(fixtureDir, { requireReviewed: true });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain(
        'ground_truth_reviewed=true requires exactly one ground truth entry for query q_001'
      );
    } finally {
      if (existsSync(fixtureDir)) {
        rmSync(fixtureDir, { recursive: true });
      }
    }
  });
});

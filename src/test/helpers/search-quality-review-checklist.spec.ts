import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { buildReviewChecklistMarkdown } from './search-quality-review-checklist.js';

describe('buildReviewChecklistMarkdown', () => {
  it('query 메타데이터, 현재 ground truth, 후보 기억 요약을 markdown으로 만든다', () => {
    const fixtureDir = join(tmpdir(), `memento-review-checklist-${Date.now()}`);
    mkdirSync(fixtureDir, { recursive: true });

    try {
      writeFileSync(
        join(fixtureDir, 'manifest.json'),
        `${JSON.stringify({
          benchmark_version: 'v1',
          created_at: '2026-03-17T00:00:00.000Z',
          corpus_size: 2,
          query_count: 1,
          ground_truth_count: 1,
          source: 'full-memory-snapshot',
          labeling_policy: 'binary-human-labeled',
          strict_ci: true,
          ground_truth_reviewed: false,
        }, null, 2)}\n`,
        'utf-8'
      );
      writeFileSync(
        join(fixtureDir, 'queries.json'),
        `${JSON.stringify([
          {
            query_id: 'q_001',
            query: '사용자 언어 선호',
            language: 'ko',
            category: 'preference',
            notes: '기억된 응답 언어 선호를 찾는다',
          },
        ], null, 2)}\n`,
        'utf-8'
      );
      writeFileSync(
        join(fixtureDir, 'ground-truth.json'),
        `${JSON.stringify([
          {
            queryId: 'q_001',
            relevantIds: ['bench_mem_000001'],
          },
        ], null, 2)}\n`,
        'utf-8'
      );
      writeFileSync(
        join(fixtureDir, 'label-candidates.json'),
        `${JSON.stringify([
          {
            query_id: 'q_001',
            query: '사용자 언어 선호',
            candidate_benchmark_ids: ['bench_mem_000001', 'bench_mem_000002'],
          },
        ], null, 2)}\n`,
        'utf-8'
      );
      writeFileSync(
        join(fixtureDir, 'corpus.jsonl'),
        [
          JSON.stringify({
            benchmark_id: 'bench_mem_000001',
            source_memory_id: 'mem_001',
            type: 'semantic',
            tags: ['language', 'preference'],
            content: '사용자는 항상 한국어로 답변받기를 선호한다.',
          }),
          JSON.stringify({
            benchmark_id: 'bench_mem_000002',
            source_memory_id: 'mem_002',
            type: 'episodic',
            tags: ['completed'],
            content: '지난주 검색 품질 벤치마크 계획 문서를 작성했다.',
          }),
          '',
        ].join('\n'),
        'utf-8'
      );

      const markdown = buildReviewChecklistMarkdown(fixtureDir);

      expect(markdown).toContain('# Search Quality Benchmark Review Checklist');
      expect(markdown).toContain('## Query q_001');
      expect(markdown).toContain('- Query: `사용자 언어 선호`');
      expect(markdown).toContain('- Current relevant IDs: `bench_mem_000001`');
      expect(markdown).toContain('### Current Relevant Memories');
      expect(markdown).toContain('- [x] `bench_mem_000001`');
      expect(markdown).toContain('- [ ] `bench_mem_000001`');
      expect(markdown).toContain('source: `mem_001`');
      expect(markdown).toContain('사용자는 항상 한국어로 답변받기를 선호한다.');
      expect(markdown).toContain('- [ ] `bench_mem_000002`');
    } finally {
      if (existsSync(fixtureDir)) {
        rmSync(fixtureDir, { recursive: true });
      }
    }
  });
});

import { describe, it, expect } from 'vitest';
import {
  WALL_MS,
  MIN_QUERY_COVERAGE,
  formatCategoryReportLine,
  formatCoverageLine,
  coverageBelowThreshold,
  formatEmbeddingRunHeader,
  anyCategoryFailsMrrGate,
} from './quality-benchmark-category-report.js';
import type { CategoryQualityReport } from '@memento/core/shared/types/benchmark.types.js';
import { resolveBenchmarkEmbeddingProvider } from '@memento/core/shared/types/benchmark.types.js';

function sampleReport(over: Partial<CategoryQualityReport> = {}): CategoryQualityReport {
  return {
    macro_category: 'episodic_recent',
    query_count: 3,
    authored_query_count: 3,
    mrr: 0.6,
    ndcg_at_5: 0.7,
    ndcg_at_10: 0.65,
    mean_top10_content_length: 412,
    mean_top10_long_doc_ratio: 0,
    threshold_passed: true,
    ...over,
  };
}

function passingReports(): CategoryQualityReport[] {
  return [
    sampleReport(),
    sampleReport({ macro_category: 'procedural' }),
    sampleReport({ macro_category: 'conceptual' }),
    sampleReport({ macro_category: 'tag_filter' }),
  ];
}

describe('quality-benchmark-category-report (T015)', () => {
  it('WALL_MS는 SC-006 상한(시드 이후 스크립트 구간, 30s)과 일치한다', () => {
    expect(WALL_MS).toBe(30_000);
  });

  it('MIN_QUERY_COVERAGE는 1.0이다', () => {
    expect(MIN_QUERY_COVERAGE).toBe(1.0);
  });

  it('formatCategoryReportLine은 헤더 형식과 동일한 한 줄을 만든다', () => {
    const line = formatCategoryReportLine(sampleReport());
    expect(line).toBe('episodic_recent | 3/3 | 0.6000 | 0.7000 | 0.6500 | 412 | PASS');
  });

  it('formatCoverageLine은 작성·채점 쿼리 수와 비율을 출력한다', () => {
    const reports = [
      sampleReport({ query_count: 4, authored_query_count: 4 }),
      sampleReport({ macro_category: 'procedural', query_count: 6, authored_query_count: 6 }),
      sampleReport({ macro_category: 'conceptual', query_count: 10, authored_query_count: 10 }),
      sampleReport({ macro_category: 'tag_filter', query_count: 6, authored_query_count: 6 }),
    ];
    expect(formatCoverageLine(reports)).toBe(
      'queries_authored=26 queries_scored=26 coverage=1.000'
    );
  });

  it('채점 수가 작성 수보다 적으면 coverageBelowThreshold가 true', () => {
    expect(
      coverageBelowThreshold([
        sampleReport({ query_count: 2, authored_query_count: 4 }),
        sampleReport({ macro_category: 'procedural', query_count: 6, authored_query_count: 6 }),
        sampleReport({ macro_category: 'conceptual', query_count: 10, authored_query_count: 10 }),
        sampleReport({ macro_category: 'tag_filter', query_count: 6, authored_query_count: 6 }),
      ])
    ).toBe(true);
  });

  it('모든 쿼리가 채점되면 coverageBelowThreshold는 false', () => {
    expect(coverageBelowThreshold(passingReports())).toBe(false);
  });

  it('authored 합이 0이면 coverageBelowThreshold는 true (fail-closed)', () => {
    expect(coverageBelowThreshold([])).toBe(true);
    expect(
      coverageBelowThreshold([
        sampleReport({ query_count: 0, authored_query_count: 0 }),
      ])
    ).toBe(true);
  });

  it('커버리지 미달은 MRR이 전부 통과해도 게이트를 실패시킨다', () => {
    const reports = [
      sampleReport({ query_count: 1, authored_query_count: 4 }),
      sampleReport({ macro_category: 'procedural' }),
      sampleReport({ macro_category: 'conceptual' }),
      sampleReport({ macro_category: 'tag_filter' }),
    ];
    expect(anyCategoryFailsMrrGate(reports)).toBe(false);
    expect(coverageBelowThreshold(reports)).toBe(true);
    expect(anyCategoryFailsMrrGate(reports) || coverageBelowThreshold(reports)).toBe(true);
  });

  it('macro 전체 scored=0이어도 authored는 coverage 분모에 남는다 (#934)', () => {
    // tag_filter 6건이 전부 빈 GT여도 리포트 행이 남아 coverage < 1.0
    const reports = [
      sampleReport({ macro_category: 'episodic_recent', query_count: 4, authored_query_count: 4 }),
      sampleReport({ macro_category: 'procedural', query_count: 6, authored_query_count: 6 }),
      sampleReport({ macro_category: 'conceptual', query_count: 10, authored_query_count: 10 }),
      sampleReport({
        macro_category: 'tag_filter',
        query_count: 0,
        authored_query_count: 6,
        mrr: 0,
        ndcg_at_5: 0,
        ndcg_at_10: 0,
        mean_top10_content_length: 0,
        threshold_passed: false,
      }),
    ];
    expect(formatCoverageLine(reports)).toBe(
      'queries_authored=26 queries_scored=20 coverage=0.769'
    );
    expect(coverageBelowThreshold(reports)).toBe(true);
  });

  it('anyCategoryFailsMrrGate는 MRR이 임계 미만인 카테고리가 있으면 true', () => {
    expect(anyCategoryFailsMrrGate(passingReports())).toBe(false);
    expect(
      anyCategoryFailsMrrGate([
        ...passingReports().slice(0, 3),
        sampleReport({ macro_category: 'tag_filter', mrr: 0.4, threshold_passed: false }),
      ])
    ).toBe(true);
  });

  it('평가 가능한 Ground Truth가 없는 필수 카테고리는 gate 실패', () => {
    expect(anyCategoryFailsMrrGate(passingReports().slice(0, 3))).toBe(true);
  });

  it('formatEmbeddingRunHeader는 provider와 vector dims를 출력한다 (#905)', () => {
    expect(formatEmbeddingRunHeader('minilm', 384)).toBe(
      'embedding_provider=minilm vector_dims=384'
    );
    expect(formatEmbeddingRunHeader('tfidf', 512)).toBe(
      'embedding_provider=tfidf vector_dims=512'
    );
  });

  it('resolveBenchmarkEmbeddingProvider는 EMBEDDING_PROVIDER를 존중하고 unset면 minilm', () => {
    const previous = process.env.EMBEDDING_PROVIDER;
    try {
      delete process.env.EMBEDDING_PROVIDER;
      expect(resolveBenchmarkEmbeddingProvider()).toBe('minilm');
      process.env.EMBEDDING_PROVIDER = 'tfidf';
      expect(resolveBenchmarkEmbeddingProvider()).toBe('tfidf');
      process.env.EMBEDDING_PROVIDER = 'not-a-provider';
      expect(resolveBenchmarkEmbeddingProvider()).toBe('minilm');
    } finally {
      if (previous === undefined) {
        delete process.env.EMBEDDING_PROVIDER;
      } else {
        process.env.EMBEDDING_PROVIDER = previous;
      }
    }
  });
});

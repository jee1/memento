import { describe, it, expect } from 'vitest';
import {
  WALL_MS,
  formatCategoryReportLine,
  anyCategoryFailsMrrGate,
} from './quality-benchmark-category-report.js';
import type { CategoryQualityReport } from '@memento/core/shared/types/benchmark.types.js';

function sampleReport(over: Partial<CategoryQualityReport> = {}): CategoryQualityReport {
  return {
    macro_category: 'episodic_recent',
    query_count: 3,
    mrr: 0.6,
    ndcg_at_5: 0.7,
    ndcg_at_10: 0.65,
    threshold_passed: true,
    ...over,
  };
}

describe('quality-benchmark-category-report (T015)', () => {
  it('WALL_MS는 SC-006 상한(시드 이후 스크립트 구간, 30s)과 일치한다', () => {
    expect(WALL_MS).toBe(30_000);
  });

  it('formatCategoryReportLine은 헤더 형식과 동일한 한 줄을 만든다', () => {
    const line = formatCategoryReportLine(sampleReport());
    expect(line).toBe('episodic_recent | 3 | 0.6000 | 0.7000 | 0.6500 | PASS');
  });

  it('anyCategoryFailsMrrGate는 MRR이 임계 미만인 카테고리가 있으면 true', () => {
    expect(anyCategoryFailsMrrGate([sampleReport({ threshold_passed: true })])).toBe(false);
    expect(anyCategoryFailsMrrGate([sampleReport({ mrr: 0.4, threshold_passed: false })])).toBe(true);
  });
});

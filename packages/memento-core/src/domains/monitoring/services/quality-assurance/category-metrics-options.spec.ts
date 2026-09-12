import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  CategoryQualityAggregator,
  top10LongDocRatio,
} from './category-quality-aggregator.js';

const BENCHMARK_DIR = 'tests/fixtures/search-quality/benchmark-v3';
const MAPPING_PATH = `${BENCHMARK_DIR}/category-mapping.json`;

const searchMock = vi.fn(async () => ({
  items: Array.from({ length: 10 }, (_, i) => ({
    id: `mem_mock_${i}`,
    content: 'x'.repeat(100),
    finalScore: 1 - i * 0.01,
  })),
}));

vi.mock('../../../search/factories/hybrid-search.factory.js', () => ({
  HybridSearchFactory: {
    createDefaultEngine: vi.fn(() => ({
      search: searchMock,
    })),
  },
}));

describe('CategoryMetricsOptions (#961)', () => {
  let db: Database.Database;
  let aggregator: CategoryQualityAggregator;

  beforeEach(() => {
    searchMock.mockClear();
    db = new Database(':memory:');
    aggregator = new CategoryQualityAggregator(db);
  });

  it('maxGroundTruthLength: 1024 → query_count 합 21, coverage scored/authored = 1.0', async () => {
    const reports = await aggregator.collect(BENCHMARK_DIR, MAPPING_PATH, {
      maxGroundTruthLength: 1024,
    });
    const scored = reports.reduce((s, r) => s + r.query_count, 0);
    const authored = reports.reduce((s, r) => s + r.authored_query_count, 0);
    expect(scored).toBe(21);
    expect(authored).toBe(21);
    expect(scored / authored).toBe(1);
  });

  it('옵션 미지정 호출 결과가 {} 를 넘긴 호출과 동일하다', async () => {
    const a = await aggregator.collect(BENCHMARK_DIR, MAPPING_PATH);
    const b = await aggregator.collect(BENCHMARK_DIR, MAPPING_PATH, {});
    expect(a).toEqual(b);
    expect(a.reduce((s, r) => s + r.query_count, 0)).toBe(26);
  });

  it('maxGroundTruthLength: 1 이면 4개 macro 행이 query_count: 0', async () => {
    const reports = await aggregator.collect(BENCHMARK_DIR, MAPPING_PATH, {
      maxGroundTruthLength: 1,
    });
    expect(reports).toHaveLength(4);
    expect(reports.every((r) => r.query_count === 0)).toBe(true);
    expect(reports.every((r) => r.mean_top10_long_doc_ratio === 0)).toBe(true);
  });
});

describe('top10LongDocRatio (#961)', () => {
  it('빈 결과는 0', () => {
    expect(top10LongDocRatio([])).toBe(0);
  });

  it('전부 2,000자 초과면 1', () => {
    const items = Array.from({ length: 10 }, () => ({ content: 'y'.repeat(2001) }));
    expect(top10LongDocRatio(items)).toBe(1);
  });

  it('경계 2,000자는 초과가 아니다', () => {
    const items = [
      { content: 'a'.repeat(2000) },
      { content: 'b'.repeat(2001) },
      { content: 'c'.repeat(100) },
    ];
    // top-10 = 3건, >2000 = 1건 → 1/3
    expect(top10LongDocRatio(items)).toBeCloseTo(1 / 3);
  });
});

/**
 * 하이브리드 SQL distance 계약 (#811 US5 / #806 FR-020 residual R1)
 *
 * SELECT는 cosine distance를 노출하고, 반환 점수 변환은 mapper 전용이다.
 * ORDER BY는 랭킹 효율을 위해 (1 - distance)를 쓸 수 있다.
 */

import { describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { executeHybridQuery } from './vector-search-hybrid-query.js';
import type {
  RuntimeVectorContext,
  VectorSearchExecutionOptions,
  VectorSearchScope
} from './vector-search.types.js';

const runtimeContext: RuntimeVectorContext = {
  provider: 'tfidf',
  expectedDimensions: 512,
  actualStoredDimensions: 512,
  targetDimensions: 512,
  tableName: 'memory_item_vec_tfidf'
};

const emptyScope: VectorSearchScope = {
  typeFilters: [],
  hasProjectScope: false,
  hasOwnerStringScope: false,
  ownerArrayScope: [],
  hasOwnerScope: false,
  hasProcessStringScope: false,
  processArrayScope: [],
  hasProcessScope: false,
  hasSessionStringScope: false,
  sessionArrayScope: [],
  hasSessionScope: false,
  hasScopeFilter: false
};

const options: VectorSearchExecutionOptions = {
  limit: 10,
  threshold: 0,
  includeContent: true,
  includeMetadata: true
};

/** SELECT 투영에서 distance→similarity 산술이 쓰였는지 (ORDER BY는 제외). */
function selectProjectionUsesPrecomputedSimilarity(sql: string): boolean {
  const withoutOrderBy = sql.split(/ORDER BY/i)[0] ?? sql;
  return /1\s*-\s*(?:vs\.vector_distance|t\.distance)/i.test(withoutOrderBy);
}

function captureHybridSql(textQuery: string | undefined): string {
  let captured = '';
  const db = {
    prepare: (sql: string) => {
      captured = sql;
      return { all: vi.fn().mockReturnValue([]) };
    }
  } as unknown as Database.Database;

  executeHybridQuery({
    db,
    effectiveQueryVector: new Array(512).fill(0.1),
    textQuery,
    runtimeContext,
    scope: emptyScope,
    options
  });

  return captured;
}

describe('executeHybridQuery SQL contract (#811 US5)', () => {
  it('텍스트 하이브리드 SELECT는 vector_distance를 노출하고 1-distance 변환을 SELECT에 두지 않는다', () => {
    const sql = captureHybridSql('test query');

    expect(sql).toMatch(/as vector_distance/i);
    expect(selectProjectionUsesPrecomputedSimilarity(sql)).toBe(false);
    // 반환 점수 변환은 mapper-only; ORDER BY는 랭킹용으로 (1 - distance) 허용
    expect(sql).toMatch(/ORDER BY[\s\S]*1\s*-\s*vector_distance/i);
  });

  it('벡터 전용 SELECT도 distance를 노출하고 SELECT 투영에서 1-distance 변환을 쓰지 않는다', () => {
    const sql = captureHybridSql(undefined);

    expect(sql).toMatch(/t\.distance\s+as\s+vector_distance/i);
    expect(selectProjectionUsesPrecomputedSimilarity(sql)).toBe(false);
  });

  it('텍스트-only 분기는 벡터 미매칭을 distance=1(→ similarity 0)로 보낸다', () => {
    const sql = captureHybridSql('only text');
    expect(sql).toMatch(/1\s+as\s+vector_distance/i);
  });
});

/**
 * #998: filters_applied 키 ↔ buildMemoryFilterSql 절 드리프트 가드
 */

import { describe, expect, it } from 'vitest';
import { getAppliedRecallFilters } from '../../domains/memory/recall/recall-tool-filters.js';
import type { MemorySearchFilters } from '../types/search.types.js';
import { buildMemoryFilterSql } from './memory-filter-sql.js';

/** 절차 기억 버전 필터 — 컬럼 필터가 아니라 recall 후처리에서 다룬다 */
const PROCEDURAL_VERSION_FILTER_KEYS = [
  'version_filter',
  'version_series_id',
  'version_number',
  'include_version_chain',
  'include_diff_with',
] as const;

const SAMPLE_VALUES: Record<string, unknown> = {
  type: ['semantic'],
  tags: ['alpha'],
  privacy_scope: ['private'],
  time_from: '2026-01-01T00:00:00Z',
  time_to: '2026-12-31T23:59:59Z',
  pinned: true,
  importance_min: 0.5,
  importance_max: 0.9,
  has_reflection_notes: true,
  owner_id: 'owner-1',
  process_id: 'process-1',
  session_id: 'session-1',
  project_id: 'project-1',
};

describe('memory-filter-sql contract (#998)', () => {
  it('getAppliedRecallFilters 가 에코하는 컬럼 필터 키마다 buildMemoryFilterSql 절을 만든다', () => {
    for (const [key, value] of Object.entries(SAMPLE_VALUES)) {
      const filters = { [key]: value } as MemorySearchFilters;
      const applied = getAppliedRecallFilters(filters);
      expect(applied).toHaveProperty(key);

      const { clauses } = buildMemoryFilterSql(filters, { itemAlias: 'm' });
      expect(clauses.length).toBeGreaterThan(0);
    }
  });

  it('절차 기억 버전 관련 키는 buildMemoryFilterSql 에 없다', () => {
    for (const key of PROCEDURAL_VERSION_FILTER_KEYS) {
      const filters = { [key]: key === 'version_number' ? 2 : 'latest' } as MemorySearchFilters;
      const { clauses } = buildMemoryFilterSql(filters, { itemAlias: 'm' });
      expect(clauses).toEqual([]);
    }
  });
});

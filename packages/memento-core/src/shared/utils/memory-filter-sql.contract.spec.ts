/**
 * #998: filters_applied 키 ↔ buildMemoryFilterSql 절 드리프트 가드
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { getAppliedRecallFilters } from '../../domains/memory/recall/recall-tool-filters.js';
import type { MemorySearchFilters } from '../types/search.types.js';
import { buildMemoryFilterSql } from './memory-filter-sql.js';

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

  it('one malformed tags value does not abort a tag filter (#1390)', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE m (id TEXT PRIMARY KEY, tags TEXT)');
      const insert = db.prepare('INSERT INTO m (id, tags) VALUES (?, ?)');
      insert.run('good', '["alpha"]');
      insert.run('other', '["beta"]');
      insert.run('broken', '{not-json');

      const { clauses, params } = buildMemoryFilterSql({ tags: ['alpha'] }, { itemAlias: 'm' });
      const rows = db.prepare(`SELECT id FROM m WHERE ${clauses.join(' AND ')}`).all(...params) as { id: string }[];

      expect(rows.map((row) => row.id)).toEqual(['good']);
    } finally {
      db.close();
    }
  });

  it('버전 체인·diff 와 all_versions 는 buildMemoryFilterSql 에 없다', () => {
    for (const key of ['include_version_chain', 'include_diff_with', 'version_series_id', 'version_number'] as const) {
      const filters = { [key]: key === 'version_number' ? 2 : 'latest' } as MemorySearchFilters;
      const { clauses } = buildMemoryFilterSql(filters, { itemAlias: 'm' });
      expect(clauses).toEqual([]);
    }
    const allVersions = buildMemoryFilterSql({ version_filter: 'all_versions' }, { itemAlias: 'm' });
    expect(allVersions.clauses).toEqual([]);
    const bareSpecific = buildMemoryFilterSql({ version_filter: 'specific_version' }, { itemAlias: 'm' });
    expect(bareSpecific.clauses).toEqual([]);
  });

  it('latest_only 와 specific_version 은 LIMIT 전에 거는 절을 만든다', () => {
    const latest = buildMemoryFilterSql({ version_filter: 'latest_only' }, { itemAlias: 'm' });
    expect(latest.clauses.join('\n')).toContain('NOT EXISTS');
    expect(latest.params).toEqual([]);

    const specific = buildMemoryFilterSql(
      { version_filter: 'specific_version', version_series_id: 'series-a', version_number: 2 },
      { itemAlias: 'm' }
    );
    expect(specific.clauses.join('\n')).toContain('m.version_series_id = ?');
    expect(specific.clauses.join('\n')).toContain('COALESCE(m.version, 0) = ?');
    expect(specific.params).toEqual(['series-a', 2]);
  });
});

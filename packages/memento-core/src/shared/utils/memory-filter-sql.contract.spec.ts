/**
 * #998: filters_applied 키 ↔ buildMemoryFilterSql 절 드리프트 가드
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { getAppliedRecallFilters } from '../../domains/memory/recall/recall-tool-filters.js';
import type { MemorySearchFilters } from '../types/search.types.js';
import { buildMemoryFilterSql, hasMemoryFilter } from './memory-filter-sql.js';

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
      const baseline = buildMemoryFilterSql(undefined, { itemAlias: 'm' });
      expect(clauses.length).toBeGreaterThan(baseline.clauses.length);
    }
  });

  it('one malformed tags value does not abort a tag filter (#1390)', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY, tags TEXT, superseded_by TEXT, is_deleted INTEGER DEFAULT 0)');
      const insert = db.prepare('INSERT INTO memory_item (id, tags) VALUES (?, ?)');
      insert.run('good', '["alpha"]');
      insert.run('other', '["beta"]');
      insert.run('broken', '{not-json');

      const { clauses, params } = buildMemoryFilterSql({ tags: ['alpha'] }, { itemAlias: 'm' });
      const rows = db.prepare(`SELECT id FROM memory_item m WHERE ${clauses.join(' AND ')}`).all(...params) as { id: string }[];

      expect(rows.map((row) => row.id)).toEqual(['good']);
    } finally {
      db.close();
    }
  });

  it('버전 체인·diff 와 all_versions 는 buildMemoryFilterSql 에 없다', () => {
    for (const key of ['include_version_chain', 'include_diff_with', 'version_series_id', 'version_number'] as const) {
      const filters = { [key]: key === 'version_number' ? 2 : 'latest' } as MemorySearchFilters;
      const { clauses } = buildMemoryFilterSql(filters, { itemAlias: 'm' });
      expect(clauses).toEqual(buildMemoryFilterSql(undefined, { itemAlias: 'm' }).clauses);
    }
    const allVersions = buildMemoryFilterSql({ version_filter: 'all_versions' }, { itemAlias: 'm' });
    expect(allVersions.clauses).toEqual(buildMemoryFilterSql(undefined, { itemAlias: 'm' }).clauses);
    const bareSpecific = buildMemoryFilterSql({ version_filter: 'specific_version' }, { itemAlias: 'm' });
    expect(bareSpecific.clauses).toEqual(buildMemoryFilterSql(undefined, { itemAlias: 'm' }).clauses);
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

describe('current state SQL (#1552)', () => {
  function fixture() {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE memory_item (
      id TEXT PRIMARY KEY, superseded_by TEXT, is_deleted INTEGER DEFAULT 0,
      owner_id TEXT, project_id TEXT, privacy_scope TEXT DEFAULT 'private'
    );
    INSERT INTO memory_item (id, superseded_by, owner_id, project_id) VALUES
      ('a', 'b', 'owner-a', 'project-a'), ('b', 'c', 'owner-a', 'project-a'),
      ('c', NULL, 'owner-a', 'project-a'), ('foreign', NULL, 'owner-b', 'project-b'),
      ('dangling', 'missing', 'owner-a', 'project-a');`);
    return db;
  }

  function ids(db: Database.Database, filters?: MemorySearchFilters) {
    const { clauses, params } = buildMemoryFilterSql(filters, { itemAlias: 'm' });
    return (db.prepare(`SELECT m.id FROM memory_item m
      WHERE m.is_deleted = 0 ${clauses.map(c => `AND ${c}`).join(' ')} ORDER BY m.id`)
      .all(...params) as { id: string }[]).map(row => row.id);
  }

  it('undefined/empty filters still exclude superseded candidates', () => {
    const db = fixture();
    try {
      expect(ids(db)).toEqual(['c', 'dangling', 'foreign']);
      expect(ids(db, {})).toEqual(ids(db));
      expect(ids(db, { owner_id: 'owner-a', project_id: 'project-a' })).toEqual(['c', 'dangling']);
      expect(hasMemoryFilter(undefined)).toBe(false);
      expect(hasMemoryFilter({})).toBe(false);
      expect(hasMemoryFilter(undefined, true)).toBe(true);
      expect(hasMemoryFilter({}, true)).toBe(true);
    } finally { db.close(); }
  });

  it('direct target soft/hard deletion revives only its predecessor', () => {
    const db = fixture();
    try {
      db.prepare("UPDATE memory_item SET is_deleted = 1 WHERE id = 'b'").run();
      expect(ids(db)).toEqual(['a', 'c', 'dangling', 'foreign']);
      db.prepare("DELETE FROM memory_item WHERE id = 'b'").run();
      expect(ids(db)).toEqual(['a', 'c', 'dangling', 'foreign']);
    } finally { db.close(); }
  });

  it('all NULL pointers are a result no-op and keep owner/project restrictions', () => {
    const db = fixture();
    try {
      db.exec('UPDATE memory_item SET superseded_by = NULL');
      expect(ids(db)).toEqual(['a', 'b', 'c', 'dangling', 'foreign']);
      expect(ids(db, { owner_id: 'owner-a', project_id: 'project-a' }))
        .toEqual(['a', 'b', 'c', 'dangling']);
    } finally { db.close(); }
  });
});

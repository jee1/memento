import { describe, expect, it } from 'vitest';
import { buildSearchStatement } from './search-engine-sql-builder.js';

describe('buildSearchStatement', () => {
  it('project/process/session 범위를 후보 LIMIT 전에 적용한다', async () => {
    const result = await buildSearchStatement({
      db: {} as never,
      searchQuery: 'scoped recall',
      filters: {
        project_id: 'project-a',
        process_id: 'process-a',
        session_id: 'session-a',
      },
      limit: 1,
      hasIdFilter: false,
      preferFts: true,
      checkFTS5Availability: async () => true,
      buildFTSQuery: (query) => query,
      buildReflectionNotesSearchCondition: () => null,
    });

    const candidateLimitIndex = result.sql.lastIndexOf('LIMIT ?');
    expect(result.sql).toContain('m.project_id = ?');
    expect(result.sql).toContain('m.process_id = ?');
    expect(result.sql).toContain('m.session_id = ?');
    expect(result.sql.indexOf('m.process_id = ?')).toBeLessThan(candidateLimitIndex);
    expect(result.sql.indexOf('m.session_id = ?')).toBeLessThan(candidateLimitIndex);
    expect(result.params).toEqual([
      'scoped recall',
      'project-a',
      'process-a',
      'session-a',
      3,
    ]);
  });

  it('LIKE fallback에서 검색 OR 그룹 뒤에 삭제 및 범위 조건을 적용한다', async () => {
    const result = await buildSearchStatement({
      db: {} as never,
      searchQuery: 'scoped recall',
      filters: {
        project_id: 'project-a',
        process_id: 'process-a',
        session_id: 'session-a',
      },
      limit: 1,
      hasIdFilter: false,
      preferFts: false,
      checkFTS5Availability: async () => false,
      buildFTSQuery: (query) => query,
      buildReflectionNotesSearchCondition: () => null,
    });

    const searchGroupEnd = result.sql.indexOf(')');
    expect(result.sql).toContain(
      'WHERE (m.content LIKE ? OR m.tags LIKE ? OR m.source LIKE ?)',
    );
    expect(result.sql.indexOf('(COALESCE(m.is_deleted, 0) = 0)')).toBeGreaterThan(searchGroupEnd);
    expect(result.sql.indexOf('m.project_id = ?')).toBeGreaterThan(searchGroupEnd);
    expect(result.sql.indexOf('m.process_id = ?')).toBeGreaterThan(searchGroupEnd);
    expect(result.sql.indexOf('m.session_id = ?')).toBeGreaterThan(searchGroupEnd);
  });

  it('tags 필터를 후보 LIMIT 전에 AND(⊇)로 적용한다 (#754)', async () => {
    const result = await buildSearchStatement({
      db: {} as never,
      searchQuery: 'channel isolation',
      filters: {
        tags: ['channel:discord', 'conv:c2'],
      },
      limit: 2,
      hasIdFilter: false,
      preferFts: true,
      checkFTS5Availability: async () => true,
      buildFTSQuery: (query) => query,
      buildReflectionNotesSearchCondition: () => null,
    });

    const candidateLimitIndex = result.sql.lastIndexOf('LIMIT ?');
    const tagExists = "EXISTS (SELECT 1 FROM json_each(COALESCE(m.tags, '[]')) WHERE value = ?)";
    expect(result.sql).toContain(tagExists);
    expect(result.sql.indexOf(tagExists)).toBeLessThan(candidateLimitIndex);
    expect(result.params).toEqual([
      'channel isolation',
      'channel:discord',
      'conv:c2',
      6,
    ]);
  });

  it('FTS5 rank는 낮은 값이 더 좋으므로 ASC로 정렬한다 (#787)', async () => {
    const result = await buildSearchStatement({
      db: {} as never,
      searchQuery: 'bm25 order',
      limit: 10,
      hasIdFilter: false,
      preferFts: true,
      checkFTS5Availability: async () => true,
      buildFTSQuery: (query) => query,
      buildReflectionNotesSearchCondition: () => null,
    });

    expect(result.sql).toMatch(/ORDER BY fts_rank ASC/);
    expect(result.sql).not.toMatch(/ORDER BY fts_rank DESC/);
    const limitIndex = result.sql.lastIndexOf('LIMIT ?');
    expect(result.sql.search(/ORDER BY fts_rank ASC/)).toBeLessThan(limitIndex);
  });
});

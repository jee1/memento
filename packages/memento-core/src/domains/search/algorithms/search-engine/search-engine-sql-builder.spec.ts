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

});

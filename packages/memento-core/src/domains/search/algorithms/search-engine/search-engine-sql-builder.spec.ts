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
});

import { describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { executeKnnQuery } from './vector-search-knn-query.js';
import type {
  RuntimeVectorContext,
  VectorSearchExecutionOptions,
  VectorSearchScope,
} from './vector-search.types.js';

const runtimeContext: RuntimeVectorContext = {
  provider: 'minilm',
  expectedDimensions: 384,
  actualStoredDimensions: 384,
  targetDimensions: 384,
  tableName: 'memory_item_vec_minilm',
  modelFilter: null,
};

const options: VectorSearchExecutionOptions = {
  limit: 3,
  threshold: 0,
  includeContent: true,
};

function captureKnnSql(
  scope: VectorSearchScope,
  context: RuntimeVectorContext = runtimeContext
): string {
  let captured = '';
  const db = {
    prepare: (sql: string) => {
      captured = sql;
      return { all: vi.fn().mockReturnValue([]) };
    },
  } as unknown as Database.Database;

  executeKnnQuery({
    db,
    effectiveQueryVector: new Array(384).fill(0.1),
    runtimeContext: context,
    scope,
    options,
  });

  return captured;
}

describe('executeKnnQuery scoped outer WHERE (#1386)', () => {
  it('project_id scope uses rowid IN and omits outer mi.project_id', () => {
    const sql = captureKnnSql({ project_id: 'obsidian-wiki', type: ['episodic'] });

    expect(sql).toMatch(/rowid IN \(/i);
    expect(sql).toMatch(/scoped_mi\.project_id/i);
    const joinAt = sql.lastIndexOf('JOIN memory_item mi');
    expect(joinAt).toBeGreaterThan(-1);
    const groupAt = sql.indexOf('GROUP BY', joinAt);
    expect(groupAt).toBeGreaterThan(joinAt);
    const afterJoin = sql.slice(joinAt, groupAt);
    expect(afterJoin).not.toMatch(/\bWHERE\b/);
    expect(afterJoin).not.toMatch(/mi\.project_id\s*=/i);
  });

  it('unfiltered requests apply current state and model before KNN LIMIT (#1552)', () => {
    const sql = captureKnnSql({}, { ...runtimeContext, modelFilter: 'test-model' });
    expect(sql).toMatch(/rowid IN \(/i);
    expect(sql).toContain('scoped_mi.superseded_by');
    expect(sql).toContain('scoped_me.model = ?');
  });

  it('uses 2-stage late materialization to aggregate top_k before joining wide memory_item columns (#1477)', () => {
    const sql = captureKnnSql({ project_id: 'obsidian-wiki' });

    const topKStart = sql.indexOf('FROM (  SELECT     me.memory_id as memory_id,     MIN(t.distance) as similarity');
    expect(topKStart).toBeGreaterThan(-1);
    const topKEnd = sql.indexOf(') top_k JOIN memory_item m ON m.id = top_k.memory_id', topKStart);
    expect(topKEnd).toBeGreaterThan(topKStart);
    const innerSubquery = sql.slice(topKStart, topKEnd);
    expect(innerSubquery).not.toMatch(/\bmi\.content\b/);
    expect(innerSubquery).not.toMatch(/\bmi\.reflection_notes\b/);
    expect(innerSubquery).toMatch(/GROUP BY me\.memory_id\s+ORDER BY similarity ASC\s+LIMIT \?/);
  });
});

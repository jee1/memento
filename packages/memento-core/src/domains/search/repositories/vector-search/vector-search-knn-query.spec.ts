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

/** hiddenEmbeddingRows null means no live pointers; a number is what the hidden-row count returns. */
function captureKnn(
  scope: VectorSearchScope,
  context: RuntimeVectorContext = runtimeContext,
  hiddenEmbeddingRows: number | null = null,
): { sql: string; params: unknown[] } {
  let captured = '';
  let params: unknown[] = [];
  const db = {
    prepare: (sql: string) => {
      captured = sql;
      return {
        all: (...values: unknown[]) => { params = values; return []; },
        get: () => hiddenEmbeddingRows === null ? undefined : { found: 1, hidden: hiddenEmbeddingRows },
      };
    },
  } as unknown as Database.Database;

  executeKnnQuery({
    db,
    effectiveQueryVector: new Array(384).fill(0.1),
    runtimeContext: context,
    scope,
    options,
  });

  return { sql: captured, params };
}

function captureKnnSql(scope: VectorSearchScope, context?: RuntimeVectorContext): string {
  return captureKnn(scope, context).sql;
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

  it('live pointers alone keep unscoped KNN and dig deeper by the embedding rows they hide (#1615)', () => {
    const { sql, params } = captureKnn({}, { ...runtimeContext, modelFilter: 'test-model' }, 7);
    expect(sql).not.toMatch(/rowid IN \(/i);
    expect(sql).toMatch(/ORDER BY distance ASC\s+LIMIT \?/);
    expect(sql).toContain('mi.superseded_by');
    expect(sql).toContain('me.model = ?');
    expect(params[1]).toBe(100 + 7);
  });

  it('falls back to rowid IN before KNN when the deeper k would exceed the vec0 limit (#1615)', () => {
    const { sql, params } = captureKnn({}, runtimeContext, 5000);
    expect(sql).toMatch(/rowid IN \(/i);
    expect(sql).toContain('scoped_mi.superseded_by');
    expect(params[1]).toBe(100);
  });

  it('zero live pointers preserve unscoped SQL instead of materializing every candidate (#1552)', () => {
    const sql = captureKnnSql({});
    expect(sql).not.toMatch(/rowid IN \(/i);
    expect(sql).not.toContain('superseded_by');
    expect(sql).toMatch(/ORDER BY distance ASC\s+LIMIT \?/);
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

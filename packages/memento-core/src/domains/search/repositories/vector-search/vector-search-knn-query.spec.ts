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
    const afterJoin = sql.split(/JOIN memory_item mi[\s\S]*?\) = 0\)\s*/i)[1] ?? '';
    expect(afterJoin).not.toMatch(/mi\.project_id\s*=/i);
    expect(afterJoin).not.toMatch(/^WHERE\s+/i);
  });

  it('unscoped path still filters by model on the outer query', () => {
    const sql = captureKnnSql({}, { ...runtimeContext, modelFilter: 'test-model' });
    expect(sql).not.toMatch(/rowid IN \(/i);
    expect(sql).toMatch(/WHERE me\.model = \?/);
  });
});

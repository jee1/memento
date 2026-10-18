import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { MINILM_MODEL_NAME } from '../../../../shared/config/embedding-models.js';
import { initializeDatabase } from '../../../../infrastructure/database/sqlite/init.js';
import { encodeFloat32Embedding } from '../../../../shared/utils/embedding-serialization.js';
import { executeKnnQuery } from './vector-search-knn-query.js';
import { resolveRuntimeVectorContext } from './vector-search-runtime-context.js';
import type { VectorSearchExecutionOptions } from './vector-search.types.js';

const DIMENSIONS = 384;
const PROJECT = 'plan-wiki';
const ROW_COUNT = 40;

const vecAvailable = await import('sqlite-vec')
  .then(() => true)
  .catch(() => false);

function unitVector(axis: number): number[] {
  const values = new Array<number>(DIMENSIONS).fill(0);
  values[axis] = 1;
  return values;
}

function insertMemory(
  db: Database.Database,
  id: string,
  vector: number[],
  projectId: string
): void {
  db.prepare(
    `INSERT INTO memory_item (id, type, content, project_id)
     VALUES (?, 'episodic', ?, ?)`
  ).run(id, `content ${id}`, projectId);
  db.prepare(
    `INSERT INTO memory_embedding
       (memory_id, embedding_provider, projection_type, embedding, dim, model, dimensions, precision, normalized, version, created_by)
     VALUES (?, 'minilm', 'native', ?, ?, ?, ?, 32, 1, 1, 'test')`
  ).run(id, encodeFloat32Embedding(vector), DIMENSIONS, MINILM_MODEL_NAME, DIMENSIONS);
}

const options: VectorSearchExecutionOptions = {
  limit: 3,
  threshold: 0,
  includeContent: true,
};

describe.skipIf(!vecAvailable)('scoped KNN query plan (#1386)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('EXPLAIN QUERY PLAN first detail is vec0 SCAN, not memory_item project index', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knn-plan-1386-'));
    tempDirs.push(dir);
    const db = await initializeDatabase(join(dir, 'test.db'));

    for (let i = 0; i < ROW_COUNT; i++) {
      insertMemory(db, `mem_${i}`, unitVector(i % DIMENSIONS), PROJECT);
    }
    insertMemory(db, 'out-of-scope', unitVector(0), 'other-project');

    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const runtimeContext = resolveRuntimeVectorContext(db, 'minilm');
    const originalPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes('embedding MATCH') && sql.includes('GROUP BY me.memory_id')) {
        capturedSql = sql;
        const originalAll = stmt.all.bind(stmt);
        stmt.all = (...params: unknown[]) => {
          capturedParams = params;
          return originalAll(...params);
        };
      }
      return stmt;
    }) as typeof db.prepare;

    const results = executeKnnQuery({
      db,
      effectiveQueryVector: unitVector(0),
      runtimeContext,
      scope: { project_id: PROJECT, type: ['episodic'] },
      options,
    });
    const ids = results.map((row) => row.memory_id);
    expect(ids).toContain('mem_0');
    expect(ids).not.toContain('out-of-scope');

    expect(capturedSql).toMatch(/rowid IN \(/i);
    expect(capturedSql).not.toMatch(/JOIN memory_item mi[\s\S]*WHERE\s+mi\.project_id/i);

    const plan = originalPrepare(`EXPLAIN QUERY PLAN ${capturedSql}`).all(
      ...capturedParams
    ) as Array<{ detail: string }>;
    const details = plan.map((row) => row.detail);
    expect(details[0] ?? '').toMatch(/SCAN memory_item_vec_minilm VIRTUAL TABLE/i);
    expect(details[0] ?? '').not.toMatch(/idx_memory_item_project_id/i);

    db.close();
  });
});

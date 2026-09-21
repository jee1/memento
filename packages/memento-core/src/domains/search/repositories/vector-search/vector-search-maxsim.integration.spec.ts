/**
 * #1112: memory_id 별 MIN(distance) max-sim 집계 통합 테스트
 */

import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { MINILM_MODEL_NAME } from '../../../../shared/config/embedding-models.js';
import { initializeDatabase } from '../../../../infrastructure/database/sqlite/init.js';
import { encodeFloat32Embedding } from '../../../../shared/utils/embedding-serialization.js';
import { executeHybridQuery } from './vector-search-hybrid-query.js';
import { executeKnnQuery } from './vector-search-knn-query.js';
import { resolveRuntimeVectorContext } from './vector-search-runtime-context.js';
import type { VectorSearchExecutionOptions } from './vector-search.types.js';

const DIMENSIONS = 384;

// #1103 교훈: 확장이 없을 때 조용히 통과하면 계측기가 눈이 먼 채 초록으로 보인다. skip 으로 드러낸다.
let vecAvailable = false;
try {
  await import('sqlite-vec');
  vecAvailable = true;
} catch {
  vecAvailable = false;
}

function unitVector(axis: number): number[] {
  const values = new Array<number>(DIMENSIONS).fill(0);
  values[axis] = 1;
  return values;
}

function partiallyAlignedVector(axis: number, strength = 0.8): number[] {
  const values = new Array<number>(DIMENSIONS).fill(0);
  values[axis] = strength;
  values[(axis + 1) % DIMENSIONS] = Math.sqrt(1 - strength * strength);
  return values;
}

interface EmbeddingRow {
  projection_type: string;
  vector: number[];
}

function insertMemory(
  db: Database.Database,
  id: string,
  content: string,
  embeddings: EmbeddingRow[]
): void {
  db.prepare(
    "INSERT INTO memory_item (id, type, content) VALUES (?, 'semantic', ?)"
  ).run(id, content);

  for (const embedding of embeddings) {
    db.prepare(
      `INSERT INTO memory_embedding
         (memory_id, embedding_provider, projection_type, embedding, dim, model, dimensions, precision, normalized, version, created_by)
       VALUES (?, 'minilm', ?, ?, ?, ?, ?, 32, 1, 1, 'test')`
    ).run(
      id,
      embedding.projection_type,
      encodeFloat32Embedding(embedding.vector),
      DIMENSIONS,
      MINILM_MODEL_NAME,
      DIMENSIONS
    );
  }
}

const queryVector = unitVector(0);
const executionOptions: VectorSearchExecutionOptions = {
  limit: 10,
  threshold: 0,
  includeContent: true,
};

describe('vector search max-sim (#1112)', () => {
  let db: Database.Database | undefined;
  let tempDir: string | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it.skipIf(!vecAvailable)('Given 멀티 윈도 문서와 단일 윈도 문서 When executeKnnQuery Then A가 1위이고 A는 한 번만 나온다', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'memento-maxsim-knn-'));
    db = await initializeDatabase(join(tempDir, 'memory.db'));

    // memory A: native/window:0는 쿼리와 멀고, window:1만 매우 가깝다.
    insertMemory(db, 'mem_a', 'multi-window document', [
      { projection_type: 'native', vector: unitVector(1) },
      { projection_type: 'window:0', vector: unitVector(2) },
      { projection_type: 'window:1', vector: queryVector },
    ]);

    // memory B: native 한 행만, A.native 보다는 가깝고 A.window:1 보다는 멀다.
    insertMemory(db, 'mem_b', 'single-window document', [
      { projection_type: 'native', vector: partiallyAlignedVector(0, 0.85) },
    ]);

    const runtimeContext = resolveRuntimeVectorContext(db, 'minilm');
    const results = executeKnnQuery({
      db,
      effectiveQueryVector: queryVector,
      runtimeContext,
      scope: {},
      options: executionOptions,
    });

    const ids = results.map(row => row.memory_id);
    expect(ids[0]).toBe('mem_a');
    expect(ids.filter(id => id === 'mem_a')).toHaveLength(1);
  });

  it.skipIf(!vecAvailable)('Given 단일 윈도 문서만 3건 When executeKnnQuery Then GROUP BY 도입 전후와 같은 순서·개수', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'memento-maxsim-single-'));
    db = await initializeDatabase(join(tempDir, 'memory.db'));

    insertMemory(db, 'mem_close', 'closest', [
      { projection_type: 'native', vector: partiallyAlignedVector(0, 0.95) },
    ]);
    insertMemory(db, 'mem_mid', 'middle', [
      { projection_type: 'native', vector: partiallyAlignedVector(0, 0.75) },
    ]);
    insertMemory(db, 'mem_far', 'farthest', [
      { projection_type: 'native', vector: partiallyAlignedVector(0, 0.55) },
    ]);

    const runtimeContext = resolveRuntimeVectorContext(db, 'minilm');
    const results = executeKnnQuery({
      db,
      effectiveQueryVector: queryVector,
      runtimeContext,
      scope: {},
      options: { ...executionOptions, limit: 3 },
    });

    expect(results.map(row => row.memory_id)).toEqual(['mem_close', 'mem_mid', 'mem_far']);
    expect(results).toHaveLength(3);
  });

  it.skipIf(!vecAvailable)('Given 멀티 윈도 문서와 단일 윈도 문서 When textQuery 없이 executeHybridQuery Then A가 1위이고 A는 한 번만 나온다', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'memento-maxsim-hybrid-'));
    db = await initializeDatabase(join(tempDir, 'memory.db'));

    insertMemory(db, 'mem_a', 'multi-window document', [
      { projection_type: 'native', vector: unitVector(1) },
      { projection_type: 'window:0', vector: unitVector(2) },
      { projection_type: 'window:1', vector: queryVector },
    ]);
    insertMemory(db, 'mem_b', 'single-window document', [
      { projection_type: 'native', vector: partiallyAlignedVector(0, 0.85) },
    ]);

    const runtimeContext = resolveRuntimeVectorContext(db, 'minilm');
    const results = executeHybridQuery({
      db,
      effectiveQueryVector: queryVector,
      textQuery: undefined,
      runtimeContext,
      scope: {},
      options: executionOptions,
    });

    const ids = results.map(row => row.memory_id);
    expect(ids[0]).toBe('mem_a');
    expect(ids.filter(id => id === 'mem_a')).toHaveLength(1);
  });
});

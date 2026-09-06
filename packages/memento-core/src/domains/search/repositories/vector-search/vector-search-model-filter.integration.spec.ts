/**
 * #889: 재색인 도중 한 provider 안에 옛 모델과 새 모델 임베딩이 섞여 있어도
 * 현재 모델로 만든 벡터만 비교해야 한다. 모델이 다르면 차원이 같아도 벡터 공간이
 * 달라 코사인 거리가 의미를 잃기 때문이다.
 */

import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MINILM_MODEL_NAME } from '../../../../shared/config/embedding-models.js';
import { initializeDatabase } from '../../../../infrastructure/database/sqlite/init.js';
import { encodeFloat32Embedding } from '../../../../shared/utils/embedding-serialization.js';
import { VectorSearchRepositoryImpl } from '../vector-search.repository.js';

const STALE_MODEL = 'all-MiniLM-L6-v2';
const DIMENSIONS = 384;

let vecAvailable = false;

beforeAll(async () => {
  try {
    await import('sqlite-vec');
    vecAvailable = true;
  } catch {
    vecAvailable = false;
  }
});

/** 첫 축만 1인 단위 벡터. 쿼리 벡터로 쓴다. */
function unitVector(axis: number): number[] {
  const values = new Array<number>(DIMENSIONS).fill(0);
  values[axis] = 1;
  return values;
}

/**
 * 쿼리(unitVector(0))와 코사인 0.8인 단위 벡터.
 * 직교 벡터(코사인 0)를 쓰면 hybrid 경로에서 similarity가 0이 되고, bm25 rank가 음수라
 * threshold 필터에 함께 걸려 나가 모델 필터를 검증할 수 없다.
 */
function partiallyAlignedVector(): number[] {
  const values = new Array<number>(DIMENSIONS).fill(0);
  values[0] = 0.8;
  values[1] = 0.6;
  return values;
}

function insertMemory(db: Database.Database, id: string, content: string, vector: number[], model: string): void {
  db.prepare(`INSERT INTO memory_item (id, type, content, importance, created_at)
              VALUES (?, 'semantic', ?, 0.5, CURRENT_TIMESTAMP)`).run(id, content);
  db.prepare(`INSERT INTO memory_embedding
                (memory_id, embedding_provider, projection_type, embedding, dim, model, dimensions, precision, normalized, version, created_by)
              VALUES (?, 'minilm', 'native', ?, ?, ?, ?, 32, 1, 1, 'test')`)
    .run(id, encodeFloat32Embedding(vector), DIMENSIONS, model, DIMENSIONS);
}

describe('#889 모델이 섞인 상태의 벡터 검색', () => {
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

  async function seedMixedDatabase(): Promise<VectorSearchRepositoryImpl> {
    tempDir = mkdtempSync(join(tmpdir(), 'memento-model-filter-'));
    db = await initializeDatabase(join(tempDir, 'memory.db'));
    // 옛 모델 행이 쿼리와 정확히 같은 방향이다. 모델을 거르지 않으면 항상 1등으로 나온다.
    insertMemory(db, 'stale-1', '옛 모델로 만든 임베딩', unitVector(0), STALE_MODEL);
    insertMemory(db, 'current-1', '현재 모델로 만든 임베딩', partiallyAlignedVector(), MINILM_MODEL_NAME);
    return new VectorSearchRepositoryImpl(db);
  }

  it('KNN 검색은 현재 모델 행만 돌려준다', async () => {
    if (!vecAvailable) return;
    const repository = await seedMixedDatabase();

    const results = await repository.search({
      queryVector: unitVector(0),
      provider: 'minilm',
      options: { limit: 10, threshold: 0 },
    });

    expect(results.map((row) => row.memory_id)).toEqual(['current-1']);
  });

  it('타입 필터가 걸린 KNN 경로에서도 현재 모델 행만 돌려준다', async () => {
    if (!vecAvailable) return;
    const repository = await seedMixedDatabase();

    const results = await repository.search({
      queryVector: unitVector(0),
      provider: 'minilm',
      options: { limit: 10, threshold: 0, type: ['semantic'] },
    });

    expect(results.map((row) => row.memory_id)).toEqual(['current-1']);
  });

  it('하이브리드 검색도 현재 모델 행만 벡터 후보로 쓴다', async () => {
    if (!vecAvailable) return;
    const repository = await seedMixedDatabase();

    const results = await repository.hybridSearch({
      queryVector: unitVector(0),
      textQuery: '임베딩',
      provider: 'minilm',
      options: { limit: 10, threshold: 0.1 },
    });

    // stale-1은 쿼리와 완전히 같은 방향이라, 모델을 거르지 않으면 1등으로 나온다.
    // 텍스트 매칭만 남으면 벡터 기여가 0이라 threshold 아래로 떨어진다.
    expect(results.map((row) => row.memory_id)).toEqual(['current-1']);
  });

  it('모든 행이 현재 모델이면 아무것도 걸러내지 않는다', async () => {
    if (!vecAvailable) return;
    tempDir = mkdtempSync(join(tmpdir(), 'memento-model-filter-'));
    db = await initializeDatabase(join(tempDir, 'memory.db'));
    insertMemory(db, 'a', '첫 번째', unitVector(0), MINILM_MODEL_NAME);
    insertMemory(db, 'b', '두 번째', partiallyAlignedVector(), MINILM_MODEL_NAME);

    const results = await new VectorSearchRepositoryImpl(db).search({
      queryVector: unitVector(0),
      provider: 'minilm',
      options: { limit: 10, threshold: 0 },
    });

    expect(results.map((row) => row.memory_id).sort()).toEqual(['a', 'b']);
  });
});

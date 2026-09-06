/**
 * memory_embedding을 다시 쓸 때 vec 인덱스에 고아 행이 남지 않아야 한다.
 *
 * `INSERT OR REPLACE`는 REPLACE가 유발한 삭제에 DELETE 트리거를 실행하지 않는다
 * (`PRAGMA recursive_triggers` 기본값이 꺼짐). 그래서 옛 행의 id를 rowid로 가진
 * vec0 행이 남고, KNN의 LIMIT 예산을 아무 결과도 못 내는 채로 소진한다.
 */

import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { encodeFloat32Embedding } from '../../../../shared/utils/embedding-serialization.js';
import { deleteOrphanVecRows } from '../migration/migrations/045-vec-orphan-cleanup.js';
import { initializeDatabase } from '../init.js';
import { replaceMemoryEmbedding } from '../../../../shared/utils/memory-embedding-write.js';

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

function vector(seed: number): number[] {
  const values = new Array<number>(DIMENSIONS).fill(0);
  values[seed % DIMENSIONS] = 1;
  return values;
}

function write(db: Database.Database, memoryId: string, seed: number, model: string): Promise<void> {
  return replaceMemoryEmbedding(db, {
    memoryId,
    provider: 'minilm',
    projectionType: 'native',
    embedding: encodeFloat32Embedding(vector(seed)),
    dim: DIMENSIONS,
    model,
    dimensions: DIMENSIONS,
    normalized: 1,
    createdBy: 'test',
  });
}

function orphanCount(db: Database.Database, table: string): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE rowid NOT IN (SELECT id FROM memory_embedding)`)
      .get() as { c: number }
  ).c;
}

describe('memory_embedding 재작성과 vec 인덱스', () => {
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

  async function freshDb(): Promise<Database.Database> {
    tempDir = mkdtempSync(join(tmpdir(), 'memento-embedding-write-'));
    db = await initializeDatabase(join(tempDir, 'memory.db'));
    db.prepare(
      `INSERT INTO memory_item (id, type, content, importance, created_at)
       VALUES ('m1', 'semantic', '재임베딩 대상', 0.5, CURRENT_TIMESTAMP)`
    ).run();
    return db;
  }

  it('같은 메모리를 세 번 다시 임베딩해도 vec 행은 하나뿐이다', async () => {
    if (!vecAvailable) return;
    const database = await freshDb();

    await write(database, 'm1', 0, 'model-a');
    await write(database, 'm1', 1, 'model-b');
    await write(database, 'm1', 2, 'model-c');

    const embeddings = database
      .prepare("SELECT COUNT(*) AS c FROM memory_embedding WHERE memory_id = 'm1'")
      .get() as { c: number };
    expect(embeddings.c).toBe(1);

    for (const table of ['memory_item_vec', 'memory_item_vec_minilm']) {
      const total = database.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
      expect(total.c, `${table} 행 수`).toBe(1);
      expect(orphanCount(database, table), `${table} 고아 행`).toBe(0);
    }
  });

  it('마지막으로 쓴 모델이 남는다', async () => {
    if (!vecAvailable) return;
    const database = await freshDb();

    await write(database, 'm1', 0, 'model-a');
    await write(database, 'm1', 1, 'model-b');

    const row = database
      .prepare("SELECT model FROM memory_embedding WHERE memory_id = 'm1'")
      .get() as { model: string };
    expect(row.model).toBe('model-b');
  });

  it('마이그레이션 045는 이미 쌓인 고아 행을 지운다', async () => {
    if (!vecAvailable) return;
    const database = await freshDb();
    await write(database, 'm1', 0, 'model-a');

    // 옛 쓰기 경로를 그대로 재현한다. INSERT OR REPLACE는 DELETE 트리거를 건너뛰므로
    // 옛 행의 id를 rowid로 가진 vec 행이 그대로 남는다.
    database
      .prepare(
        `INSERT OR REPLACE INTO memory_embedding
           (memory_id, embedding_provider, projection_type, embedding, dim, model,
            dimensions, precision, normalized, version, created_by, created_at)
         VALUES ('m1', 'minilm', 'native', ?, 384, 'model-b', 384, 32, 1, 1, 'test', CURRENT_TIMESTAMP)`
      )
      .run(encodeFloat32Embedding(vector(3)));
    expect(orphanCount(database, 'memory_item_vec_minilm'), '옛 경로가 고아 행을 남겼는지').toBe(1);

    // memory_item_vec와 memory_item_vec_minilm 양쪽에 하나씩 남는다.
    expect(deleteOrphanVecRows(database)).toBe(2);
    expect(orphanCount(database, 'memory_item_vec_minilm')).toBe(0);
    const kept = database.prepare('SELECT COUNT(*) AS c FROM memory_item_vec_minilm').get() as { c: number };
    expect(kept.c).toBe(1);
  });
});

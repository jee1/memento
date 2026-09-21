import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeDatabase } from '../../../infrastructure/database/sqlite/init.js';
import { encodeFloat32Embedding } from '../embedding-serialization.js';
import { replaceMemoryEmbedding } from '../memory-embedding-write.js';
import {
  MAX_WINDOW_ROWS,
  buildWindowProjectionType,
  isWindowProjectionType,
  replaceWindowEmbeddings,
} from '../window-embedding-write.js';

const MEMORY_ID = 'mem-window-test';
const PROVIDER = 'minilm';

// #1103 교훈: 확장이 없을 때 조용히 통과하면 계측기가 눈이 먼 채 초록으로 보인다. skip 으로 드러낸다.
let vecAvailable = false;
try {
  await import('sqlite-vec');
  vecAvailable = true;
} catch {
  vecAvailable = false;
}

async function insertNativeRow(db: Database.Database): Promise<void> {
  const vector = [0.1, 0.2, 0.3];
  await replaceMemoryEmbedding(db, {
    memoryId: MEMORY_ID,
    provider: PROVIDER,
    projectionType: 'native',
    embedding: encodeFloat32Embedding(vector),
    dim: vector.length,
    model: 'test-model',
    dimensions: vector.length,
    normalized: 0,
    createdBy: 'test',
  });
}

function listProjectionTypes(db: Database.Database): string[] {
  return (
    db
      .prepare(
        'SELECT projection_type FROM memory_embedding WHERE memory_id = ? AND embedding_provider = ? ORDER BY projection_type'
      )
      .all(MEMORY_ID, PROVIDER) as Array<{ projection_type: string }>
  ).map((row) => row.projection_type);
}

function makeVectors(count: number, dim = 3): number[][] {
  return Array.from({ length: count }, (_, index) =>
    Array.from({ length: dim }, (_, dimIndex) => index + dimIndex * 0.01)
  );
}

describe('window-embedding-write', () => {
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

  async function initTestDb(): Promise<Database.Database> {
    tempDir = mkdtempSync(join(tmpdir(), 'memento-window-embed-'));
    db = await initializeDatabase(join(tempDir, 'memory.db'));
    db.prepare("INSERT INTO memory_item (id, type, content) VALUES (?, 'semantic', ?)").run(
      MEMORY_ID,
      'test content'
    );
    return db;
  }

  it.skipIf(!vecAvailable)('Given: native 행만 있는 상태, When: vectors 2개로 replaceWindowEmbeddings 호출, Then: window:0·window:1 행이 생기고 native는 유지되어야 함', async () => {
    const testDb = await initTestDb();
    await insertNativeRow(testDb);

    await replaceWindowEmbeddings(testDb, {
      memoryId: MEMORY_ID,
      provider: PROVIDER,
      model: 'test-model',
      vectors: makeVectors(2),
    });

    expect(listProjectionTypes(testDb)).toEqual(['native', 'window:0', 'window:1']);
  });

  it.skipIf(!vecAvailable)('Given: native 행만 있는 상태, When: vectors 1개로 replaceWindowEmbeddings 호출, Then: 윈도 행은 생기지 않아야 함', async () => {
    const testDb = await initTestDb();
    await insertNativeRow(testDb);

    await replaceWindowEmbeddings(testDb, {
      memoryId: MEMORY_ID,
      provider: PROVIDER,
      model: 'test-model',
      vectors: makeVectors(1),
    });

    expect(listProjectionTypes(testDb)).toEqual(['native']);
  });

  it.skipIf(!vecAvailable)('Given: 윈도 3개가 저장된 상태, When: 윈도 2개로 다시 저장, Then: window:2 행이 남지 않아야 함', async () => {
    const testDb = await initTestDb();

    await replaceWindowEmbeddings(testDb, {
      memoryId: MEMORY_ID,
      provider: PROVIDER,
      model: 'test-model',
      vectors: makeVectors(3),
    });

    await replaceWindowEmbeddings(testDb, {
      memoryId: MEMORY_ID,
      provider: PROVIDER,
      model: 'test-model',
      vectors: makeVectors(2),
    });

    expect(listProjectionTypes(testDb)).toEqual(['window:0', 'window:1']);
  });

  it.skipIf(!vecAvailable)(`Given: MAX_WINDOW_ROWS(${MAX_WINDOW_ROWS})보다 많은 벡터, When: replaceWindowEmbeddings 호출, Then: 앞에서부터 ${MAX_WINDOW_ROWS}개만 저장되어야 함`, async () => {
    const testDb = await initTestDb();

    await replaceWindowEmbeddings(testDb, {
      memoryId: MEMORY_ID,
      provider: PROVIDER,
      model: 'test-model',
      vectors: makeVectors(MAX_WINDOW_ROWS + 3),
    });

    const types = listProjectionTypes(testDb);
    expect(types).toHaveLength(MAX_WINDOW_ROWS);
    for (let i = 0; i < MAX_WINDOW_ROWS; i++) {
      expect(types).toContain(`window:${i}`);
    }
    expect(types).not.toContain(`window:${MAX_WINDOW_ROWS}`);
  });

  it("Given: projection type 식별자, When: buildWindowProjectionType(0)과 isWindowProjectionType('native') 호출, Then: 'window:0'과 false를 반환해야 함", () => {
    expect(buildWindowProjectionType(0)).toBe('window:0');
    expect(isWindowProjectionType('native')).toBe(false);
    expect(isWindowProjectionType('window:3')).toBe(true);
  });
});

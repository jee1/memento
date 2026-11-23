import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { encodeFloat32Embedding } from '../../../../shared/utils/embedding-serialization.js';
import { getEmbeddingModelFilter } from '../../../../shared/config/embedding-models.js';
import { applyVectorWindowBlend } from '../vector-window-blend.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(
    'CREATE TABLE memory_embedding (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, ' +
      "embedding_provider TEXT NOT NULL, projection_type TEXT NOT NULL DEFAULT 'native', " +
      'embedding BLOB, dim INTEGER NOT NULL DEFAULT 2, dimensions INTEGER DEFAULT 2, model TEXT, ' +
      'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
  );
  return db;
}

function insertRow(db: Database.Database, memoryId: string, projection: string, vector: number[]): void {
  db.prepare(
    'INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions, model) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(memoryId, 'minilm', projection, encodeFloat32Embedding(vector), vector.length, vector.length, getEmbeddingModelFilter('minilm'));
}

function insertLongMemory(db: Database.Database, memoryId: string, windows: number): void {
  insertRow(db, memoryId, 'native', [0.6, 0.8]);
  for (let i = 0; i < windows; i++) insertRow(db, memoryId, `window:${i}`, [1, 0]);
}

const QUERY = new Map([['minilm', [1, 0]]]);
const OPTIONS = { enabled: true, lambda: 0.5, min_windows: 3 };

describe('applyVectorWindowBlend (#1827)', () => {
  it('긴 기억의 창 점수를 native 코사인 쪽으로 lambda 만큼 당긴다', () => {
    const db = createDb();
    insertLongMemory(db, 'long', 3);

    const [result] = applyVectorWindowBlend(db, [{ id: 'long', similarity: 1, provider: 'minilm' }], QUERY, OPTIONS);

    expect(result.similarity).toBeCloseTo(0.8, 6);
  });

  it('창 수가 min_windows 미만이거나 native 행이 없으면 점수를 바꾸지 않는다', () => {
    const db = createDb();
    insertLongMemory(db, 'short', 2);
    for (let i = 0; i < 3; i++) insertRow(db, 'no-native', `window:${i}`, [1, 0]);

    const results = applyVectorWindowBlend(
      db,
      [{ id: 'short', similarity: 1, provider: 'minilm' }, { id: 'no-native', similarity: 1, provider: 'minilm' }],
      QUERY,
      OPTIONS
    );

    expect(results.map((r) => r.similarity)).toEqual([1, 1]);
  });

  it('옛 모델 창은 창 수에 세지 않는다', () => {
    const db = createDb();
    insertLongMemory(db, 'mixed', 2);
    for (let i = 2; i < 5; i++) {
      db.prepare(
        'INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions, model) ' +
          "VALUES ('mixed', 'minilm', ?, ?, 2, 2, 'old-model')"
      ).run(`window:${i}`, encodeFloat32Embedding([1, 0]));
    }

    const [result] = applyVectorWindowBlend(db, [{ id: 'mixed', similarity: 1, provider: 'minilm' }], QUERY, OPTIONS);

    expect(result.similarity).toBe(1);
  });

  it('native 코사인이 창 점수 이상이면 점수를 올리지 않는다', () => {
    const db = createDb();
    insertLongMemory(db, 'long', 3);

    const [result] = applyVectorWindowBlend(db, [{ id: 'long', similarity: 0.5, provider: 'minilm' }], QUERY, OPTIONS);

    expect(result.similarity).toBe(0.5);
  });

  it('lambda 가 0 이하이거나 결과가 비어 있으면 같은 배열을 돌려준다', () => {
    const db = createDb();
    insertLongMemory(db, 'long', 3);
    const input = [{ id: 'long', similarity: 1, provider: 'minilm' }];
    const empty: typeof input = [];

    expect(applyVectorWindowBlend(db, input, QUERY, { ...OPTIONS, lambda: 0 })).toBe(input);
    expect(applyVectorWindowBlend(db, input, QUERY, { ...OPTIONS, lambda: -0.1 })).toBe(input);
    expect(applyVectorWindowBlend(db, empty, QUERY, OPTIONS)).toBe(empty);
  });

  it('질의 벡터가 없는 provider 는 건너뛰고 있는 provider 만 섞는다', () => {
    const db = createDb();
    insertLongMemory(db, 'long', 3);
    // other 도 창 수가 min_windows 이상이고 native 가 있어, 질의 벡터가 없다는 조건만으로 건너뛴다.
    const insertOther = db.prepare(
      'INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions, model) ' +
        "VALUES ('other', 'openai', ?, ?, 2, 2, NULL)"
    );
    insertOther.run('native', encodeFloat32Embedding([0.6, 0.8]));
    for (let i = 0; i < 3; i++) insertOther.run(`window:${i}`, encodeFloat32Embedding([1, 0]));

    const results = applyVectorWindowBlend(
      db,
      [{ id: 'other', similarity: 1, provider: 'openai' }, { id: 'long', similarity: 1, provider: 'minilm' }],
      QUERY,
      OPTIONS
    );

    expect(results.map((r) => r.similarity)).toEqual([1, expect.closeTo(0.8, 6)]);
  });

  it('질의 벡터와 native 벡터의 차원이 다르면 그 기억은 섞지 않는다 (#1827)', () => {
    const db = createDb();
    insertLongMemory(db, 'long', 3);
    const input = [{ id: 'long', similarity: 1, provider: 'minilm' }];

    const results = applyVectorWindowBlend(db, input, new Map([['minilm', [1, 0, 0]]]), OPTIONS);

    expect(results).toBe(input);
  });

  it('꺼져 있으면 같은 배열을 그대로 돌려준다', () => {
    const db = createDb();
    insertLongMemory(db, 'long', 3);
    const input = [{ id: 'long', similarity: 1, provider: 'minilm' }];

    expect(applyVectorWindowBlend(db, input, QUERY, { ...OPTIONS, enabled: false })).toBe(input);
  });
});

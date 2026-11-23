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

  it('꺼져 있으면 같은 배열을 그대로 돌려준다', () => {
    const db = createDb();
    insertLongMemory(db, 'long', 3);
    const input = [{ id: 'long', similarity: 1, provider: 'minilm' }];

    expect(applyVectorWindowBlend(db, input, QUERY, { ...OPTIONS, enabled: false })).toBe(input);
  });
});

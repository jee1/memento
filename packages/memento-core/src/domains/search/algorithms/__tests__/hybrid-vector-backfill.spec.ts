import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { encodeFloat32Embedding } from '../../../../shared/utils/embedding-serialization.js';
import { backfillTextOnlyVectorResults } from '../hybrid-vector-backfill.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(
    'CREATE TABLE memory_embedding (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, ' +
      "embedding_provider TEXT NOT NULL, projection_type TEXT NOT NULL DEFAULT 'native', " +
      'embedding BLOB, dim INTEGER NOT NULL DEFAULT 4, dimensions INTEGER DEFAULT 4)'
  );
  return db;
}

function insertEmbedding(db: Database.Database, memoryId: string, provider: string, vector: number[]): void {
  db.prepare(
    "INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions) " +
      "VALUES (?, ?, 'native', ?, ?, ?)"
  ).run(memoryId, provider, encodeFloat32Embedding(vector), vector.length, vector.length);
}

// 길이 감쇠(#921)는 content 길이에만 의존하므로 모든 픽스처의 content 길이를 같게 둔다.
const CONTENT = 'x'.repeat(200);

function textRow(id: string) {
  return { id, content: CONTENT, type: 'episodic', importance: 0.5, created_at: '2026-09-19T00:00:00Z', pinned: 0 };
}

describe('backfillTextOnlyVectorResults', () => {
  it('벡터 레인이 뽑지 않은 텍스트 결과에 실제 코사인을 채운다', () => {
    const db = createDb();
    insertEmbedding(db, 'a', 'minilm', [1, 0, 0, 0]);
    insertEmbedding(db, 'b', 'minilm', [0, 1, 0, 0]);

    const results = backfillTextOnlyVectorResults(
      db,
      [textRow('a'), textRow('b')],
      [],
      [{ provider: 'minilm', embedding: [1, 0, 0, 0] }]
    );

    expect(results).toHaveLength(2);
    const a = results.find((r) => r.id === 'a');
    const b = results.find((r) => r.id === 'b');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.similarity).toBeGreaterThan(b!.similarity);
    expect(a!.similarity).toBeGreaterThan(0.5);
    expect(b!.similarity).toBeLessThan(0.1);
  });

  it('벡터 레인이 이미 뽑은 id 는 건드리지 않는다', () => {
    const db = createDb();
    insertEmbedding(db, 'a', 'minilm', [1, 0, 0, 0]);

    const vectorResults = [{
      id: 'a',
      content: CONTENT,
      type: 'episodic',
      importance: 0.5,
      created_at: '2026-09-19T00:00:00Z',
      pinned: false,
      similarity: 0.9,
    }];

    const results = backfillTextOnlyVectorResults(
      db,
      [textRow('a')],
      vectorResults,
      [{ provider: 'minilm', embedding: [1, 0, 0, 0] }]
    );

    expect(results.find((r) => r.id === 'a')).toBeUndefined();
  });

  it('임베딩이 없는 기억은 반환하지 않는다', () => {
    const db = createDb();
    insertEmbedding(db, 'a', 'minilm', [1, 0, 0, 0]);

    const results = backfillTextOnlyVectorResults(
      db,
      [textRow('a'), textRow('c')],
      [],
      [{ provider: 'minilm', embedding: [1, 0, 0, 0] }]
    );

    expect(results.find((r) => r.id === 'a')).toBeDefined();
    expect(results.find((r) => r.id === 'c')).toBeUndefined();
  });

  it('질의 임베딩이 없으면 아무것도 하지 않는다', () => {
    const db = createDb();
    insertEmbedding(db, 'a', 'minilm', [1, 0, 0, 0]);

    const results = backfillTextOnlyVectorResults(
      db,
      [textRow('a')],
      [],
      []
    );

    expect(results).toEqual([]);
  });

  it('차원 불일치 임베딩은 제외한다', () => {
    const db = createDb();
    insertEmbedding(db, 'd', 'minilm', [1, 0]);

    const results = backfillTextOnlyVectorResults(
      db,
      [textRow('d')],
      [],
      [{ provider: 'minilm', embedding: [1, 0, 0, 0] }]
    );

    expect(results.find((r) => r.id === 'd')).toBeUndefined();
  });
});

/**
 * Migration 043 top-10 before/after ranking parity (#809 / US2 / SC-003 / FR-007).
 *
 * Pure JS cosine over stored vectors — storage-format parity only (no recall stack).
 * Synthetic fixtures only; no live DB paths.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clamp01 } from '../../../../../shared/utils/clamp.js';
import { decodeFloat32Embedding } from '../../../../../shared/utils/embedding-serialization.js';
import { cosineSimilarity } from '../../../../../shared/utils/vector-math.js';
import { EmbeddingFloat32BlobMigration } from './043-embedding-float32-blob.js';

const TOP_K = 10;

function createLegacySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT);
    CREATE TABLE memory_embedding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      embedding_provider TEXT NOT NULL DEFAULT 'tfidf',
      projection_type TEXT NOT NULL DEFAULT 'native',
      embedding TEXT NOT NULL,
      dim INTEGER NOT NULL,
      dimensions INTEGER DEFAULT 0,
      model TEXT,
      precision INTEGER DEFAULT 16,
      normalized BOOLEAN DEFAULT FALSE,
      version INTEGER DEFAULT 1,
      created_by TEXT DEFAULT 'system',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/** Unit query along dim-0 so ranking is controlled by first-component strength. */
function unitQuery(dim: number): number[] {
  const q = new Array(dim).fill(0);
  q[0] = 1;
  return q;
}

/**
 * Synthetic vector: higher `strength` → higher cosine vs unitQuery.
 * Tiny orthogonal noise avoids zero-ties without flipping order under float32.
 */
function syntheticVector(dim: number, strength: number, salt: number): number[] {
  const v = new Array(dim).fill(0);
  v[0] = strength;
  for (let i = 1; i < dim; i++) {
    v[i] = ((salt * 17 + i * 13) % 1000) * 1e-6;
  }
  return v;
}

function insertJsonEmbedding(
  db: Database.Database,
  row: {
    memoryId: string;
    provider: string;
    dimensions: number;
    vector: number[];
  },
): void {
  db.prepare('INSERT OR IGNORE INTO memory_item (id, content) VALUES (?, ?)').run(
    row.memoryId,
    'synthetic',
  );
  db.prepare(
    `INSERT INTO memory_embedding (
      memory_id, embedding_provider, projection_type, embedding, dim, dimensions, precision
    ) VALUES (?, ?, 'native', ?, ?, ?, 16)`,
  ).run(
    row.memoryId,
    row.provider,
    JSON.stringify(row.vector),
    row.dimensions,
    row.dimensions,
  );
}

type RankedRow = { memoryId: string; score: number };

function rankTopK(
  query: number[],
  rows: Array<{ memoryId: string; vector: number[] | Float32Array }>,
  k: number,
): string[] {
  const scored: RankedRow[] = rows.map(row => ({
    memoryId: row.memoryId,
    score: clamp01(cosineSimilarity(query, Array.from(row.vector))),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.memoryId.localeCompare(b.memoryId);
  });
  return scored.slice(0, k).map(r => r.memoryId);
}

function loadVectorsJson(
  db: Database.Database,
  provider: string,
): Array<{ memoryId: string; vector: number[] }> {
  const rows = db
    .prepare(
      `SELECT memory_id, embedding FROM memory_embedding
       WHERE embedding_provider = ? AND typeof(embedding) = 'text'`,
    )
    .all(provider) as Array<{ memory_id: string; embedding: string }>;
  return rows.map(r => ({
    memoryId: r.memory_id,
    vector: JSON.parse(r.embedding) as number[],
  }));
}

function loadVectorsBlob(
  db: Database.Database,
  provider: string,
): Array<{ memoryId: string; vector: Float32Array }> {
  const rows = db
    .prepare(
      `SELECT memory_id, embedding FROM memory_embedding
       WHERE embedding_provider = ? AND embedding IS NOT NULL`,
    )
    .all(provider) as Array<{ memory_id: string; embedding: Buffer }>;
  return rows.map(r => ({
    memoryId: r.memory_id,
    vector: decodeFloat32Embedding(r.embedding),
  }));
}

/** Insert N memories with descending strengths so top-10 order is deterministic. */
function seedProviderCorpus(
  db: Database.Database,
  provider: string,
  dim: number,
  count: number,
): { query: number[]; memoryIds: string[] } {
  const query = unitQuery(dim);
  const memoryIds: string[] = [];
  // strengths 0.95, 0.90, … clearly separated
  for (let i = 0; i < count; i++) {
    const strength = 0.95 - i * 0.05;
    const memoryId = `${provider}_mem_${String(i).padStart(2, '0')}`;
    memoryIds.push(memoryId);
    insertJsonEmbedding(db, {
      memoryId,
      provider,
      dimensions: dim,
      vector: syntheticVector(dim, strength, i + 1),
    });
  }
  return { query, memoryIds };
}

describe('043 embedding top-10 migration parity (SC-003 / FR-007)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createLegacySchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('T014: mock 64-dim top-10 memory IDs+order match before/after migration', async () => {
    const { query } = seedProviderCorpus(db, 'mock', 64, 15);

    const before = rankTopK(query, loadVectorsJson(db, 'mock'), TOP_K);
    expect(before).toHaveLength(TOP_K);

    await new EmbeddingFloat32BlobMigration().up(db);

    const after = rankTopK(query, loadVectorsBlob(db, 'mock'), TOP_K);
    expect(after).toEqual(before);
  });

  it('T015: multi-provider (mock 64 + minilm 384) each provider-scoped top-10 stable', async () => {
    const mock = seedProviderCorpus(db, 'mock', 64, 12);
    const minilm = seedProviderCorpus(db, 'minilm', 384, 12);

    const beforeMock = rankTopK(mock.query, loadVectorsJson(db, 'mock'), TOP_K);
    const beforeMinilm = rankTopK(minilm.query, loadVectorsJson(db, 'minilm'), TOP_K);

    await new EmbeddingFloat32BlobMigration().up(db);

    const afterMock = rankTopK(mock.query, loadVectorsBlob(db, 'mock'), TOP_K);
    const afterMinilm = rankTopK(minilm.query, loadVectorsBlob(db, 'minilm'), TOP_K);

    expect(afterMock).toEqual(beforeMock);
    expect(afterMinilm).toEqual(beforeMinilm);
    // providers must not leak into each other's ranking set
    expect(beforeMock.every(id => id.startsWith('mock_'))).toBe(true);
    expect(beforeMinilm.every(id => id.startsWith('minilm_'))).toBe(true);
  });
});

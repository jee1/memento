/**
 * 기존 DB 업그레이드 경로 회귀 (issue #713)
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cosineDistanceToSimilarity } from '../../../../../domains/search/repositories/vector-search/vector-search-result-mapper.js';
import { VEC_TABLES, checkVecCardinality, hasCosineDistanceMetric } from '../../vec-schema.js';
import { VecCosineMetricMigration } from './041-vec-cosine-metric.js';

async function loadVecExtension(db: Database.Database): Promise<boolean> {
  try {
    const { getLoadablePath } = await import('sqlite-vec');
    db.loadExtension(getLoadablePath());
    return true;
  } catch {
    return false;
  }
}

function tableSql(db: Database.Database, name: string): string | undefined {
  return (
    db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql?: string } | undefined
  )?.sql;
}

function insertEmbedding(
  db: Database.Database,
  row: { id: number; memoryId: string; provider: string; dimensions: number; vector: number[] }
): void {
  db.prepare('INSERT INTO memory_item (id, content) VALUES (?, ?)').run(row.memoryId, 'content');
  db.prepare(
    `INSERT INTO memory_embedding (id, memory_id, embedding_provider, projection_type, embedding, dim, dimensions)
     VALUES (?, ?, ?, 'native', ?, ?, ?)`
  ).run(row.id, row.memoryId, row.provider, JSON.stringify(row.vector), row.dimensions, row.dimensions);
}

function mockVector(seed: number): number[] {
  return Array.from({ length: 64 }, (_, index) => seed * (index + 1));
}

describe('VecCosineMetricMigration (041)', () => {
  let db: Database.Database;
  let vecAvailable = false;

  beforeEach(async () => {
    db = new Database(':memory:');
    vecAvailable = await loadVecExtension(db);

    db.exec(`
      CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT);
      CREATE TABLE memory_embedding (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        embedding_provider TEXT NOT NULL DEFAULT 'tfidf',
        projection_type TEXT NOT NULL DEFAULT 'native',
        embedding TEXT NOT NULL,
        dim INTEGER NOT NULL,
        dimensions INTEGER DEFAULT 0
      );
    `);

    if (!vecAvailable) {
      return;
    }

    // 마이그레이션 이전 상태: metric 미명시(= L2 기본값) vec 테이블
    for (const table of VEC_TABLES) {
      db.exec(
        `CREATE VIRTUAL TABLE ${table.name} USING vec0(embedding float[${table.dimension}])`
      );
    }
  });

  afterEach(() => db.close());

  it('기존 L2 vec 테이블을 cosine으로 재생성하고 재적재한다', async () => {
    if (!vecAvailable) return;

    insertEmbedding(db, { id: 1, memoryId: 'mem_1', provider: 'mock', dimensions: 64, vector: mockVector(1) });
    insertEmbedding(db, { id: 2, memoryId: 'mem_2', provider: 'mock', dimensions: 64, vector: mockVector(3) });
    db.exec(
      "INSERT INTO memory_item_vec_mock(rowid, embedding) SELECT id, json_extract(embedding, '$') FROM memory_embedding"
    );
    expect(hasCosineDistanceMetric(tableSql(db, 'memory_item_vec_mock'))).toBe(false);

    await new VecCosineMetricMigration().up(db);

    for (const table of VEC_TABLES) {
      expect(hasCosineDistanceMetric(tableSql(db, table.name))).toBe(true);
    }
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM memory_item_vec_mock').get() as { count: number }).count
    ).toBe(2);
  });

  it('트리거를 재생성해 이후 임베딩이 자동 적재된다 (mock 포함)', async () => {
    if (!vecAvailable) return;

    await new VecCosineMetricMigration().up(db);

    insertEmbedding(db, { id: 10, memoryId: 'mem_10', provider: 'mock', dimensions: 64, vector: mockVector(2) });

    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM memory_item_vec_mock').get() as { count: number }).count
    ).toBe(1);

    db.prepare('DELETE FROM memory_embedding WHERE id = 10').run();
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM memory_item_vec_mock').get() as { count: number }).count
    ).toBe(0);
  });

  it('native 필터 기준 cardinality가 일치한다 (legacy 384는 provider 1:1 비교 아님)', async () => {
    if (!vecAvailable) return;

    await new VecCosineMetricMigration().up(db);

    insertEmbedding(db, { id: 20, memoryId: 'mem_20', provider: 'mock', dimensions: 64, vector: mockVector(1) });
    insertEmbedding(db, {
      id: 21,
      memoryId: 'mem_21',
      provider: 'minilm',
      dimensions: 384,
      vector: Array.from({ length: 384 }, () => 0.1)
    });

    const report = checkVecCardinality(db);
    expect(report.every(row => row.matched)).toBe(true);

    // minilm 384 임베딩은 provider 테이블과 legacy 384 공용 테이블 양쪽에 적재된다
    expect(report.find(row => row.table === 'memory_item_vec')?.actual).toBe(1);
    expect(report.find(row => row.table === 'memory_item_vec_minilm')?.actual).toBe(1);
  });

  it('양의 비례 벡터는 similarity ≈ 1.0, 반대 방향은 clamp로 0', async () => {
    if (!vecAvailable) return;

    await new VecCosineMetricMigration().up(db);

    insertEmbedding(db, { id: 30, memoryId: 'mem_30', provider: 'mock', dimensions: 64, vector: mockVector(1) });
    insertEmbedding(db, { id: 31, memoryId: 'mem_31', provider: 'mock', dimensions: 64, vector: mockVector(7) });
    insertEmbedding(db, { id: 32, memoryId: 'mem_32', provider: 'mock', dimensions: 64, vector: mockVector(-1) });

    const rows = db
      .prepare(
        'SELECT rowid, distance FROM memory_item_vec_mock WHERE embedding MATCH ? ORDER BY distance LIMIT 10'
      )
      .all(JSON.stringify(mockVector(1))) as Array<{ rowid: number; distance: number }>;

    const similarityByRowid = new Map(
      rows.map(row => [row.rowid, cosineDistanceToSimilarity(row.distance)])
    );

    expect(similarityByRowid.get(30)).toBeCloseTo(1.0, 5);
    expect(similarityByRowid.get(31)).toBeCloseTo(1.0, 5);
    expect(similarityByRowid.get(32)).toBe(0);
  });

  it('validateAfter는 cosine metric과 트리거를 확인한다', async () => {
    if (!vecAvailable) return;

    const migration = new VecCosineMetricMigration();
    await migration.up(db);
    await expect(migration.validateAfter(db)).resolves.toBeUndefined();
  });

  it('down은 metric 미명시 상태로 되돌린다', async () => {
    if (!vecAvailable) return;

    const migration = new VecCosineMetricMigration();
    await migration.up(db);
    await migration.down(db);

    for (const table of VEC_TABLES) {
      expect(hasCosineDistanceMetric(tableSql(db, table.name))).toBe(false);
    }
  });

  it('sqlite-vec 확장이 없어도 마이그레이션이 실패하지 않는다', async () => {
    const plainDb = new Database(':memory:');
    plainDb.exec(`
      CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT);
      CREATE TABLE memory_embedding (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        embedding_provider TEXT NOT NULL DEFAULT 'tfidf',
        projection_type TEXT NOT NULL DEFAULT 'native',
        embedding TEXT NOT NULL,
        dim INTEGER NOT NULL,
        dimensions INTEGER DEFAULT 0
      );
    `);

    try {
      const migration = new VecCosineMetricMigration();
      await expect(migration.up(plainDb)).resolves.toBeUndefined();
      await expect(migration.validateAfter(plainDb)).resolves.toBeUndefined();
    } finally {
      plainDb.close();
    }
  });
});

/**
 * fresh DB 경로에서 vec0 cosine metric 계약이 적용되는지 검증 (issue #713)
 */

import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cosineDistanceToSimilarity } from '../../../domains/search/repositories/vector-search/vector-search-result-mapper.js';
import { initializeDatabase } from './init.js';
import { VEC_TABLES, VEC_TRIGGER_NAMES, checkVecCardinality, hasCosineDistanceMetric } from './vec-schema.js';

let vecAvailable = false;

beforeAll(async () => {
  try {
    await import('sqlite-vec');
    vecAvailable = true;
  } catch {
    vecAvailable = false;
  }
});

describe('fresh DB vec0 cosine metric', () => {
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

  it('initializeDatabase가 만든 vec 테이블은 모두 distance_metric=cosine이다', async () => {
    if (!vecAvailable) return;

    tempDir = mkdtempSync(join(tmpdir(), 'memento-vec-cosine-'));
    db = await initializeDatabase(join(tempDir, 'memory.db'));

    for (const table of VEC_TABLES) {
      const row = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table.name) as
        | { sql?: string }
        | undefined;
      expect(row?.sql, `${table.name} 이(가) 생성되지 않았습니다`).toBeTruthy();
      expect(hasCosineDistanceMetric(row?.sql), `${table.name} metric`).toBe(true);
    }

    for (const triggerName of VEC_TRIGGER_NAMES) {
      expect(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(triggerName)
      ).toBeTruthy();
    }
  });

  it('트리거로 적재된 벡터의 비례 관계는 similarity ≈ 1.0으로 나온다', async () => {
    if (!vecAvailable) return;

    tempDir = mkdtempSync(join(tmpdir(), 'memento-vec-cosine-'));
    db = await initializeDatabase(join(tempDir, 'memory.db'));

    const vector = (seed: number): string =>
      JSON.stringify(Array.from({ length: 64 }, (_, index) => seed * (index + 1)));

    const insertItem = db.prepare(
      "INSERT INTO memory_item (id, type, content) VALUES (?, 'episodic', 'content')"
    );
    const insertEmbedding = db.prepare(
      `INSERT INTO memory_embedding (id, memory_id, embedding_provider, projection_type, embedding, dim, dimensions)
       VALUES (?, ?, 'mock', 'native', ?, 64, 64)`
    );

    insertItem.run('mem_base');
    insertEmbedding.run(1, 'mem_base', vector(1));
    insertItem.run('mem_proportional');
    insertEmbedding.run(2, 'mem_proportional', vector(5));
    insertItem.run('mem_opposite');
    insertEmbedding.run(3, 'mem_opposite', vector(-2));

    const rows = db
      .prepare(
        'SELECT rowid, distance FROM memory_item_vec_mock WHERE embedding MATCH ? ORDER BY distance LIMIT 10'
      )
      .all(vector(1)) as Array<{ rowid: number; distance: number }>;
    const similarity = new Map(rows.map(row => [row.rowid, cosineDistanceToSimilarity(row.distance)]));

    expect(similarity.get(2)).toBeCloseTo(1.0, 5);
    // slot A threshold(0.8)를 vector-only로 통과한다
    expect(similarity.get(2)!).toBeGreaterThanOrEqual(0.8);
    expect(similarity.get(3)).toBe(0);

    expect(checkVecCardinality(db).every(row => row.matched)).toBe(true);
  });
});

describe('기존 DB 업그레이드 경로', () => {
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

  it('L2로 만들어진 기존 DB를 다시 열면 마이그레이션 041이 cosine으로 되돌린다', async () => {
    if (!vecAvailable) return;

    tempDir = mkdtempSync(join(tmpdir(), 'memento-vec-cosine-legacy-'));
    const dbPath = join(tempDir, 'memory.db');

    // 041 이전 상태 재현: metric 미명시(L2) vec 테이블 + 041 미적용 스키마 버전
    const fresh = await initializeDatabase(dbPath);
    fresh.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('41.0');
    fresh.prepare(
      "INSERT INTO memory_item (id, type, content) VALUES ('mem_legacy', 'episodic', 'content')"
    ).run();
    fresh
      .prepare(
        `INSERT INTO memory_embedding (id, memory_id, embedding_provider, projection_type, embedding, dim, dimensions)
         VALUES (1, 'mem_legacy', 'mock', 'native', ?, 64, 64)`
      )
      .run(JSON.stringify(Array.from({ length: 64 }, (_, index) => index + 1)));
    for (const triggerName of VEC_TRIGGER_NAMES) {
      fresh.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }
    for (const table of VEC_TABLES) {
      fresh.exec(`DROP TABLE IF EXISTS ${table.name}`);
      fresh.exec(
        `CREATE VIRTUAL TABLE ${table.name} USING vec0(embedding float[${table.dimension}])`
      );
    }
    fresh.close();

    db = await initializeDatabase(dbPath);

    for (const table of VEC_TABLES) {
      const row = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table.name) as
        | { sql?: string }
        | undefined;
      expect(hasCosineDistanceMetric(row?.sql), `${table.name} metric`).toBe(true);
    }
    for (const triggerName of VEC_TRIGGER_NAMES) {
      expect(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(triggerName)
      ).toBeTruthy();
    }
    // 기존 임베딩이 재적재되어 native 필터 기준 cardinality가 일치한다
    expect(checkVecCardinality(db).every(row => row.matched)).toBe(true);
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM memory_item_vec_mock').get() as { count: number })
        .count
    ).toBe(1);
  });
});

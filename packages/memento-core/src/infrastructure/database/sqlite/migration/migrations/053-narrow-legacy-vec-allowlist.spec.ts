import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getVectorTableName } from '../../../../../shared/utils/sql-security-validator.js';
import {
  VEC_TABLES,
  buildVecTableDdl,
  checkVecCardinality,
  recreateVecTriggers,
  type VecTableConfig,
} from '../../vec-schema.js';
import { NarrowLegacyVecAllowlistMigration } from './053-narrow-legacy-vec-allowlist.js';

const ROW = {
  minilmNative: 1,
  minilmWindow: 2,
  tfidf384: 3,
  tfidf512: 4,
  lightweight384: 5,
} as const;

async function loadVecExtension(db: Database.Database): Promise<boolean> {
  try {
    const { getLoadablePath } = await import('sqlite-vec');
    db.loadExtension(getLoadablePath());
    return true;
  } catch {
    return false;
  }
}

function vectorJson(dimensions: number, seed: number): string {
  const values = new Array<number>(dimensions).fill(0);
  values[seed % dimensions] = 1;
  return JSON.stringify(values);
}

function createEmbeddingTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_embedding (
      id INTEGER PRIMARY KEY,
      memory_id TEXT NOT NULL,
      embedding_provider TEXT NOT NULL,
      projection_type TEXT NOT NULL DEFAULT 'native',
      embedding TEXT NOT NULL,
      dimensions INTEGER NOT NULL
    );
  `);
}

function staleTriggerTables(): VecTableConfig[] {
  return VEC_TABLES.map(table => {
    if (table.name === 'memory_item_vec') {
      const predicates = ['dimensions = 384'];
      return { ...table, predicates, filter: predicates.join(' AND ') };
    }
    if (table.name === 'memory_item_vec_minilm') {
      const predicates = [
        "embedding_provider = 'minilm'",
        'dimensions = 384',
        "projection_type = 'native'",
      ];
      return { ...table, predicates, filter: predicates.join(' AND ') };
    }
    return table;
  });
}

function insertEmbedding(
  db: Database.Database,
  row: { id: number; provider: string; projection: string; dimensions: number; seed: number }
): void {
  db.prepare(
    `INSERT INTO memory_embedding
       (id, memory_id, embedding_provider, projection_type, embedding, dimensions)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    `mem_${row.id}`,
    row.provider,
    row.projection,
    vectorJson(row.dimensions, row.seed),
    row.dimensions
  );
}

function seedMembershipRows(db: Database.Database): void {
  insertEmbedding(db, {
    id: ROW.minilmNative,
    provider: 'minilm',
    projection: 'native',
    dimensions: 384,
    seed: 0,
  });
  insertEmbedding(db, {
    id: ROW.minilmWindow,
    provider: 'minilm',
    projection: 'window:0',
    dimensions: 384,
    seed: 1,
  });
  insertEmbedding(db, {
    id: ROW.tfidf384,
    provider: 'tfidf',
    projection: 'native',
    dimensions: 384,
    seed: 2,
  });
  insertEmbedding(db, {
    id: ROW.tfidf512,
    provider: 'tfidf',
    projection: 'native',
    dimensions: 512,
    seed: 3,
  });
  insertEmbedding(db, {
    id: ROW.lightweight384,
    provider: 'lightweight',
    projection: 'native',
    dimensions: 384,
    seed: 4,
  });
}

function hasRow(db: Database.Database, table: string, id: number): boolean {
  const row = db.prepare(`SELECT 1 AS ok FROM ${table} WHERE rowid = ?`).get(id) as
    | { ok: number }
    | undefined;
  return row !== undefined;
}

function tableSql(db: Database.Database, name: string): string | undefined {
  return (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as
      | { sql?: string }
      | undefined
  )?.sql;
}

function knnRowids(db: Database.Database, query: string): number[] {
  const rows = db
    .prepare(
      `SELECT rowid FROM memory_item_vec_minilm
       WHERE embedding MATCH ?
       ORDER BY distance
       LIMIT 10`
    )
    .all(query) as Array<{ rowid: number }>;
  return rows.map(row => row.rowid);
}

describe('getVectorTableName routing', () => {
  it('minilm 과 tfidf 384 매핑은 그대로다', () => {
    expect(getVectorTableName('minilm')).toBe('memory_item_vec_minilm');
    expect(getVectorTableName('minilm', 384)).toBe('memory_item_vec_minilm');
    expect(getVectorTableName('tfidf', 384)).toBe('memory_item_vec');
    expect(getVectorTableName('lightweight', 384)).toBe('memory_item_vec');
    expect(getVectorTableName('lightweight')).toBe('memory_item_vec');
    expect(getVectorTableName('tfidf', 512)).toBe('memory_item_vec_tfidf');
  });
});

describe('NarrowLegacyVecAllowlistMigration (053)', () => {
  let db: Database.Database;
  let vecAvailable = false;

  beforeEach(async () => {
    db = new Database(':memory:');
    vecAvailable = await loadVecExtension(db);
    createEmbeddingTable(db);
    if (!vecAvailable) {
      return;
    }
    for (const table of VEC_TABLES) {
      db.exec(buildVecTableDdl(table));
    }
    recreateVecTriggers(db, staleTriggerTables());
  });

  afterEach(() => {
    db.close();
  });

  it('memory_embedding 이 없으면 validateBefore 가 실패한다', async () => {
    const plain = new Database(':memory:');
    try {
      await expect(new NarrowLegacyVecAllowlistMigration().validateBefore(plain)).rejects.toThrow(
        /memory_embedding/
      );
    } finally {
      plain.close();
    }
  });

  it('sqlite-vec 가 없으면 up 은 no-op 이다', async () => {
    const plain = new Database(':memory:');
    createEmbeddingTable(plain);
    try {
      const migration = new NarrowLegacyVecAllowlistMigration();
      await expect(migration.up(plain)).resolves.toBeUndefined();
      await expect(migration.validateAfter(plain)).resolves.toBeUndefined();
      await expect(migration.down(plain)).resolves.toBeUndefined();
    } finally {
      plain.close();
    }
  });

  it('A–E 멤버십을 허용 목록으로 맞추고 테이블은 남긴다', async () => {
    if (!vecAvailable) return;

    seedMembershipRows(db);
    expect(hasRow(db, 'memory_item_vec', ROW.minilmNative)).toBe(true);
    expect(hasRow(db, 'memory_item_vec', ROW.minilmWindow)).toBe(true);
    expect(hasRow(db, 'memory_item_vec_minilm', ROW.minilmWindow)).toBe(false);

    const migration = new NarrowLegacyVecAllowlistMigration();
    await migration.up(db);
    await migration.validateAfter(db);

    expect(tableSql(db, 'memory_item_vec')).toContain('float[384]');
    expect(hasRow(db, 'memory_item_vec', ROW.minilmNative)).toBe(false);
    expect(hasRow(db, 'memory_item_vec_minilm', ROW.minilmNative)).toBe(true);
    expect(hasRow(db, 'memory_item_vec', ROW.minilmWindow)).toBe(false);
    expect(hasRow(db, 'memory_item_vec_minilm', ROW.minilmWindow)).toBe(true);
    expect(hasRow(db, 'memory_item_vec', ROW.tfidf384)).toBe(true);
    expect(hasRow(db, 'memory_item_vec_minilm', ROW.tfidf384)).toBe(false);
    expect(hasRow(db, 'memory_item_vec', ROW.lightweight384)).toBe(true);
    expect(hasRow(db, 'memory_item_vec_minilm', ROW.lightweight384)).toBe(false);
    expect(hasRow(db, 'memory_item_vec_tfidf', ROW.tfidf512)).toBe(true);
    expect(hasRow(db, 'memory_item_vec', ROW.tfidf512)).toBe(false);

    const report = checkVecCardinality(db);
    expect(report.find(row => row.table === 'memory_item_vec')?.matched).toBe(true);
    expect(report.find(row => row.table === 'memory_item_vec_minilm')?.matched).toBe(true);
  });

  it('up 이후 새 minilm native 는 minilm 에만, tfidf 384 native 는 레거시에만 들어간다', async () => {
    if (!vecAvailable) return;

    await new NarrowLegacyVecAllowlistMigration().up(db);

    insertEmbedding(db, {
      id: 10,
      provider: 'minilm',
      projection: 'native',
      dimensions: 384,
      seed: 5,
    });
    insertEmbedding(db, {
      id: 11,
      provider: 'tfidf',
      projection: 'native',
      dimensions: 384,
      seed: 6,
    });

    expect(hasRow(db, 'memory_item_vec_minilm', 10)).toBe(true);
    expect(hasRow(db, 'memory_item_vec', 10)).toBe(false);
    expect(hasRow(db, 'memory_item_vec', 11)).toBe(true);
    expect(hasRow(db, 'memory_item_vec_minilm', 11)).toBe(false);
    expect(hasRow(db, 'memory_item_vec_tfidf', 11)).toBe(false);
  });

  it('down 은 native minilm 이중 저장을 되돌리고 윈도 행은 minilm 에 남긴다', async () => {
    if (!vecAvailable) return;

    seedMembershipRows(db);
    const migration = new NarrowLegacyVecAllowlistMigration();
    await migration.up(db);
    await migration.down(db);

    expect(tableSql(db, 'memory_item_vec')).toBeTruthy();
    expect(hasRow(db, 'memory_item_vec', ROW.minilmNative)).toBe(true);
    expect(hasRow(db, 'memory_item_vec_minilm', ROW.minilmNative)).toBe(true);
    expect(hasRow(db, 'memory_item_vec_minilm', ROW.minilmWindow)).toBe(true);
    expect(hasRow(db, 'memory_item_vec', ROW.minilmWindow)).toBe(false);

    insertEmbedding(db, {
      id: 20,
      provider: 'minilm',
      projection: 'native',
      dimensions: 384,
      seed: 7,
    });
    expect(hasRow(db, 'memory_item_vec', 20)).toBe(true);
    expect(hasRow(db, 'memory_item_vec_minilm', 20)).toBe(true);
  });

  it('up 을 두 번 돌려도 멤버십이 같다', async () => {
    if (!vecAvailable) return;

    seedMembershipRows(db);
    const migration = new NarrowLegacyVecAllowlistMigration();
    await migration.up(db);
    const afterFirst = {
      legacy: (
        db.prepare('SELECT COUNT(*) AS count FROM memory_item_vec').get() as { count: number }
      ).count,
      minilm: (
        db.prepare('SELECT COUNT(*) AS count FROM memory_item_vec_minilm').get() as { count: number }
      ).count,
    };

    await migration.up(db);
    await migration.validateAfter(db);

    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM memory_item_vec').get() as { count: number }).count
    ).toBe(afterFirst.legacy);
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM memory_item_vec_minilm').get() as { count: number })
        .count
    ).toBe(afterFirst.minilm);
    expect(hasRow(db, 'memory_item_vec_minilm', ROW.minilmWindow)).toBe(true);
    expect(hasRow(db, 'memory_item_vec', ROW.minilmNative)).toBe(false);
  });

  it('native minilm 만 있는 코퍼스의 KNN rowid 순서는 up 전후가 같다', async () => {
    if (!vecAvailable) return;

    insertEmbedding(db, {
      id: 31,
      provider: 'minilm',
      projection: 'native',
      dimensions: 384,
      seed: 0,
    });
    insertEmbedding(db, {
      id: 32,
      provider: 'minilm',
      projection: 'native',
      dimensions: 384,
      seed: 8,
    });
    insertEmbedding(db, {
      id: 33,
      provider: 'minilm',
      projection: 'native',
      dimensions: 384,
      seed: 40,
    });

    const query = vectorJson(384, 0);
    const before = knnRowids(db, query);
    expect(before).toContain(31);

    await new NarrowLegacyVecAllowlistMigration().up(db);

    expect(knnRowids(db, query)).toEqual(before);
    expect(hasRow(db, 'memory_item_vec', 31)).toBe(false);
  });
});

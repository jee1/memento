/**
 * Migration 043: JSON TEXT → Float32 BLOB (#809 / US1)
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeFloat32Embedding,
  encodeFloat32Embedding,
} from '../../../../../shared/utils/embedding-serialization.js';
import { logger } from '../../../../../shared/utils/logger.js';
import {
  VEC_TABLES,
  checkVecCardinality,
  listExistingVecTables,
} from '../../vec-schema.js';
import { EmbeddingFloat32BlobMigration } from './043-embedding-float32-blob.js';

async function loadVecExtension(db: Database.Database): Promise<boolean> {
  try {
    const { getLoadablePath } = await import('sqlite-vec');
    db.loadExtension(getLoadablePath());
    return true;
  } catch {
    return false;
  }
}

function embeddingColumnType(db: Database.Database): string | undefined {
  const cols = db.prepare('PRAGMA table_info(memory_embedding)').all() as Array<{
    name: string;
    type: string;
  }>;
  return cols.find(c => c.name === 'embedding')?.type;
}

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

function insertJsonEmbedding(
  db: Database.Database,
  row: {
    id: number;
    memoryId: string;
    provider?: string;
    dimensions: number;
    vector: number[] | string;
    precision?: number;
  },
): void {
  db.prepare('INSERT INTO memory_item (id, content) VALUES (?, ?)').run(row.memoryId, 'content');
  const embedding =
    typeof row.vector === 'string' ? row.vector : JSON.stringify(row.vector);
  db.prepare(
    `INSERT INTO memory_embedding (
      id, memory_id, embedding_provider, projection_type, embedding, dim, dimensions, precision
    ) VALUES (?, ?, ?, 'native', ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.memoryId,
    row.provider ?? 'mock',
    embedding,
    row.dimensions,
    row.dimensions,
    row.precision ?? 16,
  );
}

describe('EmbeddingFloat32BlobMigration (043)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createLegacySchema(db);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it('JSON embeddings → Float32 BLOB, precision=32, row count preserved', async () => {
    const v1 = [0.1, 0.2, 0.3, 0.4];
    const v2 = Array.from({ length: 64 }, (_, i) => (i + 1) * 0.01);
    insertJsonEmbedding(db, { id: 1, memoryId: 'mem_1', dimensions: 4, vector: v1 });
    insertJsonEmbedding(db, {
      id: 2,
      memoryId: 'mem_2',
      provider: 'mock',
      dimensions: 64,
      vector: v2,
    });

    const beforeCount = (
      db.prepare('SELECT COUNT(*) AS c FROM memory_embedding').get() as { c: number }
    ).c;

    const migration = new EmbeddingFloat32BlobMigration();
    await migration.validateBefore(db);
    await migration.up(db);
    await migration.validateAfter(db);

    expect(embeddingColumnType(db)?.toUpperCase()).toBe('BLOB');
    const afterCount = (
      db.prepare('SELECT COUNT(*) AS c FROM memory_embedding').get() as { c: number }
    ).c;
    expect(afterCount).toBe(beforeCount);

    const rows = db
      .prepare('SELECT id, embedding, precision, dim, dimensions FROM memory_embedding ORDER BY id')
      .all() as Array<{
      id: number;
      embedding: Buffer;
      precision: number;
      dim: number;
      dimensions: number;
    }>;

    expect(Buffer.isBuffer(rows[0]!.embedding)).toBe(true);
    const decoded1 = decodeFloat32Embedding(rows[0]!.embedding);
    expect(decoded1.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(decoded1[i]).toBeCloseTo(v1[i]!, 5);
    }
    expect(rows[0]!.precision).toBe(32);
    expect(rows[0]!.dim).toBe(4);
    expect(rows[0]!.dimensions).toBe(4);

    const decoded2 = decodeFloat32Embedding(rows[1]!.embedding);
    expect(decoded2.length).toBe(64);
    for (let i = 0; i < 64; i++) {
      expect(decoded2[i]).toBeCloseTo(v2[i]!, 5);
    }
    expect(rows[1]!.precision).toBe(32);
  });

  it('unit vector rows → normalized=1 after migration (T026 / FR-009)', async () => {
    insertJsonEmbedding(db, {
      id: 1,
      memoryId: 'mem_unit',
      dimensions: 2,
      vector: [1, 0],
    });
    insertJsonEmbedding(db, {
      id: 2,
      memoryId: 'mem_unit3',
      dimensions: 3,
      vector: [0, 0, 1],
    });
    insertJsonEmbedding(db, {
      id: 3,
      memoryId: 'mem_not_unit',
      dimensions: 2,
      vector: [3, 4],
    });

    const migration = new EmbeddingFloat32BlobMigration();
    await migration.up(db);

    const rows = db
      .prepare('SELECT memory_id, normalized FROM memory_embedding ORDER BY id')
      .all() as Array<{ memory_id: string; normalized: number }>;

    expect(rows.find(r => r.memory_id === 'mem_unit')!.normalized).toBe(1);
    expect(rows.find(r => r.memory_id === 'mem_unit3')!.normalized).toBe(1);
    expect(rows.find(r => r.memory_id === 'mem_not_unit')!.normalized).toBe(0);
  });

  it('SC-008: N≥100 sample — unit/non-unit normalized flags + precision=32', async () => {
    const unitCount = 70;
    const nonUnitCount = 30;
    const dim = 8;

    for (let i = 0; i < unitCount; i++) {
      // e_i basis (padded) → L2 = 1
      const vector = Array.from({ length: dim }, (_, j) => (j === i % dim ? 1 : 0));
      insertJsonEmbedding(db, {
        id: i + 1,
        memoryId: `mem_unit_${i}`,
        dimensions: dim,
        vector,
      });
    }
    for (let i = 0; i < nonUnitCount; i++) {
      // [2,0,...] → L2 = 2
      const vector = Array.from({ length: dim }, (_, j) => (j === 0 ? 2 : 0));
      insertJsonEmbedding(db, {
        id: unitCount + i + 1,
        memoryId: `mem_nonunit_${i}`,
        dimensions: dim,
        vector,
      });
    }

    const beforeCount = (
      db.prepare('SELECT COUNT(*) AS c FROM memory_embedding').get() as { c: number }
    ).c;
    expect(beforeCount).toBe(100);

    const migration = new EmbeddingFloat32BlobMigration();
    await migration.validateBefore(db);
    await migration.up(db);
    await migration.validateAfter(db);

    const rows = db
      .prepare('SELECT memory_id, precision, normalized FROM memory_embedding')
      .all() as Array<{ memory_id: string; precision: number; normalized: number }>;

    expect(rows).toHaveLength(100);
    expect(rows.every(r => r.precision === 32)).toBe(true);

    const unitRows = rows.filter(r => r.memory_id.startsWith('mem_unit_'));
    const nonUnitRows = rows.filter(r => r.memory_id.startsWith('mem_nonunit_'));
    expect(unitRows).toHaveLength(70);
    expect(nonUnitRows).toHaveLength(30);
    expect(unitRows.every(r => r.normalized === 1)).toBe(true);
    expect(nonUnitRows.every(r => r.normalized === 0)).toBe(true);
  });

  it('dim mismatch (dim=384, JSON length 64) fails and rolls back TEXT (FR edge)', async () => {
    const vector = Array.from({ length: 64 }, (_, i) => (i + 1) * 0.01);
    insertJsonEmbedding(db, {
      id: 1,
      memoryId: 'mem_mismatch',
      dimensions: 64,
      vector,
    });
    // Column metadata claims 384 while JSON array length is 64
    db.prepare(
      `UPDATE memory_embedding SET dim = 384, dimensions = 384 WHERE id = 1`,
    ).run();

    const beforeCount = (
      db.prepare('SELECT COUNT(*) AS c FROM memory_embedding').get() as { c: number }
    ).c;

    const migration = new EmbeddingFloat32BlobMigration();
    await expect(migration.up(db)).rejects.toThrow(/dim mismatch|dimensions mismatch/i);

    expect(embeddingColumnType(db)?.toUpperCase()).toBe('TEXT');
    const afterCount = (
      db.prepare('SELECT COUNT(*) AS c FROM memory_embedding').get() as { c: number }
    ).c;
    expect(afterCount).toBe(beforeCount);
    const row = db
      .prepare('SELECT embedding FROM memory_embedding WHERE id = 1')
      .get() as { embedding: string };
    expect(typeof row.embedding).toBe('string');
    expect(row.embedding).toBe(JSON.stringify(vector));
  });

  it('malformed JSON fails migration and preserves TEXT column', async () => {
    insertJsonEmbedding(db, {
      id: 1,
      memoryId: 'mem_ok',
      dimensions: 2,
      vector: [0.5, -0.5],
    });
    insertJsonEmbedding(db, {
      id: 2,
      memoryId: 'mem_bad_json',
      dimensions: 2,
      vector: '{not-json',
    });

    await expect(new EmbeddingFloat32BlobMigration().up(db)).rejects.toThrow();

    expect(embeddingColumnType(db)?.toUpperCase()).toBe('TEXT');
    const rows = db
      .prepare('SELECT id, embedding FROM memory_embedding ORDER BY id')
      .all() as Array<{ id: number; embedding: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[1]!.embedding).toBe('{not-json');
  });

  it('non-array JSON string fails migration and preserves TEXT column', async () => {
    insertJsonEmbedding(db, {
      id: 1,
      memoryId: 'mem_not_array',
      dimensions: 1,
      vector: '"not-an-array"',
    });

    await expect(new EmbeddingFloat32BlobMigration().up(db)).rejects.toThrow(/expected JSON array/i);

    expect(embeddingColumnType(db)?.toUpperCase()).toBe('TEXT');
    const row = db
      .prepare('SELECT embedding FROM memory_embedding WHERE id = 1')
      .get() as { embedding: string };
    expect(row.embedding).toBe('"not-an-array"');
  });

  it('NaN row fails migration and rolls back live TEXT data (SC-006)', async () => {
    insertJsonEmbedding(db, {
      id: 1,
      memoryId: 'mem_ok',
      dimensions: 2,
      vector: [1, 0],
    });
    insertJsonEmbedding(db, {
      id: 2,
      memoryId: 'mem_bad',
      dimensions: 2,
      vector: '[1, NaN]',
    });

    const migration = new EmbeddingFloat32BlobMigration();
    await expect(migration.up(db)).rejects.toThrow();

    expect(embeddingColumnType(db)?.toUpperCase()).toBe('TEXT');
    const rows = db
      .prepare('SELECT id, embedding FROM memory_embedding ORDER BY id')
      .all() as Array<{ id: number; embedding: string }>;
    expect(rows).toHaveLength(2);
    expect(typeof rows[0]!.embedding).toBe('string');
    expect(rows[0]!.embedding).toBe(JSON.stringify([1, 0]));
    expect(rows[1]!.embedding).toBe('[1, NaN]');
  });

  it('empty [] sets dim=0 and counts rows_skipped_empty (SC-009)', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger);

    insertJsonEmbedding(db, {
      id: 1,
      memoryId: 'mem_empty',
      dimensions: 0,
      vector: [],
    });
    insertJsonEmbedding(db, {
      id: 2,
      memoryId: 'mem_ok',
      dimensions: 2,
      vector: [0.5, -0.5],
    });

    await new EmbeddingFloat32BlobMigration().up(db);

    const emptyRow = db
      .prepare('SELECT embedding, dim, dimensions FROM memory_embedding WHERE id = 1')
      .get() as { embedding: Buffer | null; dim: number; dimensions: number };
    expect(emptyRow.embedding).toBeNull();
    expect(emptyRow.dim).toBe(0);
    expect(emptyRow.dimensions).toBe(0);

    const reportCall = infoSpy.mock.calls.find(call =>
      String(call[0]).includes('embedding-float32-blob'),
    );
    expect(reportCall).toBeDefined();
    const payload = reportCall?.[1] as {
      rows_migrated?: number;
      rows_skipped_empty?: number;
    };
    expect(payload.rows_skipped_empty).toBe(1);
    expect(payload.rows_migrated).toBe(1);
  });

  it('second run is idempotent no-op (already_float32)', async () => {
    insertJsonEmbedding(db, {
      id: 1,
      memoryId: 'mem_1',
      dimensions: 3,
      vector: [1, 2, 3],
    });

    const migration = new EmbeddingFloat32BlobMigration();
    await migration.up(db);

    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    await expect(migration.up(db)).resolves.toBeUndefined();
    await expect(migration.validateAfter(db)).resolves.toBeUndefined();

    const already = infoSpy.mock.calls.find(
      call =>
        String(call[0]).includes('already_float32') ||
        (call[1] as { already_float32?: boolean } | undefined)?.already_float32 === true,
    );
    expect(already).toBeDefined();

    const row = db
      .prepare('SELECT embedding, precision FROM memory_embedding WHERE id = 1')
      .get() as { embedding: Buffer; precision: number };
    expect(Buffer.isBuffer(row.embedding)).toBe(true);
    expect(row.precision).toBe(32);
  });

  it('down throws irreversible', async () => {
    await expect(new EmbeddingFloat32BlobMigration().down(db)).rejects.toThrow(/irreversible/i);
  });

  it('sqlite-vec: cardinality matched after migration; BLOB INSERT triggers vec (T013)', async () => {
    const vecAvailable = await loadVecExtension(db);
    if (!vecAvailable) return;

    for (const table of VEC_TABLES) {
      db.exec(
        `CREATE VIRTUAL TABLE ${table.name} USING vec0(embedding float[${table.dimension}] distance_metric=cosine)`,
      );
    }

    const vector = Array.from({ length: 64 }, (_, i) => (i + 1) * 0.02);
    insertJsonEmbedding(db, {
      id: 1,
      memoryId: 'mem_vec',
      provider: 'mock',
      dimensions: 64,
      vector,
    });
    db.exec(
      `INSERT INTO memory_item_vec_mock(rowid, embedding)
       SELECT id, json_extract(embedding, '$') FROM memory_embedding WHERE id = 1`,
    );

    const migration = new EmbeddingFloat32BlobMigration();
    await migration.up(db);
    await migration.validateAfter(db);

    const report = checkVecCardinality(db);
    expect(report.length).toBeGreaterThan(0);
    expect(report.every(row => row.matched)).toBe(true);

    // T013: post-migration BLOB insert should populate vec via triggers
    db.prepare('INSERT INTO memory_item (id, content) VALUES (?, ?)').run('mem_new', 'x');
    const blob = encodeFloat32Embedding(vector);
    db.prepare(
      `INSERT INTO memory_embedding (
        id, memory_id, embedding_provider, projection_type, embedding, dim, dimensions, precision
      ) VALUES (?, ?, 'mock', 'native', ?, 64, 64, 32)`,
    ).run(99, 'mem_new', blob);

    expect(
      (db.prepare('SELECT COUNT(*) AS c FROM memory_item_vec_mock WHERE rowid = 99').get() as {
        c: number;
      }).c,
    ).toBe(1);
    expect(listExistingVecTables(db).some(t => t.name === 'memory_item_vec_mock')).toBe(true);
  });
});

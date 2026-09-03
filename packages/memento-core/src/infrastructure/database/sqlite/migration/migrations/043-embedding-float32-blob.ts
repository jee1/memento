/**
 * Migration: 043 - memory_embedding JSON TEXT → Float32 BLOB (#809)
 *
 * - Atomic create/copy/drop/rename + vec trigger DROP inside one db.transaction() (#755 / FR-003)
 * - Empty JSON `[]` → NULL blob, dim=0, dimensions=0; counted as rows_skipped_empty (FR-018)
 * - NaN/Inf or dim mismatch → throw → full rollback (FR-015, FR-020)
 * - After success (txn outside): drop/recreate existing vec tables, repopulate, recreateVecTriggers (FR-017)
 * - Idempotent when already BLOB with no TEXT embeddings left
 * - down is irreversible
 */

import type Database from 'better-sqlite3';
import {
  computeL2Norm,
  decodeFloat32Embedding,
  migrateJsonEmbeddingToBlob,
  shouldNormalizeFlag,
} from '../../../../../shared/utils/embedding-serialization.js';
import { logger } from '../../../../../shared/utils/logger.js';
import {
  VEC_TRIGGER_NAMES,
  buildVecTableDdl,
  checkVecCardinality,
  listExistingVecTables,
  recreateVecTriggers,
  repopulateVecTable,
} from '../../vec-schema.js';
import type { Migration } from '../types.js';

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function embeddingColumnType(db: Database.Database): string | undefined {
  const cols = db.prepare('PRAGMA table_info(memory_embedding)').all() as Array<{
    name: string;
    type: string;
  }>;
  return cols.find(c => c.name === 'embedding')?.type;
}

function isAlreadyFloat32Blob(db: Database.Database): boolean {
  const type = embeddingColumnType(db)?.toUpperCase();
  if (type !== 'BLOB') {
    return false;
  }
  const textRows = db
    .prepare(
      `SELECT COUNT(*) AS c FROM memory_embedding WHERE typeof(embedding) = 'text'`,
    )
    .get() as { c: number };
  return textRows.c === 0;
}

function assertDimMatch(
  arrayLength: number,
  dim: number | null | undefined,
  dimensions: number | null | undefined,
): void {
  if (dim != null && dim !== 0 && dim !== arrayLength) {
    throw new Error(
      `embedding dim mismatch: column dim=${dim} but JSON length=${arrayLength}`,
    );
  }
  if (dimensions != null && dimensions !== 0 && dimensions !== arrayLength) {
    throw new Error(
      `embedding dimensions mismatch: column dimensions=${dimensions} but JSON length=${arrayLength}`,
    );
  }
}

export class EmbeddingFloat32BlobMigration implements Migration {
  version = '43.0';
  name = 'embedding-float32-blob';
  description =
    'Convert memory_embedding.embedding from JSON TEXT to little-endian Float32 BLOB';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'memory_embedding')) {
      throw new Error('memory_embedding table does not exist. Cannot proceed with migration.');
    }

    // Allow tests and explicit skip
    const skip =
      process.env.NODE_ENV === 'test' ||
      process.env.MEMENTO_SKIP_EMBEDDING_BLOB_PRECHECK === '1';
    if (!skip && process.env.MEMENTO_DB_PRECHECK_OK !== '1') {
      throw new Error(
        'FR-004: run npm run db:pre-docker-deploy then set MEMENTO_DB_PRECHECK_OK=1 (or MEMENTO_SKIP_EMBEDDING_BLOB_PRECHECK=1)',
      );
    }
  }

  async up(db: Database.Database): Promise<void> {
    if (isAlreadyFloat32Blob(db)) {
      logger.info('embedding-float32-blob already_float32', { already_float32: true });
      return;
    }

    let rowsMigrated = 0;
    let rowsSkippedEmpty = 0;

    const migrateTable = db.transaction(() => {
      for (const triggerName of VEC_TRIGGER_NAMES) {
        db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
      }

      db.exec(`
        CREATE TABLE memory_embedding__new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          embedding_provider TEXT NOT NULL DEFAULT 'tfidf',
          projection_type TEXT NOT NULL DEFAULT 'native',
          embedding BLOB,
          dim INTEGER NOT NULL,
          dimensions INTEGER DEFAULT 0,
          model TEXT,
          precision INTEGER DEFAULT 32,
          normalized BOOLEAN DEFAULT FALSE,
          version INTEGER DEFAULT 1,
          created_by TEXT DEFAULT 'system',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
          UNIQUE(memory_id, embedding_provider, projection_type)
        )
      `);

      const sourceCols = db.prepare('PRAGMA table_info(memory_embedding)').all() as Array<{
        name: string;
      }>;
      const colNames = new Set(sourceCols.map(c => c.name));
      const has = (name: string) => colNames.has(name);

      const selectSql = `
        SELECT
          id,
          memory_id,
          ${has('embedding_provider') ? 'embedding_provider' : "'tfidf' AS embedding_provider"},
          ${has('projection_type') ? 'projection_type' : "'native' AS projection_type"},
          embedding,
          dim,
          ${has('dimensions') ? 'dimensions' : 'dim AS dimensions'},
          ${has('model') ? 'model' : 'NULL AS model'},
          ${has('precision') ? 'precision' : '32 AS precision'},
          ${has('normalized') ? 'normalized' : '0 AS normalized'},
          ${has('version') ? 'version' : '1 AS version'},
          ${has('created_by') ? 'created_by' : "'system' AS created_by"},
          ${has('created_at') ? 'created_at' : 'CURRENT_TIMESTAMP AS created_at'}
        FROM memory_embedding
      `;

      const insert = db.prepare(`
        INSERT INTO memory_embedding__new (
          id, memory_id, embedding_provider, projection_type,
          embedding, dim, dimensions, model, precision, normalized,
          version, created_by, created_at
        ) VALUES (
          @id, @memory_id, @embedding_provider, @projection_type,
          @embedding, @dim, @dimensions, @model, @precision, @normalized,
          @version, @created_by, @created_at
        )
      `);

      const rows = db.prepare(selectSql).all() as Array<{
        id: number;
        memory_id: string;
        embedding_provider: string;
        projection_type: string;
        embedding: unknown;
        dim: number;
        dimensions: number;
        model: string | null;
        precision: number;
        normalized: number;
        version: number;
        created_by: string;
        created_at: string;
      }>;

      for (const row of rows) {
        const base = {
          id: row.id,
          memory_id: row.memory_id,
          embedding_provider: row.embedding_provider || 'tfidf',
          projection_type: row.projection_type || 'native',
          model: row.model,
          version: row.version ?? 1,
          created_by: row.created_by || 'system',
          created_at: row.created_at,
          precision: 32,
        };

        // Already a Buffer (unexpected on TEXT schema) — copy through
        if (Buffer.isBuffer(row.embedding)) {
          const floats = decodeFloat32Embedding(row.embedding);
          insert.run({
            ...base,
            embedding: row.embedding,
            dim: floats.length,
            dimensions: floats.length,
            normalized: shouldNormalizeFlag(computeL2Norm(floats)),
          });
          rowsMigrated += 1;
          continue;
        }

        if (row.embedding == null) {
          insert.run({
            ...base,
            embedding: null,
            dim: 0,
            dimensions: 0,
            normalized: 0,
          });
          rowsSkippedEmpty += 1;
          continue;
        }

        const json =
          typeof row.embedding === 'string'
            ? row.embedding
            : String(row.embedding);

        const { blob, dimensions } = migrateJsonEmbeddingToBlob(json);

        if (dimensions === 0 || blob == null) {
          insert.run({
            ...base,
            embedding: null,
            dim: 0,
            dimensions: 0,
            normalized: 0,
          });
          rowsSkippedEmpty += 1;
          continue;
        }

        assertDimMatch(dimensions, row.dim, row.dimensions);
        const floats = decodeFloat32Embedding(blob);
        insert.run({
          ...base,
          embedding: blob,
          dim: dimensions,
          dimensions,
          normalized: shouldNormalizeFlag(computeL2Norm(floats)),
        });
        rowsMigrated += 1;
      }

      db.exec('DROP TABLE memory_embedding');
      db.exec('ALTER TABLE memory_embedding__new RENAME TO memory_embedding');

      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id)',
      );
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_provider ON memory_embedding(memory_id, embedding_provider)',
      );
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider_projection ON memory_embedding(embedding_provider, projection_type)',
      );
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions)',
      );
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_memory_embedding_model ON memory_embedding(model)',
      );
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_memory_embedding_version ON memory_embedding(version)',
      );
    });

    migrateTable();

    // FR-017: vec drop/recreate/repopulate + triggers outside the atomic table rebuild
    const existingVec = listExistingVecTables(db);
    for (const table of existingVec) {
      db.exec(`DROP TABLE IF EXISTS ${table.name}`);
      db.exec(buildVecTableDdl(table));
      repopulateVecTable(db, table);
    }
    if (existingVec.length > 0) {
      recreateVecTriggers(db, existingVec);
    } else {
      logger.warn(
        '⚠️  vec 테이블이 없습니다 (sqlite-vec 확장 미설치). 트리거 생성을 건너뜁니다.',
      );
    }

    logger.info('embedding-float32-blob migration complete', {
      rows_migrated: rowsMigrated,
      rows_skipped_empty: rowsSkippedEmpty,
    });
  }

  async down(_db: Database.Database): Promise<void> {
    throw new Error(
      'Migration 043 embedding-float32-blob is irreversible (BLOB → JSON not supported)',
    );
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'memory_embedding')) {
      throw new Error('memory_embedding missing after migration 043');
    }

    const type = embeddingColumnType(db)?.toUpperCase();
    if (type !== 'BLOB') {
      throw new Error(
        `memory_embedding.embedding expected BLOB after migration 043, got ${type ?? 'missing'}`,
      );
    }

    const textRows = db
      .prepare(
        `SELECT COUNT(*) AS c FROM memory_embedding WHERE typeof(embedding) = 'text'`,
      )
      .get() as { c: number };
    if (textRows.c > 0) {
      throw new Error(
        `memory_embedding still has ${textRows.c} TEXT embedding row(s) after migration 043`,
      );
    }

    const existingVec = listExistingVecTables(db);
    if (existingVec.length === 0) {
      return;
    }

    const mismatched = checkVecCardinality(db).filter(row => !row.matched);
    if (mismatched.length > 0) {
      throw new Error(
        `vec cardinality mismatch after migration 043: ${mismatched
          .map(m => `${m.table} expected=${m.expected} actual=${m.actual}`)
          .join('; ')}`,
      );
    }
  }
}

export default EmbeddingFloat32BlobMigration;

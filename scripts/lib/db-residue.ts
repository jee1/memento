import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

const SAMPLE_LIMIT = 20;

export interface DbResidueReport {
  missing_minilm_semantic: { count: number; sample_ids: string[] };
  duplicate_minilm_vectors: {
    count: number;
    sample_pairs: Array<{ memory_ids: string[]; embedding_hash?: string }>;
  };
  dimensions_zero: { count: number; ids: string[] };
}

export function buildDbResidueReport(db: Database.Database): DbResidueReport {
  const missingRows = db
    .prepare(
      `SELECT mi.id
         FROM memory_item mi
         LEFT JOIN memory_embedding me
           ON me.memory_id = mi.id AND me.embedding_provider = 'minilm'
        WHERE mi.type = 'semantic'
          AND me.memory_id IS NULL
        ORDER BY mi.id
        LIMIT ?`,
    )
    .all(SAMPLE_LIMIT + 1) as Array<{ id: string }>;

  const missingCountRow = db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM memory_item mi
         LEFT JOIN memory_embedding me
           ON me.memory_id = mi.id AND me.embedding_provider = 'minilm'
        WHERE mi.type = 'semantic'
          AND me.memory_id IS NULL`,
    )
    .get() as { c: number };

  const dimZeroRows = db
    .prepare(
      `SELECT id FROM memory_embedding WHERE dimensions = 0 ORDER BY id LIMIT ?`,
    )
    .all(SAMPLE_LIMIT + 1) as Array<{ id: string }>;

  const dimZeroCountRow = db
    .prepare(`SELECT COUNT(*) AS c FROM memory_embedding WHERE dimensions = 0`)
    .get() as { c: number };

  const duplicateGroups = db
    .prepare(
      `SELECT embedding, GROUP_CONCAT(memory_id) AS memory_ids
         FROM memory_embedding
        WHERE embedding_provider = 'minilm'
          AND dimensions > 0
        GROUP BY embedding
       HAVING COUNT(*) > 1
        LIMIT ?`,
    )
    .all(SAMPLE_LIMIT + 1) as Array<{ embedding: Buffer; memory_ids: string }>;

  const duplicateCountRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM (
         SELECT 1
           FROM memory_embedding
          WHERE embedding_provider = 'minilm'
            AND dimensions > 0
          GROUP BY embedding
         HAVING COUNT(*) > 1
       )`,
    )
    .get() as { c: number };

  return {
    missing_minilm_semantic: {
      count: Number(missingCountRow.c),
      sample_ids: missingRows.slice(0, SAMPLE_LIMIT).map(r => r.id),
    },
    duplicate_minilm_vectors: {
      count: Number(duplicateCountRow.c),
      sample_pairs: duplicateGroups.slice(0, SAMPLE_LIMIT).map(row => ({
        memory_ids: row.memory_ids.split(','),
        embedding_hash: createHash('sha256').update(row.embedding).digest('hex').slice(0, 12),
      })),
    },
    dimensions_zero: {
      count: Number(dimZeroCountRow.c),
      ids: dimZeroRows.slice(0, SAMPLE_LIMIT).map(r => r.id),
    },
  };
}

export function previewDimensionsZeroCleanup(db: Database.Database): { count: number; ids: string[] } {
  const rows = db
    .prepare(`SELECT id FROM memory_embedding WHERE dimensions = 0 ORDER BY id`)
    .all() as Array<{ id: string }>;
  return { count: rows.length, ids: rows.map(r => r.id) };
}

export function applyDimensionsZeroCleanup(db: Database.Database): number {
  return db.prepare(`DELETE FROM memory_embedding WHERE dimensions = 0`).run().changes;
}

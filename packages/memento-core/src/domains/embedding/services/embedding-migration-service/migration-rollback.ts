import type { Database, Statement } from 'better-sqlite3';

import type { MigrationRollbackEntry } from '../../../../shared/types/migration.types.js';
import { DEFAULT_CREATED_BY } from './types.js';

export function rollback(db: Database, entries: ReadonlyArray<MigrationRollbackEntry>): void {
  if (!entries.length) {
    return;
  }

  const deleteStatement = db.prepare(
    `DELETE FROM memory_embedding WHERE memory_id = ? AND embedding_provider = ? AND projection_type = ?`
  );

  const restoreStatement = db.prepare(
    `
      INSERT INTO memory_embedding (
        memory_id,
        embedding_provider,
        projection_type,
        embedding,
        dim,
        model,
        dimensions,
        precision,
        normalized,
        version,
        created_by,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, embedding_provider, projection_type) DO UPDATE SET
        embedding = excluded.embedding,
        dim = excluded.dim,
        model = excluded.model,
        dimensions = excluded.dimensions,
        precision = excluded.precision,
        normalized = excluded.normalized,
        version = excluded.version,
        created_by = excluded.created_by,
        created_at = excluded.created_at
    `
  );

  for (const entry of [...entries].reverse()) {
    if (entry.operation === 'delete') {
      applyRollbackDelete(deleteStatement, entry);
    } else {
      applyRollbackRestore(restoreStatement, entry);
    }
  }
}

function applyRollbackDelete(deleteStatement: Statement, entry: MigrationRollbackEntry): void {
  deleteStatement.run(entry.memoryId, entry.provider, entry.projectionType);
}

function applyRollbackRestore(restoreStatement: Statement, entry: MigrationRollbackEntry): void {
  if (!entry.embedding) {
    throw new Error(`Rollback 데이터가 누락되었습니다: ${entry.memoryId}`);
  }
  restoreStatement.run(
    entry.memoryId,
    entry.provider,
    entry.projectionType,
    entry.embedding,
    entry.dim ?? entry.dimensions ?? 0,
    entry.model ?? null,
    entry.dimensions ?? entry.dim ?? 0,
    entry.precision ?? 32,
    entry.normalized ?? 0,
    entry.version ?? 1,
    entry.createdBy ?? DEFAULT_CREATED_BY,
    entry.createdAt ?? new Date().toISOString()
  );
}

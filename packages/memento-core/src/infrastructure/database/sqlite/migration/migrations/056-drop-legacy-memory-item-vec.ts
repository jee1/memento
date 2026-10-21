/**
 * Migration: 056 — 빈 레거시 memory_item_vec 제거 (#1383)
 * Version: 56.0
 *
 * 053 이 tfidf/lightweight 384 native 만 남긴 뒤 운영 DB 사본은 0행이었다.
 * 새 쓰기는 512차원 memory_item_vec_tfidf 로만 간다.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../../../shared/utils/logger.js';
import { listExistingVecTables, recreateVecTriggers } from '../../vec-schema.js';
import type { Migration } from '../types.js';

const LEGACY_TABLE = 'memory_item_vec';

function isQueryable(db: Database.Database, table: string): boolean {
  try {
    db.prepare(`SELECT rowid FROM ${table} LIMIT 1`).get();
    return true;
  } catch {
    return false;
  }
}

export class DropLegacyMemoryItemVecMigration implements Migration {
  version = '56.0';
  name = 'drop-legacy-memory-item-vec';
  description = 'Drop the empty legacy memory_item_vec table and refresh vec triggers (#1383)';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    if (isQueryable(db, LEGACY_TABLE)) {
      db.exec(`DROP TABLE ${LEGACY_TABLE}`);
    }
    const hasEmbedding = Boolean(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_embedding'").get()
    );
    if (!hasEmbedding) {
      return;
    }
    recreateVecTriggers(db, listExistingVecTables(db));
    logger.info('drop-legacy-memory-item-vec: memory_item_vec 제거 완료');
  }

  async down(_db: Database.Database): Promise<void> {
    throw new Error('Migration 056 down is not supported — memory_item_vec removal is irreversible');
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (isQueryable(db, LEGACY_TABLE)) {
      throw new Error('memory_item_vec still exists after migration 056');
    }
    const trigger = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'memory_embedding_vec_insert'"
      )
      .get() as { sql?: string } | undefined;
    const sql = trigger?.sql ?? '';
    if (sql.includes('INSERT INTO memory_item_vec(')) {
      throw new Error('Migration 056 left an insert trigger for memory_item_vec');
    }
  }
}

export default DropLegacyMemoryItemVecMigration;

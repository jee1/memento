/**
 * Migration: 055 — memory_relation 중복 인덱스 제거 (#1376)
 * Version: 55.0
 *
 * source·target 단일 인덱스는 source_type·target_type 및
 * UNIQUE(source_id, target_id, relation_type)의 접두사다.
 * relation_type·confidence 단독 조건 조회는 없다.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../../../shared/utils/logger.js';
import type { Migration } from '../types.js';

const DROPPED_INDEXES = [
  'idx_memory_relation_source',
  'idx_memory_relation_target',
  'idx_memory_relation_type',
  'idx_memory_relation_confidence',
] as const;

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { name: string } | undefined;
  return Boolean(row);
}

export class DropRedundantRelationIndexesMigration implements Migration {
  version = '55.0';
  name = 'drop-redundant-relation-indexes';
  description = 'Drop redundant memory_relation indexes (#1376)';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    for (const indexName of DROPPED_INDEXES) {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    }
    logger.info('drop-redundant-relation-indexes: memory_relation 중복 인덱스 제거 완료');
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_relation_source ON memory_relation(source_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_relation_target ON memory_relation(target_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_relation_type ON memory_relation(relation_type)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_relation_confidence ON memory_relation(confidence)');
  }

  async validateAfter(db: Database.Database): Promise<void> {
    for (const indexName of DROPPED_INDEXES) {
      if (indexExists(db, indexName)) {
        throw new Error(`${indexName} still exists after migration 055`);
      }
    }
  }
}

export default DropRedundantRelationIndexesMigration;

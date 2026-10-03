/**
 * Migration: 050 — triple 추출 스키마 제거 (#1237 Phase 3)
 * Version: 50.0
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../../../shared/utils/logger.js';
import type { Migration } from '../types.js';

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { name: string } | undefined;
  return Boolean(row);
}

export class DropTripleSchemaMigration implements Migration {
  version = '50.0';
  name = 'drop-triple-schema';
  description = 'Drop kg_triple table and memory_item triple extraction columns (#1237)';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'memory_item')) {
      throw new Error('Migration 050 requires the memory_item table');
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_kg_triple_spo');
    db.exec('DROP INDEX IF EXISTS idx_kg_triple_representative');
    db.exec('DROP INDEX IF EXISTS idx_kg_triple_owner');
    db.exec('DROP INDEX IF EXISTS idx_kg_triple_process');
    db.exec('DROP TABLE IF EXISTS kg_triple');

    db.exec('DROP INDEX IF EXISTS idx_memory_item_triple_extracted');
    db.exec('DROP INDEX IF EXISTS idx_memory_item_triple_status');
    db.exec('DROP INDEX IF EXISTS idx_memory_item_triple_extracted_episodic');
    db.exec('DROP INDEX IF EXISTS idx_memory_item_triple_extracted_status_episodic');
    db.exec('DROP INDEX IF EXISTS idx_memory_item_triple');

    if (columnExists(db, 'memory_item', 'triple_extracted')) {
      db.exec('ALTER TABLE memory_item DROP COLUMN triple_extracted');
    }
    if (columnExists(db, 'memory_item', 'triple_extracted_status')) {
      db.exec('ALTER TABLE memory_item DROP COLUMN triple_extracted_status');
    }
    if (columnExists(db, 'memory_item', 'triple_extraction_metadata')) {
      db.exec('ALTER TABLE memory_item DROP COLUMN triple_extraction_metadata');
    }
    if (columnExists(db, 'memory_item', 'subject')) {
      db.exec('ALTER TABLE memory_item DROP COLUMN subject');
    }
    if (columnExists(db, 'memory_item', 'predicate')) {
      db.exec('ALTER TABLE memory_item DROP COLUMN predicate');
    }
    if (columnExists(db, 'memory_item', 'object')) {
      db.exec('ALTER TABLE memory_item DROP COLUMN object');
    }

    logger.info('drop-triple-schema: kg_triple·triple 추출·SPO 컬럼 제거 완료');
  }

  async down(_db: Database.Database): Promise<void> {
    throw new Error('Migration 050 down is not supported — triple schema removal is irreversible');
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (tableExists(db, 'kg_triple')) {
      throw new Error('kg_triple table still exists after migration 050');
    }
    if (columnExists(db, 'memory_item', 'triple_extracted')) {
      throw new Error('triple_extracted column still exists after migration 050');
    }
    if (columnExists(db, 'memory_item', 'triple_extracted_status')) {
      throw new Error('triple_extracted_status column still exists after migration 050');
    }
    if (columnExists(db, 'memory_item', 'triple_extraction_metadata')) {
      throw new Error('triple_extraction_metadata column still exists after migration 050');
    }
    if (indexExists(db, 'idx_memory_item_triple_extracted')) {
      throw new Error('idx_memory_item_triple_extracted still exists after migration 050');
    }
    if (indexExists(db, 'idx_memory_item_triple_status')) {
      throw new Error('idx_memory_item_triple_status still exists after migration 050');
    }
    if (indexExists(db, 'idx_memory_item_triple_extracted_episodic')) {
      throw new Error('idx_memory_item_triple_extracted_episodic still exists after migration 050');
    }
    if (indexExists(db, 'idx_memory_item_triple_extracted_status_episodic')) {
      throw new Error('idx_memory_item_triple_extracted_status_episodic still exists after migration 050');
    }
    if (indexExists(db, 'idx_memory_item_triple')) {
      throw new Error('idx_memory_item_triple still exists after migration 050');
    }
    if (columnExists(db, 'memory_item', 'subject')) {
      throw new Error('subject column still exists after migration 050');
    }
    if (columnExists(db, 'memory_item', 'predicate')) {
      throw new Error('predicate column still exists after migration 050');
    }
    if (columnExists(db, 'memory_item', 'object')) {
      throw new Error('object column still exists after migration 050');
    }
  }
}

export default DropTripleSchemaMigration;

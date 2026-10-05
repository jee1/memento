/**
 * Migration: 051 — consolidation_score·g_value 컬럼 제거 (#1244)
 * Version: 51.0
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

export class DropConsolidationScoreColumnsMigration implements Migration {
  version = '51.0';
  name = 'drop-consolidation-score-columns';
  description = 'Drop memory_item.consolidation_score and g_value (#1244)';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'memory_item')) {
      throw new Error('Migration 051 requires the memory_item table');
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_memory_item_consol_desc');
    db.exec('DROP INDEX IF EXISTS idx_memory_item_consol_active');

    if (columnExists(db, 'memory_item', 'consolidation_score')) {
      db.exec('ALTER TABLE memory_item DROP COLUMN consolidation_score');
    }
    if (columnExists(db, 'memory_item', 'g_value')) {
      db.exec('ALTER TABLE memory_item DROP COLUMN g_value');
    }

    logger.info('drop-consolidation-score-columns: consolidation_score·g_value 컬럼 제거 완료');
  }

  async down(_db: Database.Database): Promise<void> {
    throw new Error(
      'Migration 051 down is not supported — consolidation score column removal is irreversible',
    );
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (columnExists(db, 'memory_item', 'consolidation_score')) {
      throw new Error('consolidation_score column still exists after migration 051');
    }
    if (columnExists(db, 'memory_item', 'g_value')) {
      throw new Error('g_value column still exists after migration 051');
    }
    if (indexExists(db, 'idx_memory_item_consol_desc')) {
      throw new Error('idx_memory_item_consol_desc still exists after migration 051');
    }
    if (indexExists(db, 'idx_memory_item_consol_active')) {
      throw new Error('idx_memory_item_consol_active still exists after migration 051');
    }
  }
}

export default DropConsolidationScoreColumnsMigration;

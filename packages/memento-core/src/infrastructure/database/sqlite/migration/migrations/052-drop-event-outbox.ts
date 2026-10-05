/**
 * Migration: 052 — event_outbox 테이블 제거 (#1259)
 * Version: 52.0
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../../../shared/utils/logger.js';
import type { Migration } from '../types.js';

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function indexExists(db: Database.Database, indexName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { name: string } | undefined;
  return Boolean(row);
}

export class DropEventOutboxMigration implements Migration {
  version = '52.0';
  name = 'drop-event-outbox';
  description = 'Drop the unused event_outbox table (#1259)';

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_event_outbox_pending');
    db.exec('DROP INDEX IF EXISTS idx_event_outbox_target_uri');
    db.exec('DROP TABLE IF EXISTS event_outbox');
    logger.info('drop-event-outbox: event_outbox 제거 완료');
  }

  async down(_db: Database.Database): Promise<void> {
    throw new Error('Migration 052 down is not supported — event_outbox removal is irreversible');
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (tableExists(db, 'event_outbox')) {
      throw new Error('event_outbox table still exists after migration 052');
    }
    if (indexExists(db, 'idx_event_outbox_pending')) {
      throw new Error('idx_event_outbox_pending still exists after migration 052');
    }
    if (indexExists(db, 'idx_event_outbox_target_uri')) {
      throw new Error('idx_event_outbox_target_uri still exists after migration 052');
    }
  }
}

export default DropEventOutboxMigration;

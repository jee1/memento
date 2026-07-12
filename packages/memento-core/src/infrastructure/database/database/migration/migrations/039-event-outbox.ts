/**
 * Migration: 039 - durable interoperability event outbox
 * Version: 39.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

export class EventOutboxMigration implements Migration {
  version = '39.0';
  name = 'event-outbox';
  description = 'Add durable at-least-once event delivery outbox';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'memory_item')) throw new Error('memory_item table does not exist');
  }

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS event_outbox (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        target_uri TEXT NOT NULL,
        owner_id TEXT,
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_event_outbox_pending
        ON event_outbox(processed_at, available_at, created_at);
      CREATE INDEX IF NOT EXISTS idx_event_outbox_target_uri
        ON event_outbox(target_uri);
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS event_outbox');
    if (tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'event_outbox')) throw new Error('Migration 039 did not create event_outbox table');
  }
}

export default EventOutboxMigration;

/**
 * Migration: 029 — telemetry_events (event_type, created_at) composite index
 * Version: 29.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

export class TelemetryEventsEventTypeCreatedAtIndexMigration implements Migration {
  version = '29.0';
  name = 'telemetry-events-event-type-created-at-index';
  description =
    'Composite index on telemetry_events(event_type, created_at) for time-scoped event-type queries';

  private tableExists(db: Database.Database, tableName: string): boolean {
    const result = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(tableName);
    return !!result;
  }

  private indexExists(db: Database.Database, indexName: string): boolean {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
      .get(indexName) as { name: string } | undefined;
    return !!row;
  }

  async validateBefore(_db: Database.Database): Promise<void> {}

  async up(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'telemetry_events')) {
      return;
    }
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_te_event_type_created_at ON telemetry_events(event_type, created_at)'
    );
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_te_event_type_created_at');
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('29.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'telemetry_events')) {
      return;
    }
    if (!this.indexExists(db, 'idx_te_event_type_created_at')) {
      throw new Error('idx_te_event_type_created_at index was not created');
    }
  }
}

export default TelemetryEventsEventTypeCreatedAtIndexMigration;

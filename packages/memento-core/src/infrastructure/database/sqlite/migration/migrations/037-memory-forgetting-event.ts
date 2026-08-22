/**
 * Migration: 037 — memory_forgetting_event
 * Version: 37.0
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

function objectExists(db: Database.Database, type: 'table' | 'index', name: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name),
  );
}

export class MemoryForgettingEventMigration implements Migration {
  version = '37.0';
  name = 'memory-forgetting-event';
  description = 'Add explainable forgetting event audit log';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!objectExists(db, 'table', 'memory_item')) {
      throw new Error('memory_item table does not exist');
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_forgetting_event (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('soft', 'hard', 'review')),
        reason TEXT NOT NULL,
        policy TEXT NOT NULL,
        forget_score REAL,
        ttl_days INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memory_forgetting_event_memory_id
        ON memory_forgetting_event(memory_id);
      CREATE INDEX IF NOT EXISTS idx_memory_forgetting_event_action
        ON memory_forgetting_event(action);
      CREATE INDEX IF NOT EXISTS idx_memory_forgetting_event_created_at
        ON memory_forgetting_event(created_at);
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS memory_forgetting_event');
    if (objectExists(db, 'table', 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!objectExists(db, 'table', 'memory_forgetting_event')) {
      throw new Error('Migration 037 did not create memory_forgetting_event table');
    }
  }
}

export default MemoryForgettingEventMigration;

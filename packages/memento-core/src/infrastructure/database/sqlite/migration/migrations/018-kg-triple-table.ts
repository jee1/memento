/**
 * Migration: 018 - kg_triple table (Issue #90)
 * Description: Create kg_triple table for KG-dedicated triple storage and dedupe
 * Version: 18.0
 * Date: 2026-02-08
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

/**
 * KG Triple Table Migration (Issue #90)
 *
 * Creates kg_triple table: (subject, predicate, object)당 한 행만 허용(UNIQUE),
 * representative_memory_id로 semantic memory_item을 가리킴.
 */
export class KgTripleTableMigration implements Migration {
  version = '18.0';
  name = 'kg-triple-table';
  description = 'Create kg_triple table for KG dedupe (Issue #90: Semantic Triples·KG 전용 저장소 및 dedupe)';

  private tableExists(db: Database.Database, tableName: string): boolean {
    const result = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(tableName);
    return !!result;
  }

  private columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
    return columns.some(col => col.name === columnName);
  }

  private indexExists(db: Database.Database, indexName: string): boolean {
    const row = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name=?`
    ).get(indexName) as { name: string } | undefined;
    return !!row;
  }

  async validateBefore(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'memory_item')) {
      throw new Error('memory_item table does not exist. Cannot proceed with migration.');
    }
    if (this.tableExists(db, 'kg_triple')) {
      throw new Error('kg_triple table already exists. Migration 018 may have been applied.');
    }
    if (this.tableExists(db, 'memento_schema_version')) {
      const row = db.prepare(
        `SELECT version FROM memento_schema_version WHERE version = ?`
      ).get('18.0') as { version: string } | undefined;
      if (row) {
        throw new Error('Migration 018 has already been applied. Current schema version: 18.0');
      }
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS kg_triple (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        owner_id TEXT NULL,
        process_id TEXT NULL,
        session_id TEXT NULL,
        representative_memory_id TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (representative_memory_id) REFERENCES memory_item(id) ON DELETE SET NULL,
        UNIQUE(subject, predicate, object)
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_kg_triple_spo ON kg_triple(subject, predicate, object)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_kg_triple_representative ON kg_triple(representative_memory_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_kg_triple_owner ON kg_triple(owner_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_kg_triple_process ON kg_triple(process_id)');
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP INDEX IF EXISTS idx_kg_triple_process');
    db.exec('DROP INDEX IF EXISTS idx_kg_triple_owner');
    db.exec('DROP INDEX IF EXISTS idx_kg_triple_representative');
    db.exec('DROP INDEX IF EXISTS idx_kg_triple_spo');
    db.exec('DROP TABLE IF EXISTS kg_triple');
    if (this.tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('18.0');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!this.tableExists(db, 'kg_triple')) {
      throw new Error('kg_triple table was not created');
    }
    const requiredColumns = ['id', 'subject', 'predicate', 'object', 'owner_id', 'process_id', 'session_id', 'representative_memory_id', 'created_at'];
    for (const col of requiredColumns) {
      if (!this.columnExists(db, 'kg_triple', col)) {
        throw new Error(`Column kg_triple.${col} was not created`);
      }
    }
    const uniqueCheck = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='kg_triple'`
    ).get() as { sql: string } | undefined;
    if (!uniqueCheck?.sql?.includes('UNIQUE(subject, predicate, object)')) {
      throw new Error('UNIQUE constraint on (subject, predicate, object) was not created');
    }
    const indexes = ['idx_kg_triple_spo', 'idx_kg_triple_representative', 'idx_kg_triple_owner', 'idx_kg_triple_process'];
    for (const idx of indexes) {
      if (!this.indexExists(db, idx)) {
        throw new Error(`Index ${idx} was not created`);
      }
    }
  }
}

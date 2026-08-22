/**
 * Migration: 004 - Anchor Table
 * Description: Create anchor table for anchor system (3-slot structure)
 * Version: 4.0
 * Date: 2025-01-XX
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';
import { DependencyValidator } from '../dependency-validator.js';

/**
 * Anchor Table Migration
 * 
 * This migration:
 * 1. Creates anchor table for storing anchor state (agent_id, slot, memory_id)
 * 2. Creates indexes for performance optimization
 * 3. Supports multi-agent anchor management with 3-slot structure (A/B/C)
 */
export class AnchorTableMigration implements Migration {
  version = '4.0';
  name = 'anchor-table';
  description = 'Create anchor table for anchor system with 3-slot structure (A/B/C) for local memory retrieval';

  /**
   * Execute SQL script
   * Removes transaction commands (BEGIN TRANSACTION, COMMIT) as MigrationRunner manages transactions
   */
  private executeSQL(db: Database.Database, sql: string): void {
    // MigrationRunner가 트랜잭션을 관리하므로 SQL에서 트랜잭션 명령 제거
    let cleanedSQL = sql
      // BEGIN TRANSACTION 제거
      .replace(/BEGIN\s+TRANSACTION\s*;/gi, '')
      // COMMIT 제거
      .replace(/COMMIT\s*;/gi, '')
      // PRAGMA foreign_keys 명령은 유지 (트랜잭션 외부에서도 작동)
      .trim();
    
    // 빈 줄 제거 및 정리
    cleanedSQL = cleanedSQL
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');
    
    if (cleanedSQL.length > 0) {
      db.exec(cleanedSQL);
    }
  }

  /**
   * Check if table exists
   */
  private tableExists(db: Database.Database, tableName: string): boolean {
    const result = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name=?
    `).get(tableName);
    return !!result;
  }

  /**
   * Check if index exists
   */
  private indexExists(db: Database.Database, indexName: string): boolean {
    const result = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND name=?
    `).get(indexName);
    return !!result;
  }

  /**
   * Validate before migration
   */
  async validateBefore(db: Database.Database): Promise<void> {
    // Check if memory_item table exists (required for foreign key)
    if (!this.tableExists(db, 'memory_item')) {
      throw new Error('memory_item table does not exist. Cannot proceed with migration.');
    }

    // Check if migration has already been applied
    if (this.tableExists(db, 'memento_schema_version')) {
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = ?
      `).get('4.0') as { version: string } | undefined;
      
      if (version) {
        throw new Error('Migration 004 has already been applied. Current schema version: 4.0');
      }
    }

    // Check if anchor table already exists (should not exist)
    if (this.tableExists(db, 'anchor')) {
      throw new Error('anchor table already exists. Migration may have been partially applied.');
    }
  }

  /**
   * Execute migration (Up)
   */
  async up(db: Database.Database): Promise<void> {
    // 1. Create anchor table
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS anchor (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        slot TEXT CHECK (slot IN ('A', 'B', 'C')) NOT NULL,
        memory_id TEXT, -- NULL 허용 (메모리 삭제 시 SET NULL 적용)
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE SET NULL,
        UNIQUE(agent_id, slot)
      );
    `;
    this.executeSQL(db, createTableSQL);

    // 2. Create indexes
    const indexes = [
      'CREATE INDEX idx_anchor_agent_slot ON anchor(agent_id, slot);',
      'CREATE INDEX idx_anchor_memory_id ON anchor(memory_id) WHERE memory_id IS NOT NULL;',
      'CREATE INDEX idx_anchor_agent_memory ON anchor(agent_id, memory_id) WHERE memory_id IS NOT NULL;'
    ];

    for (const indexSQL of indexes) {
      this.executeSQL(db, indexSQL);
    }

    // Note: Schema version is recorded by MigrationRunner, not here
    // MigrationRunner.recordVersion() will be called after successful migration
  }

  /**
   * Rollback migration (Down)
   */
  async down(db: Database.Database): Promise<void> {
    // Drop indexes first
    const indexes = [
      'idx_anchor_agent_slot',
      'idx_anchor_memory_id',
      'idx_anchor_agent_memory'
    ];

    for (const indexName of indexes) {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    }

    // Drop anchor table
    db.exec('DROP TABLE IF EXISTS anchor');

    // Remove schema version record
    db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('4.0');
  }

  /**
   * Validate after migration
   */
  async validateAfter(db: Database.Database): Promise<void> {
    // Verify anchor table exists
    if (!this.tableExists(db, 'anchor')) {
      throw new Error('anchor table was not created');
    }

    // Verify indexes were created
    const requiredIndexes = [
      'idx_anchor_agent_slot',
      'idx_anchor_memory_id',
      'idx_anchor_agent_memory'
    ];
    for (const index of requiredIndexes) {
      if (!this.indexExists(db, index)) {
        throw new Error(`Index ${index} was not created`);
      }
    }

    // Verify table structure (check columns)
    const columns = db.prepare(`PRAGMA table_info(anchor)`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown }>;
    const columnNames = columns.map(col => col.name);
    
    const requiredColumns = ['id', 'agent_id', 'slot', 'memory_id', 'created_at', 'updated_at'];
    for (const column of requiredColumns) {
      if (!columnNames.includes(column)) {
        throw new Error(`Column ${column} was not created in anchor table`);
      }
    }

    // Verify UNIQUE constraint exists (check sqlite_master for unique index)
    const uniqueIndex = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='index' AND tbl_name='anchor' AND sql LIKE '%UNIQUE%'
    `).get() as { name: string } | undefined;
    
    if (!uniqueIndex) {
      // UNIQUE constraint might be in table definition, check table_info
      // SQLite stores UNIQUE constraints as indexes, so we check for unique index on (agent_id, slot)
      const uniqueCheck = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND tbl_name='anchor' 
        AND (name LIKE '%agent%' AND name LIKE '%slot%')
      `).get() as { name: string } | undefined;
      
      if (!uniqueCheck) {
        throw new Error('UNIQUE constraint on (agent_id, slot) was not created');
      }
    }

    // Verify foreign key constraint (check table_info for foreign key)
    // SQLite stores foreign keys in sqlite_master, but we can verify by checking the table structure
    const tableInfo = db.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='anchor'
    `).get() as { sql: string } | undefined;
    
    if (!tableInfo || !tableInfo.sql.includes('FOREIGN KEY') || !tableInfo.sql.includes('ON DELETE SET NULL')) {
      throw new Error('Foreign key constraint with ON DELETE SET NULL was not created');
    }

    // Verify existing dependencies are intact using DependencyValidator
    const dependencyReport = await DependencyValidator.validateAll(db);
    
    if (!dependencyReport.success) {
      const errors = dependencyReport.results
        .filter(r => !r.success)
        .map(r => `${r.name}: ${r.error}`)
        .join('; ');
      throw new Error(`Dependency validation failed: ${errors}`);
    }
  }
}


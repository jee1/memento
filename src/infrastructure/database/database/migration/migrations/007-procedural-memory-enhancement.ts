/**
 * Migration: 007 - Procedural Memory Enhancement
 * Description: Add workflow_name, skill_name, trigger_conditions fields to memory_item table and extend memory_link relation_type enum
 * Version: 7.0
 * Date: 2025-01-XX
 */

import type Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Migration } from '../types.js';
import { DependencyValidator } from '../dependency-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Procedural Memory Enhancement Migration
 * 
 * This migration:
 * 1. Adds workflow_name, skill_name, trigger_conditions fields to memory_item table
 * 2. Creates indexes for new fields (workflow_name, skill_name)
 * 3. Extends memory_link relation_type enum to include 'version_of' for version management
 */
export class ProceduralMemoryEnhancementMigration implements Migration {
  version = '7.0';
  name = 'procedural-memory-enhancement';
  description = 'Add workflow_name, skill_name, trigger_conditions fields to memory_item table and extend memory_link relation_type enum';

  /**
   * Load SQL file content
   */
  private loadSQLFile(filename: string): string {
    const filePath = join(__dirname, filename);
    return readFileSync(filePath, 'utf-8');
  }

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
   * Check if column exists in table
   */
  private columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return columns.some(col => col.name === columnName);
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
    // Check if memory_item table exists (required for ALTER TABLE)
    if (!this.tableExists(db, 'memory_item')) {
      throw new Error('memory_item table does not exist. Cannot proceed with migration.');
    }

    // Check if memory_link table exists (required for table recreation)
    if (!this.tableExists(db, 'memory_link')) {
      throw new Error('memory_link table does not exist. Cannot proceed with migration.');
    }

    // Check if migration has already been applied
    if (this.tableExists(db, 'memento_schema_version')) {
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = ?
      `).get('7.0') as { version: string } | undefined;
      
      if (version) {
        throw new Error('Migration 007 has already been applied. Current schema version: 7.0');
      }
    }

    // Check if new fields already exist (should not exist)
    if (this.columnExists(db, 'memory_item', 'workflow_name')) {
      throw new Error('workflow_name column already exists in memory_item table. Migration may have been partially applied.');
    }

    if (this.columnExists(db, 'memory_item', 'skill_name')) {
      throw new Error('skill_name column already exists in memory_item table. Migration may have been partially applied.');
    }

    if (this.columnExists(db, 'memory_item', 'trigger_conditions')) {
      throw new Error('trigger_conditions column already exists in memory_item table. Migration may have been partially applied.');
    }

    // Check if new indexes already exist (should not exist)
    if (this.indexExists(db, 'idx_memory_item_workflow_name')) {
      throw new Error('idx_memory_item_workflow_name index already exists. Migration may have been partially applied.');
    }

    if (this.indexExists(db, 'idx_memory_item_skill_name')) {
      throw new Error('idx_memory_item_skill_name index already exists. Migration may have been partially applied.');
    }

    // Check if memory_link table has 'version_of' in relation_type enum (should not exist)
    const tableInfo = db.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='memory_link'
    `).get() as { sql: string } | undefined;
    
    if (tableInfo && tableInfo.sql.includes("'version_of'")) {
      throw new Error("memory_link table already has 'version_of' in relation_type enum. Migration may have been partially applied.");
    }
  }

  /**
   * Execute migration (Up)
   */
  async up(db: Database.Database): Promise<void> {
    // Load and execute SQL script
    const sqlScript = this.loadSQLFile('007-procedural-memory-enhancement.sql');
    this.executeSQL(db, sqlScript);

    // Note: Schema version is recorded by MigrationRunner, not here
    // MigrationRunner.recordVersion() will be called after successful migration
  }

  /**
   * Rollback migration (Down)
   * 
   * Note: SQLite does not support ALTER TABLE DROP COLUMN directly (requires SQLite 3.35.0+).
   * For full rollback, table recreation would be required, which is complex.
   * This implementation provides a basic rollback that removes indexes and attempts to remove columns.
   */
  async down(db: Database.Database): Promise<void> {
    // Drop indexes first
    const indexes = [
      'idx_memory_item_workflow_name',
      'idx_memory_item_skill_name'
    ];

    for (const indexName of indexes) {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    }

    // Rollback memory_link table to original enum values
    // This requires table recreation, similar to the up migration
    if (this.tableExists(db, 'memory_link')) {
      // Step 1: Create temporary table with original enum values
      db.exec(`
        CREATE TABLE memory_link_rollback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          relation_type TEXT CHECK (relation_type IN ('cause_of', 'derived_from', 'duplicates', 'contradicts')) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
          FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
          UNIQUE(source_id, target_id, relation_type)
        )
      `);

      // Step 2: Copy data (excluding 'version_of' relations)
      db.exec(`
        INSERT INTO memory_link_rollback (id, source_id, target_id, relation_type, created_at)
        SELECT id, source_id, target_id, relation_type, created_at
        FROM memory_link
        WHERE relation_type != 'version_of'
      `);

      // Step 3: Drop old table
      db.exec('DROP TABLE memory_link');

      // Step 4: Rename rollback table
      db.exec('ALTER TABLE memory_link_rollback RENAME TO memory_link');

      // Step 5: Recreate indexes
      db.exec('CREATE INDEX IF NOT EXISTS idx_memory_link_source ON memory_link(source_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_memory_link_target ON memory_link(target_id)');
    }

    // Note: Removing columns from memory_item requires table recreation, which is complex.
    // For production use, consider using a new migration to remove columns if needed.
    // SQLite 3.35.0+ supports ALTER TABLE DROP COLUMN, but for compatibility, we skip it here.

    // Remove schema version record
    db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('7.0');
  }

  /**
   * Validate after migration
   */
  async validateAfter(db: Database.Database): Promise<void> {
    // Verify memory_item table has new columns
    if (!this.columnExists(db, 'memory_item', 'workflow_name')) {
      throw new Error('workflow_name column was not added to memory_item table');
    }

    if (!this.columnExists(db, 'memory_item', 'skill_name')) {
      throw new Error('skill_name column was not added to memory_item table');
    }

    if (!this.columnExists(db, 'memory_item', 'trigger_conditions')) {
      throw new Error('trigger_conditions column was not added to memory_item table');
    }

    // Verify indexes were created
    if (!this.indexExists(db, 'idx_memory_item_workflow_name')) {
      throw new Error('idx_memory_item_workflow_name index was not created');
    }

    if (!this.indexExists(db, 'idx_memory_item_skill_name')) {
      throw new Error('idx_memory_item_skill_name index was not created');
    }

    // Verify memory_link table has 'version_of' in relation_type enum
    const tableInfo = db.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='memory_link'
    `).get() as { sql: string } | undefined;
    
    if (!tableInfo) {
      throw new Error('memory_link table does not exist after migration');
    }

    if (!tableInfo.sql.includes("'version_of'")) {
      throw new Error("memory_link table does not have 'version_of' in relation_type enum");
    }

    // Verify memory_link table structure (check columns)
    const linkColumns = db.prepare(`PRAGMA table_info(memory_link)`).all() as Array<{
      name: string;
      type: string;
    }>;
    const linkColumnNames = linkColumns.map(col => col.name);
    
    const requiredLinkColumns = [
      'id',
      'source_id',
      'target_id',
      'relation_type',
      'created_at'
    ];
    for (const column of requiredLinkColumns) {
      if (!linkColumnNames.includes(column)) {
        throw new Error(`Column ${column} is missing in memory_link table`);
      }
    }

    // Verify memory_link indexes were recreated
    if (!this.indexExists(db, 'idx_memory_link_source')) {
      throw new Error('idx_memory_link_source index was not recreated');
    }

    if (!this.indexExists(db, 'idx_memory_link_target')) {
      throw new Error('idx_memory_link_target index was not recreated');
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


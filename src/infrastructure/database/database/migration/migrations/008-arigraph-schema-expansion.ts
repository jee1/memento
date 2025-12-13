/**
 * Migration: 008 - AriGraph Schema Expansion
 * Description: Add triple extraction fields to memory_item table for AriGraph pipeline
 * Version: 8.0
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
 * AriGraph Schema Expansion Migration
 * 
 * This migration:
 * 1. Adds subject, predicate, object columns to memory_item table (for semantic memory structural storage)
 * 2. Adds triple_extracted, triple_extracted_status, triple_extraction_metadata columns to memory_item table
 * 3. Creates indexes for triple extraction fields
 * 4. Inserts initial relation types (extracted_from, supported_by) into relation_type_registry
 */
export class AriGraphSchemaExpansionMigration implements Migration {
  version = '8.0';
  name = 'arigraph-schema-expansion';
  description = 'Add triple extraction fields to memory_item table for AriGraph pipeline';

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

    // Check if relation_type_registry table exists (required for INSERT)
    if (!this.tableExists(db, 'relation_type_registry')) {
      throw new Error('relation_type_registry table does not exist. Cannot proceed with migration.');
    }

    // Check if migration has already been applied
    if (this.tableExists(db, 'memento_schema_version')) {
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = ?
      `).get('8.0') as { version: string } | undefined;
      
      if (version) {
        throw new Error('Migration 008 has already been applied. Current schema version: 8.0');
      }
    }

    // Check if new columns already exist (should not exist)
    if (this.columnExists(db, 'memory_item', 'subject')) {
      throw new Error('subject column already exists in memory_item table. Migration may have been partially applied.');
    }

    if (this.columnExists(db, 'memory_item', 'predicate')) {
      throw new Error('predicate column already exists in memory_item table. Migration may have been partially applied.');
    }

    if (this.columnExists(db, 'memory_item', 'object')) {
      throw new Error('object column already exists in memory_item table. Migration may have been partially applied.');
    }

    if (this.columnExists(db, 'memory_item', 'triple_extracted')) {
      throw new Error('triple_extracted column already exists in memory_item table. Migration may have been partially applied.');
    }

    if (this.columnExists(db, 'memory_item', 'triple_extracted_status')) {
      throw new Error('triple_extracted_status column already exists in memory_item table. Migration may have been partially applied.');
    }

    if (this.columnExists(db, 'memory_item', 'triple_extraction_metadata')) {
      throw new Error('triple_extraction_metadata column already exists in memory_item table. Migration may have been partially applied.');
    }

    // Check if new indexes already exist (should not exist)
    if (this.indexExists(db, 'idx_memory_item_triple')) {
      throw new Error('idx_memory_item_triple index already exists. Migration may have been partially applied.');
    }

    if (this.indexExists(db, 'idx_memory_item_triple_extracted')) {
      throw new Error('idx_memory_item_triple_extracted index already exists. Migration may have been partially applied.');
    }

    if (this.indexExists(db, 'idx_memory_item_triple_status')) {
      throw new Error('idx_memory_item_triple_status index already exists. Migration may have been partially applied.');
    }

    // Check if relation types already exist (should not exist, but use INSERT OR IGNORE in SQL)
    const existingExtractedFrom = db.prepare(`
      SELECT type_name FROM relation_type_registry WHERE type_name = ?
    `).get('extracted_from') as { type_name: string } | undefined;

    const existingSupportedBy = db.prepare(`
      SELECT type_name FROM relation_type_registry WHERE type_name = ?
    `).get('supported_by') as { type_name: string } | undefined;

    // Note: We allow existing relation types (INSERT OR IGNORE in SQL), so we don't throw here
    // This allows the migration to be idempotent
  }

  /**
   * Execute migration (Up)
   */
  async up(db: Database.Database): Promise<void> {
    // Load and execute SQL script
    const sqlScript = this.loadSQLFile('008-arigraph-schema-expansion.sql');
    this.executeSQL(db, sqlScript);

    // Note: Schema version is recorded by MigrationRunner, not here
    // MigrationRunner.recordVersion() will be called after successful migration
  }

  /**
   * Rollback migration (Down)
   * 
   * Note: SQLite does not support ALTER TABLE DROP COLUMN directly (requires SQLite 3.35.0+).
   * For full rollback, table recreation would be required, which is complex.
   * This implementation provides a basic rollback that removes indexes.
   * Columns cannot be easily removed without table recreation.
   */
  async down(db: Database.Database): Promise<void> {
    // Drop indexes first
    const indexes = [
      'idx_memory_item_triple',
      'idx_memory_item_triple_extracted',
      'idx_memory_item_triple_status'
    ];

    for (const indexName of indexes) {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    }

    // Remove relation types from registry
    db.prepare('DELETE FROM relation_type_registry WHERE type_name = ?').run('extracted_from');
    db.prepare('DELETE FROM relation_type_registry WHERE type_name = ?').run('supported_by');

    // Note: Removing columns from memory_item requires table recreation, which is complex.
    // For production use, consider using a new migration to remove columns if needed.
    // SQLite 3.35.0+ supports ALTER TABLE DROP COLUMN, but for compatibility, we skip it here.

    // Remove schema version record
    db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('8.0');
  }

  /**
   * Validate after migration
   */
  async validateAfter(db: Database.Database): Promise<void> {
    // Verify memory_item table has new columns
    if (!this.columnExists(db, 'memory_item', 'subject')) {
      throw new Error('subject column was not added to memory_item table');
    }

    if (!this.columnExists(db, 'memory_item', 'predicate')) {
      throw new Error('predicate column was not added to memory_item table');
    }

    if (!this.columnExists(db, 'memory_item', 'object')) {
      throw new Error('object column was not added to memory_item table');
    }

    if (!this.columnExists(db, 'memory_item', 'triple_extracted')) {
      throw new Error('triple_extracted column was not added to memory_item table');
    }

    if (!this.columnExists(db, 'memory_item', 'triple_extracted_status')) {
      throw new Error('triple_extracted_status column was not added to memory_item table');
    }

    if (!this.columnExists(db, 'memory_item', 'triple_extraction_metadata')) {
      throw new Error('triple_extraction_metadata column was not added to memory_item table');
    }

    // Verify indexes were created
    if (!this.indexExists(db, 'idx_memory_item_triple')) {
      throw new Error('idx_memory_item_triple index was not created');
    }

    if (!this.indexExists(db, 'idx_memory_item_triple_extracted')) {
      throw new Error('idx_memory_item_triple_extracted index was not created');
    }

    if (!this.indexExists(db, 'idx_memory_item_triple_status')) {
      throw new Error('idx_memory_item_triple_status index was not created');
    }

    // Verify relation types were inserted (or already exist)
    const extractedFrom = db.prepare(`
      SELECT type_name FROM relation_type_registry WHERE type_name = ?
    `).get('extracted_from') as { type_name: string } | undefined;

    if (!extractedFrom) {
      throw new Error('extracted_from relation type was not inserted into relation_type_registry');
    }

    const supportedBy = db.prepare(`
      SELECT type_name FROM relation_type_registry WHERE type_name = ?
    `).get('supported_by') as { type_name: string } | undefined;

    if (!supportedBy) {
      throw new Error('supported_by relation type was not inserted into relation_type_registry');
    }

    // Verify relation type metadata
    const extractedFromInfo = db.prepare(`
      SELECT category, description FROM relation_type_registry WHERE type_name = ?
    `).get('extracted_from') as { category: string; description: string } | undefined;

    if (!extractedFromInfo || extractedFromInfo.category !== 'Structural') {
      throw new Error('extracted_from relation type has incorrect category or metadata');
    }

    const supportedByInfo = db.prepare(`
      SELECT category, description FROM relation_type_registry WHERE type_name = ?
    `).get('supported_by') as { category: string; description: string } | undefined;

    if (!supportedByInfo || supportedByInfo.category !== 'Structural') {
      throw new Error('supported_by relation type has incorrect category or metadata');
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


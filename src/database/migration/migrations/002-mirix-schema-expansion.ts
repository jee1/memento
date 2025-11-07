/**
 * Migration: 002 - MIRIX Schema Expansion
 * Description: Expand Memento schema to support MIRIX-based 5-memory architecture
 * Version: 002
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
 * MIRIX Schema Expansion Migration
 * 
 * This migration:
 * 1. Creates core_memory table for Core Memory
 * 2. Creates knowledge_vault table for Knowledge Vault
 * 3. Adds new fields to memory_item table (origin_source, task_goal, steps, reflection_notes)
 * 4. Creates memento_schema_version table for schema version tracking
 */
export class MirixSchemaExpansionMigration implements Migration {
  version = '002';
  name = 'mirix-schema-expansion';
  description = 'Expand Memento schema to support MIRIX-based 5-memory architecture (Core, Episodic, Semantic, Procedural, Vault)';

  /**
   * Load SQL file content
   */
  private loadSQLFile(filename: string): string {
    const filePath = join(__dirname, filename);
    return readFileSync(filePath, 'utf-8');
  }

  /**
   * Execute SQL script
   */
  private executeSQL(db: Database.Database, sql: string): void {
    db.exec(sql);
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
   * Validate before migration
   */
  async validateBefore(db: Database.Database): Promise<void> {
    // Check if memory_item table exists (required for migration)
    if (!this.tableExists(db, 'memory_item')) {
      throw new Error('memory_item table does not exist. Cannot proceed with migration.');
    }

    // Check if migration has already been applied
    if (this.tableExists(db, 'memento_schema_version')) {
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = ?
      `).get('2.0') as { version: string } | undefined;
      
      if (version) {
        throw new Error('Migration 002 has already been applied. Current schema version: 2.0');
      }
    }
  }

  /**
   * Execute migration (Up)
   */
  async up(db: Database.Database): Promise<void> {
    // 1. Create schema version table first (if not exists)
    const schemaVersionSQL = this.loadSQLFile('002-mirix-schema-expansion-schema-version.sql');
    this.executeSQL(db, schemaVersionSQL);

    // 2. Create core_memory table
    const coreMemorySQL = this.loadSQLFile('002-mirix-schema-expansion-core-memory.sql');
    this.executeSQL(db, coreMemorySQL);

    // 3. Create knowledge_vault table
    const knowledgeVaultSQL = this.loadSQLFile('002-mirix-schema-expansion-knowledge-vault.sql');
    this.executeSQL(db, knowledgeVaultSQL);

    // 4. Add new fields to memory_item table
    const memoryItemSQL = this.loadSQLFile('002-mirix-schema-expansion-memory-item.sql');
    this.executeSQL(db, memoryItemSQL);

    // 5. Record schema version
    db.prepare(`
      INSERT OR REPLACE INTO memento_schema_version 
      (version, migration_name, description, applied_by)
      VALUES (?, ?, ?, ?)
    `).run('2.0', this.name, this.description, 'system');
  }

  /**
   * Rollback migration (Down)
   */
  async down(db: Database.Database): Promise<void> {
    // Rollback in reverse order
    
    // 1. Remove new fields from memory_item table
    // Note: SQLite does not support DROP COLUMN directly, so we'll skip this
    // In production, this would require recreating the table
    
    // 2. Drop knowledge_vault table
    db.exec('DROP TABLE IF EXISTS knowledge_vault');
    
    // 3. Drop core_memory table
    db.exec('DROP TABLE IF EXISTS core_memory');
    
    // 4. Remove schema version record
    db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('2.0');
    
    // Note: We keep memento_schema_version table for future migrations
  }

  /**
   * Validate after migration
   */
  async validateAfter(db: Database.Database): Promise<void> {
    // Verify core_memory table exists
    if (!this.tableExists(db, 'core_memory')) {
      throw new Error('core_memory table was not created');
    }

    // Verify knowledge_vault table exists
    if (!this.tableExists(db, 'knowledge_vault')) {
      throw new Error('knowledge_vault table was not created');
    }

    // Verify memento_schema_version table exists
    if (!this.tableExists(db, 'memento_schema_version')) {
      throw new Error('memento_schema_version table was not created');
    }

    // Verify new columns in memory_item table
    const requiredColumns = ['origin_source', 'task_goal', 'steps', 'reflection_notes'];
    for (const column of requiredColumns) {
      if (!this.columnExists(db, 'memory_item', column)) {
        throw new Error(`Column ${column} was not added to memory_item table`);
      }
    }

    // Verify schema version was recorded
    const version = db.prepare(`
      SELECT version FROM memento_schema_version WHERE version = ?
    `).get('2.0') as { version: string } | undefined;
    
    if (!version) {
      throw new Error('Schema version 2.0 was not recorded');
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


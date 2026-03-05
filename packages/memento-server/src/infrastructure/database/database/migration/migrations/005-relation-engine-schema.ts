/**
 * Migration: 005 - Relation Engine Schema
 * Description: Create memory_relation and relation_type_registry tables for semantic relation engine
 * Version: 5.0
 * Date: 2025-01-XX
 */

import type Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Migration } from '../types.js';
import { DependencyValidator } from '../dependency-validator.js';
import { logger } from '../../../../../shared/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Relation Engine Schema Migration
 * 
 * This migration:
 * 1. Creates memory_relation table for storing semantic relations between memories
 * 2. Creates relation_type_registry table for managing relation types
 * 3. Creates indexes for performance optimization
 * 4. Inserts initial relation types (CAUSES, DEPENDS_ON, FOLLOWS, CONTRASTS_WITH, REFERENCES, BELONGS_TO)
 * 5. Migrates existing memory_link data to memory_relation
 */
export class RelationEngineSchemaMigration implements Migration {
  version = '5.0';
  name = 'relation-engine-schema';
  description = 'Create memory_relation and relation_type_registry tables for semantic relation engine';

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
   * Check if column exists in table
   */
  private columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return columns.some(col => col.name === columnName);
  }

  /**
   * Map old memory_link relation_type to new memory_relation relation_type
   */
  private mapRelationType(oldType: string): string | null {
    const mapping: Record<string, string> = {
      'cause_of': 'CAUSES',
      'derived_from': 'DEPENDS_ON',
      'contradicts': 'CONTRASTS_WITH'
      // 'duplicates'는 새로운 관계 유형으로 처리하지 않음 (제거)
    };
    return mapping[oldType] || null;
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
      `).get('5.0') as { version: string } | undefined;
      
      if (version) {
        throw new Error('Migration 005 has already been applied. Current schema version: 5.0');
      }
    }

    // Check if memory_relation table already exists (should not exist)
    if (this.tableExists(db, 'memory_relation')) {
      throw new Error('memory_relation table already exists. Migration may have been partially applied.');
    }

    // Check if relation_type_registry table already exists (should not exist)
    if (this.tableExists(db, 'relation_type_registry')) {
      throw new Error('relation_type_registry table already exists. Migration may have been partially applied.');
    }
  }

  /**
   * Execute migration (Up)
   */
  async up(db: Database.Database): Promise<void> {
    // 1. Load and execute SQL script
    const sqlScript = this.loadSQLFile('005-relation-engine-schema.sql');
    this.executeSQL(db, sqlScript);

    // 2. Migrate existing memory_link data to memory_relation
    if (this.tableExists(db, 'memory_link')) {
      const memoryLinks = db.prepare(`
        SELECT source_id, target_id, relation_type, created_at
        FROM memory_link
      `).all() as Array<{
        source_id: string;
        target_id: string;
        relation_type: string;
        created_at: string;
      }>;

      const insertStmt = db.prepare(`
        INSERT INTO memory_relation (source_id, target_id, relation_type, confidence, created_at, updated_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      let migratedCount = 0;
      for (const link of memoryLinks) {
        const newRelationType = this.mapRelationType(link.relation_type);
        
        // 매핑되지 않은 관계 유형은 건너뜀 (예: 'duplicates')
        if (!newRelationType) {
          continue;
        }

        // 기본 신뢰도는 0.7, 메타데이터에 마이그레이션 정보 추가
        const metadata = JSON.stringify({
          extraction_method: 'migration',
          migration_source: 'memory_link',
          original_relation_type: link.relation_type,
          migrated_at: new Date().toISOString()
        });

        try {
          insertStmt.run(
            link.source_id,
            link.target_id,
            newRelationType,
            0.7, // default confidence
            link.created_at,
            link.created_at, // updated_at = created_at initially
            metadata
          );
          migratedCount++;
        } catch (error) {
          // UNIQUE 제약 위반 시 무시 (이미 존재하는 관계)
          if (error instanceof Error && error.message.includes('UNIQUE')) {
            continue;
          }
          throw error;
        }
      }

      logger.info(`[Migration 005] Migrated ${migratedCount} relations from memory_link to memory_relation`);
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
      'idx_memory_relation_source',
      'idx_memory_relation_target',
      'idx_memory_relation_type',
      'idx_memory_relation_confidence',
      'idx_memory_relation_source_type',
      'idx_memory_relation_target_type',
      'idx_relation_type_registry_category'
    ];

    for (const indexName of indexes) {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    }

    // Drop tables
    db.exec('DROP TABLE IF EXISTS memory_relation');
    db.exec('DROP TABLE IF EXISTS relation_type_registry');

    // Remove schema version record
    db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('5.0');
  }

  /**
   * Validate after migration
   */
  async validateAfter(db: Database.Database): Promise<void> {
    // Verify memory_relation table exists
    if (!this.tableExists(db, 'memory_relation')) {
      throw new Error('memory_relation table was not created');
    }

    // Verify relation_type_registry table exists
    if (!this.tableExists(db, 'relation_type_registry')) {
      throw new Error('relation_type_registry table was not created');
    }

    // Verify memory_relation table structure (check columns)
    const relationColumns = db.prepare(`PRAGMA table_info(memory_relation)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: any;
    }>;
    const relationColumnNames = relationColumns.map(col => col.name);
    
    const requiredRelationColumns = [
      'id',
      'source_id',
      'target_id',
      'relation_type',
      'confidence',
      'created_at',
      'updated_at',
      'metadata'
    ];
    for (const column of requiredRelationColumns) {
      if (!relationColumnNames.includes(column)) {
        throw new Error(`Column ${column} was not created in memory_relation table`);
      }
    }

    // Verify relation_type_registry table structure (check columns)
    const registryColumns = db.prepare(`PRAGMA table_info(relation_type_registry)`).all() as Array<{
      name: string;
    }>;
    const registryColumnNames = registryColumns.map(col => col.name);
    
    const requiredRegistryColumns = [
      'type_name',
      'category',
      'description',
      'applicable_types',
      'default_confidence',
      'search_boost',
      'created_at'
    ];
    for (const column of requiredRegistryColumns) {
      if (!registryColumnNames.includes(column)) {
        throw new Error(`Column ${column} was not created in relation_type_registry table`);
      }
    }

    // Verify indexes were created
    const requiredIndexes = [
      'idx_memory_relation_source',
      'idx_memory_relation_target',
      'idx_memory_relation_type',
      'idx_memory_relation_confidence',
      'idx_memory_relation_source_type',
      'idx_memory_relation_target_type',
      'idx_relation_type_registry_category'
    ];
    for (const index of requiredIndexes) {
      if (!this.indexExists(db, index)) {
        throw new Error(`Index ${index} was not created`);
      }
    }

    // Verify initial relation types were inserted
    const relationTypes = db.prepare(`
      SELECT type_name FROM relation_type_registry
    `).all() as Array<{ type_name: string }>;
    
    const expectedTypes = ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'];
    const actualTypes = relationTypes.map(r => r.type_name);
    
    for (const expectedType of expectedTypes) {
      if (!actualTypes.includes(expectedType)) {
        throw new Error(`Relation type ${expectedType} was not inserted into registry`);
      }
    }

    // Verify UNIQUE constraint exists on memory_relation
    const uniqueCheck = db.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='memory_relation'
    `).get() as { sql: string } | undefined;
    
    if (!uniqueCheck || !uniqueCheck.sql.includes('UNIQUE(source_id, target_id, relation_type)')) {
      throw new Error('UNIQUE constraint on (source_id, target_id, relation_type) was not created');
    }

    // Verify foreign key constraints
    const tableInfo = db.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='memory_relation'
    `).get() as { sql: string } | undefined;
    
    if (!tableInfo || !tableInfo.sql.includes('FOREIGN KEY') || !tableInfo.sql.includes('ON DELETE CASCADE')) {
      throw new Error('Foreign key constraint with ON DELETE CASCADE was not created');
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

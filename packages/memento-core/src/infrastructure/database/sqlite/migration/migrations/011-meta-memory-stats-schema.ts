/**
 * Migration: 011 - Meta Memory Statistics Schema
 * Description: Create meta_memory_stats table for collecting recall statistics
 * Version: 11.0
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
 * Meta Memory Statistics Schema Migration
 * 
 * This migration:
 * 1. Creates meta_memory_stats table for tracking recall statistics
 * 2. Creates indexes for performance optimization
 * 3. Creates trigger for auto-updating updated_at timestamp
 */
export class MetaMemoryStatsSchemaMigration implements Migration {
  version = '11.0';
  name = 'meta-memory-stats-schema';
  description = 'Create meta_memory_stats table for collecting recall statistics (recall_count, success_count, failure_count, avg_confidence, etc.)';

  /**
   * Load SQL file content
   * @param filename SQL 파일명
   * @returns SQL 파일 내용
   * @throws {Error} 파일을 읽을 수 없을 때
   */
  private loadSQLFile(filename: string): string {
    try {
      const filePath = join(__dirname, filename);
      return readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to load SQL file: ${filename}. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute SQL script
   * Removes transaction commands (BEGIN TRANSACTION, COMMIT) as MigrationRunner manages transactions
   * @param db 데이터베이스 인스턴스
   * @param sql 실행할 SQL 스크립트
   * @throws {Error} SQL 실행 실패 시
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
      try {
        db.exec(cleanedSQL);
      } catch (error) {
        throw new Error(
          `Failed to execute SQL script: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Check if table exists
   * @param db 데이터베이스 인스턴스
   * @param tableName 확인할 테이블명
   * @returns 테이블 존재 여부
   */
  private tableExists(db: Database.Database, tableName: string): boolean {
    const result = db
      .prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name=?
      `)
      .get(tableName) as { name: string } | undefined;
    return !!result;
  }

  /**
   * Check if column exists in table
   * @param db 데이터베이스 인스턴스
   * @param tableName 확인할 테이블명
   * @param columnName 확인할 컬럼명
   * @returns 컬럼 존재 여부
   */
  private columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
    const columns = db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;
    return columns.some((col) => col.name === columnName);
  }

  /**
   * Check if index exists
   * @param db 데이터베이스 인스턴스
   * @param indexName 확인할 인덱스명
   * @returns 인덱스 존재 여부
   */
  private indexExists(db: Database.Database, indexName: string): boolean {
    const result = db
      .prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name=?
      `)
      .get(indexName) as { name: string } | undefined;
    return !!result;
  }

  /**
   * Check if trigger exists
   * @param db 데이터베이스 인스턴스
   * @param triggerName 확인할 트리거명
   * @returns 트리거 존재 여부
   */
  private triggerExists(db: Database.Database, triggerName: string): boolean {
    const result = db
      .prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='trigger' AND name=?
      `)
      .get(triggerName) as { name: string } | undefined;
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
      `).get('11.0') as { version: string } | undefined;
      
      if (version) {
        throw new Error('Migration 011 has already been applied. Current schema version: 11.0');
      }
    }

    // Check if meta_memory_stats table already exists (should not exist)
    if (this.tableExists(db, 'meta_memory_stats')) {
      throw new Error('meta_memory_stats table already exists. Migration may have been partially applied.');
    }
  }

  /**
   * Execute migration (Up)
   */
  async up(db: Database.Database): Promise<void> {
    // Load and execute SQL script
    const sqlScript = this.loadSQLFile('011-meta-memory-stats-schema.sql');
    this.executeSQL(db, sqlScript);

    // Note: Schema version is recorded by MigrationRunner, not here
    // MigrationRunner.recordVersion() will be called after successful migration
  }

  /**
   * Rollback migration (Down)
   * @param db 데이터베이스 인스턴스
   * @throws {Error} 롤백 실패 시
   */
  async down(db: Database.Database): Promise<void> {
    try {
      // Drop trigger first (트리거는 테이블 삭제 전에 제거해야 함)
      db.exec('DROP TRIGGER IF EXISTS trigger_meta_memory_stats_updated_at');

      // Drop indexes (인덱스는 테이블 삭제 전에 제거해야 함)
      const indexes = [
        'idx_meta_memory_stats_recall_count',
        'idx_meta_memory_stats_avg_confidence',
        'idx_meta_memory_stats_last_recalled_at',
        'idx_meta_memory_stats_failure_count'
      ];

      for (const indexName of indexes) {
        db.exec(`DROP INDEX IF EXISTS ${indexName}`);
      }

      // Drop table (CASCADE로 인해 관련 데이터도 자동 삭제됨)
      db.exec('DROP TABLE IF EXISTS meta_memory_stats');

      // Remove schema version record
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('11.0');
    } catch (error) {
      throw new Error(
        `Failed to rollback migration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Verify table structure (columns and primary key)
   * @param db 데이터베이스 인스턴스
   * @throws {Error} 검증 실패 시
   */
  private verifyTableStructure(db: Database.Database): void {
    // Verify meta_memory_stats table exists
    if (!this.tableExists(db, 'meta_memory_stats')) {
      throw new Error('meta_memory_stats table was not created');
    }

    // Verify all required columns exist
    const requiredColumns = [
      'memory_id',
      'recall_count',
      'success_count',
      'failure_count',
      'avg_confidence',
      'last_recalled_at',
      'created_at',
      'updated_at'
    ];
    for (const column of requiredColumns) {
      if (!this.columnExists(db, 'meta_memory_stats', column)) {
        throw new Error(`Column ${column} was not created in meta_memory_stats table`);
      }
    }

    // Verify memory_id is PRIMARY KEY
    const columns = db
      .prepare(`PRAGMA table_info(meta_memory_stats)`)
      .all() as Array<{ name: string; pk: number }>;
    const memoryIdCol = columns.find((col) => col.name === 'memory_id');
    if (!memoryIdCol || memoryIdCol.pk !== 1) {
      throw new Error('memory_id is not set as PRIMARY KEY');
    }
  }

  /**
   * Verify indexes and trigger
   * @param db 데이터베이스 인스턴스
   * @throws {Error} 검증 실패 시
   */
  private verifyIndexesAndTrigger(db: Database.Database): void {
    // Verify indexes were created
    const requiredIndexes = [
      'idx_meta_memory_stats_recall_count',
      'idx_meta_memory_stats_avg_confidence',
      'idx_meta_memory_stats_last_recalled_at',
      'idx_meta_memory_stats_failure_count'
    ];
    for (const index of requiredIndexes) {
      if (!this.indexExists(db, index)) {
        throw new Error(`Index ${index} was not created`);
      }
    }

    // Verify trigger was created
    if (!this.triggerExists(db, 'trigger_meta_memory_stats_updated_at')) {
      throw new Error('Trigger trigger_meta_memory_stats_updated_at was not created');
    }
  }

  /**
   * Verify foreign key constraint
   * @param db 데이터베이스 인스턴스
   * @throws {Error} 검증 실패 시
   */
  private verifyForeignKeyConstraint(db: Database.Database): void {
    const foreignKeys = db
      .prepare(`PRAGMA foreign_key_list(meta_memory_stats)`)
      .all() as Array<{ table: string; from: string; to: string; on_delete: string }>;

    if (foreignKeys.length === 0) {
      throw new Error('Foreign key constraint was not created');
    }

    const memoryIdFk = foreignKeys.find((fk) => fk.from === 'memory_id');
    if (!memoryIdFk) {
      throw new Error('Foreign key constraint on memory_id was not created');
    }

    if (memoryIdFk.table !== 'memory_item' || memoryIdFk.to !== 'id') {
      throw new Error('Foreign key constraint on memory_id does not reference memory_item(id)');
    }

    if (memoryIdFk.on_delete !== 'CASCADE') {
      throw new Error('Foreign key constraint on memory_id does not have ON DELETE CASCADE');
    }
  }

  /**
   * Validate after migration
   * @param db 데이터베이스 인스턴스
   * @throws {Error} 검증 실패 시
   */
  async validateAfter(db: Database.Database): Promise<void> {
    // Verify table structure
    this.verifyTableStructure(db);

    // Verify indexes and trigger
    this.verifyIndexesAndTrigger(db);

    // Verify foreign key constraint
    this.verifyForeignKeyConstraint(db);

    // Verify existing dependencies are intact using DependencyValidator
    const dependencyReport = await DependencyValidator.validateAll(db);

    if (!dependencyReport.success) {
      const errors = dependencyReport.results
        .filter((r) => !r.success)
        .map((r) => `${r.name}: ${r.error}`)
        .join('; ');
      throw new Error(`Dependency validation failed: ${errors}`);
    }
  }
}

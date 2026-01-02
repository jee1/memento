/**
 * Migration: 010 - Add Core Memory Version Column
 * Description: Add version column to core_memory table for cache invalidation
 * Version: 10.0
 * Date: 2025-12-25
 */

import type Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Migration } from '../types.js';
import { DependencyValidator } from '../dependency-validator.js';

/**
 * Add Core Memory Version Column Migration
 * 
 * This migration:
 * 1. Adds version column to core_memory table (INTEGER NOT NULL DEFAULT 0)
 * 2. Sets version = 1 for all existing rows
 * 3. Creates index on version column for efficient queries
 * 
 * Purpose:
 * - Enable version-based cache invalidation
 * - Track changes to core memory records
 * - Support distributed cache synchronization in the future
 */
export class AddCoreMemoryVersionMigration implements Migration {
  version = '10.0';
  name = 'add-core-memory-version';
  description = 'Add version column to core_memory table for cache invalidation';

  /**
   * Load SQL file content
   * 
   * 빌드 환경과 개발 환경 모두에서 작동하도록 import.meta.url을 사용합니다.
   * npx로 실행할 때도 올바른 경로를 찾을 수 있도록 현재 파일의 위치를 기준으로 합니다.
   */
  private loadSQLFile(filename: string): string {
    // import.meta.url을 사용하여 현재 파일의 디렉토리 경로 얻기
    // 빌드된 환경(.js)과 개발 환경(.ts) 모두에서 작동
    const currentFileUrl = import.meta.url;
    const currentFilePath = fileURLToPath(currentFileUrl);
    const currentDir = dirname(currentFilePath);
    const filePath = join(currentDir, filename);
    
    // 파일이 존재하지 않으면 상세한 에러 메시지 제공
    if (!existsSync(filePath)) {
      throw new Error(
        `Migration SQL file not found: ${filename}\n` +
        `Searched in: ${filePath}\n` +
        `Current file: ${currentFilePath}\n` +
        `Current dir: ${currentDir}\n` +
        `Please ensure the SQL file is copied to dist/ during build.`
      );
    }
    
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
   * Validate before migration
   */
  async validateBefore(db: Database.Database): Promise<void> {
    // Check if core_memory table exists (required dependency)
    if (!this.tableExists(db, 'core_memory')) {
      throw new Error('core_memory table does not exist. Please run migration 002 first.');
    }

    // Check if version column already exists (should not exist)
    if (this.columnExists(db, 'core_memory', 'version')) {
      throw new Error('version column already exists in core_memory table. Migration may have been already applied.');
    }

    // Note: DependencyValidator는 선택적으로 사용 (테스트 환경에서는 생략 가능)
    // 실제 마이그레이션 실행 시 MigrationRunner가 의존성을 관리함
  }

  /**
   * Execute migration (Up)
   */
  async up(db: Database.Database): Promise<void> {
    // Load and execute SQL script
    const sqlScript = this.loadSQLFile('010-add-core-memory-version.sql');
    this.executeSQL(db, sqlScript);

    // Note: Schema version is recorded by MigrationRunner, not here
    // MigrationRunner.recordVersion() will be called after successful migration
  }

  /**
   * Rollback migration (Down)
   */
  async down(db: Database.Database): Promise<void> {
    // Drop index first
    if (this.indexExists(db, 'idx_core_memory_version')) {
      db.exec('DROP INDEX IF EXISTS idx_core_memory_version');
    }

    // SQLite does not support DROP COLUMN directly, so we need to recreate the table
    // This is a simplified rollback - in production, you might want to preserve data
    // For now, we'll just remove the index and log a warning
    // Full rollback would require recreating the table without the version column
    
    // Note: SQLite does not support ALTER TABLE DROP COLUMN in older versions
    // For a complete rollback, we would need to:
    // 1. Create a new table without version column
    // 2. Copy data (excluding version)
    // 3. Drop old table
    // 4. Rename new table
    // This is complex and risky, so we'll just remove the index for now
    
    // Remove schema version record (if table exists)
    try {
      if (this.tableExists(db, 'memento_schema_version')) {
        db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('10.0');
      }
    } catch (error) {
      // 테이블이 없으면 무시 (테스트 환경 등)
    }
  }

  /**
   * Validate after migration
   */
  async validateAfter(db: Database.Database): Promise<void> {
    // Verify version column exists
    if (!this.columnExists(db, 'core_memory', 'version')) {
      throw new Error('version column was not created in core_memory table');
    }

    // Verify index exists
    if (!this.indexExists(db, 'idx_core_memory_version')) {
      throw new Error('idx_core_memory_version index was not created');
    }

    // Verify no rows have version = 0 (all existing rows should have version = 1)
    const zeroVersionCount = db.prepare(`
      SELECT COUNT(*) as count FROM core_memory WHERE version = 0
    `).get() as { count: number };
    
    if (zeroVersionCount.count > 0) {
      throw new Error(`Migration validation failed: ${zeroVersionCount.count} rows still have version = 0. All existing rows should have version = 1.`);
    }

    // Verify column type is INTEGER
    const columns = db.prepare(`PRAGMA table_info(core_memory)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>;
    
    const versionColumn = columns.find(col => col.name === 'version');
    if (!versionColumn) {
      throw new Error('version column not found in core_memory table');
    }
    
    if (!versionColumn.type.toUpperCase().includes('INTEGER')) {
      throw new Error(`version column type is ${versionColumn.type}, expected INTEGER`);
    }
    
    if (versionColumn.notnull !== 1) {
      throw new Error('version column should be NOT NULL');
    }
  }
}


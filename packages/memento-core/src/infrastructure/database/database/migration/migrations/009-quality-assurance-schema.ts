/**
 * Migration: 009 - Quality Assurance Schema
 * Description: Create quality measurement tables for quality assurance system
 * Version: 9.0
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
 * Quality Assurance Schema Migration
 * 
 * This migration:
 * 1. Creates quality_measurement_history table for tracking quality measurement history
 * 2. Creates quality_metrics table for storing latest quality metric values
 * 3. Creates quality_thresholds table for managing quality thresholds
 * 4. Creates indexes for efficient queries
 */
export class QualityAssuranceSchemaMigration implements Migration {
  version = '9.0';
  name = 'quality-assurance-schema';
  description = 'Create quality measurement tables for quality assurance system';

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
   * Validate before migration
   */
  async validateBefore(db: Database.Database): Promise<void> {
    // Check if migration has already been applied
    if (this.tableExists(db, 'memento_schema_version')) {
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = ?
      `).get('9.0') as { version: string } | undefined;
      
      if (version) {
        throw new Error('Migration 009 has already been applied. Current schema version: 9.0');
      }
    }

    // Check if quality_measurement_history table already exists (should not exist)
    if (this.tableExists(db, 'quality_measurement_history')) {
      throw new Error('quality_measurement_history table already exists. Migration may have been partially applied.');
    }

    // Check if quality_metrics table already exists (should not exist)
    if (this.tableExists(db, 'quality_metrics')) {
      throw new Error('quality_metrics table already exists. Migration may have been partially applied.');
    }

    // Check if quality_thresholds table already exists (should not exist)
    if (this.tableExists(db, 'quality_thresholds')) {
      throw new Error('quality_thresholds table already exists. Migration may have been partially applied.');
    }
  }

  /**
   * Execute migration (Up)
   */
  async up(db: Database.Database): Promise<void> {
    // Load and execute SQL script
    const sqlScript = this.loadSQLFile('009-quality-assurance-schema.sql');
    this.executeSQL(db, sqlScript);

    // Note: Schema version is recorded by MigrationRunner, not here
    // MigrationRunner.recordVersion() will be called after successful migration
  }

  /**
   * Rollback migration (Down)
   */
  async down(db: Database.Database): Promise<void> {
    // Drop indexes first
    const indexes = [
      'idx_quality_measurement_history_measured_at',
      'idx_quality_measurement_history_type',
      'idx_quality_measurement_history_status',
      'idx_quality_metrics_namespace_key',
      'idx_quality_metrics_context',
      'idx_quality_metrics_status',
      'idx_quality_metrics_measured_at',
      'idx_quality_thresholds_namespace_key',
      'idx_quality_thresholds_context'
    ];

    for (const indexName of indexes) {
      db.exec(`DROP INDEX IF EXISTS ${indexName}`);
    }

    // Drop tables
    db.exec('DROP TABLE IF EXISTS quality_measurement_history');
    db.exec('DROP TABLE IF EXISTS quality_metrics');
    db.exec('DROP TABLE IF EXISTS quality_thresholds');

    // Remove schema version record
    db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('9.0');
  }

  /**
   * Validate after migration
   */
  async validateAfter(db: Database.Database): Promise<void> {
    // Verify quality_measurement_history table exists
    if (!this.tableExists(db, 'quality_measurement_history')) {
      throw new Error('quality_measurement_history table was not created');
    }

    // Verify quality_metrics table exists
    if (!this.tableExists(db, 'quality_metrics')) {
      throw new Error('quality_metrics table was not created');
    }

    // Verify quality_thresholds table exists
    if (!this.tableExists(db, 'quality_thresholds')) {
      throw new Error('quality_thresholds table was not created');
    }

    // Verify quality_measurement_history table structure (check columns)
    const historyColumns = db.prepare(`PRAGMA table_info(quality_measurement_history)`).all() as Array<{
      name: string;
      type: string;
    }>;
    const historyColumnNames = historyColumns.map(col => col.name);
    
    const requiredHistoryColumns = [
      'id',
      'measurement_type',
      'measured_at',
      'metrics',
      'status',
      'warnings',
      'created_at'
    ];
    for (const column of requiredHistoryColumns) {
      if (!historyColumnNames.includes(column)) {
        throw new Error(`Column ${column} was not created in quality_measurement_history table`);
      }
    }

    // Verify quality_metrics table structure (check columns)
    const metricsColumns = db.prepare(`PRAGMA table_info(quality_metrics)`).all() as Array<{
      name: string;
      type: string;
    }>;
    const metricsColumnNames = metricsColumns.map(col => col.name);
    
    const requiredMetricsColumns = [
      'metric_namespace',
      'metric_key',
      'context',
      'metric_value',
      'measured_at',
      'status',
      'threshold_value',
      'updated_at'
    ];
    for (const column of requiredMetricsColumns) {
      if (!metricsColumnNames.includes(column)) {
        throw new Error(`Column ${column} was not created in quality_metrics table`);
      }
    }

    // Verify quality_thresholds table structure (check columns)
    const thresholdsColumns = db.prepare(`PRAGMA table_info(quality_thresholds)`).all() as Array<{
      name: string;
      type: string;
    }>;
    const thresholdsColumnNames = thresholdsColumns.map(col => col.name);
    
    const requiredThresholdsColumns = [
      'metric_namespace',
      'metric_key',
      'context',
      'threshold_value',
      'threshold_type',
      'description',
      'updated_at'
    ];
    for (const column of requiredThresholdsColumns) {
      if (!thresholdsColumnNames.includes(column)) {
        throw new Error(`Column ${column} was not created in quality_thresholds table`);
      }
    }

    // Verify indexes were created
    const requiredIndexes = [
      'idx_quality_measurement_history_measured_at',
      'idx_quality_measurement_history_type',
      'idx_quality_measurement_history_status',
      'idx_quality_metrics_namespace_key',
      'idx_quality_metrics_context',
      'idx_quality_metrics_status',
      'idx_quality_metrics_measured_at',
      'idx_quality_thresholds_namespace_key',
      'idx_quality_thresholds_context'
    ];
    for (const index of requiredIndexes) {
      if (!this.indexExists(db, index)) {
        throw new Error(`Index ${index} was not created`);
      }
    }

    // Verify PRIMARY KEY constraints
    const historyTableInfo = db.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='quality_measurement_history'
    `).get() as { sql: string } | undefined;
    
    if (!historyTableInfo || !historyTableInfo.sql.includes('PRIMARY KEY')) {
      throw new Error('PRIMARY KEY constraint was not created on quality_measurement_history table');
    }

    const metricsTableInfo = db.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='quality_metrics'
    `).get() as { sql: string } | undefined;
    
    if (!metricsTableInfo || !metricsTableInfo.sql.includes('PRIMARY KEY')) {
      throw new Error('PRIMARY KEY constraint was not created on quality_metrics table');
    }

    const thresholdsTableInfo = db.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='quality_thresholds'
    `).get() as { sql: string } | undefined;
    
    if (!thresholdsTableInfo || !thresholdsTableInfo.sql.includes('PRIMARY KEY')) {
      throw new Error('PRIMARY KEY constraint was not created on quality_thresholds table');
    }

    // Verify CHECK constraints
    if (!historyTableInfo.sql.includes('CHECK (measurement_type IN')) {
      throw new Error('CHECK constraint on measurement_type was not created in quality_measurement_history table');
    }

    if (!historyTableInfo.sql.includes('CHECK (status IN')) {
      throw new Error('CHECK constraint on status was not created in quality_measurement_history table');
    }

    if (!metricsTableInfo.sql.includes('CHECK (status IN')) {
      throw new Error('CHECK constraint on status was not created in quality_metrics table');
    }

    if (!thresholdsTableInfo.sql.includes('CHECK (threshold_type IN')) {
      throw new Error('CHECK constraint on threshold_type was not created in quality_thresholds table');
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


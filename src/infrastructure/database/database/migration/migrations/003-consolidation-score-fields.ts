/**
 * Migration: 003 - Consolidation Score Fields
 * Description: Add consolidation score system fields to memory_item table
 * Version: 3.0
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
 * Consolidation Score Fields Migration
 * 
 * This migration:
 * 1. Adds recall_count, last_accessed_at, consolidation_score, g_value fields to memory_item table
 * 2. Creates indexes for performance optimization
 * 3. Initializes existing data with default values
 */
export class ConsolidationScoreFieldsMigration implements Migration {
  version = '3.0';
  name = 'consolidation-score-fields';
  description = 'Add consolidation score system fields to memory_item table (recall_count, last_accessed_at, consolidation_score, g_value)';

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
  /**
   * Validate before migration
   */
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
      `).get('3.0') as { version: string } | undefined;
      
      if (version) {
        throw new Error('Migration 003 has already been applied. Current schema version: 3.0');
      }
    }

    // Check if migration is completely applied (all columns and indexes exist)
    // If completely applied, throw error to prevent re-running
    const requiredColumns = ['recall_count', 'last_accessed_at', 'consolidation_score', 'g_value'];
    const allColumnsExist = requiredColumns.every(col => this.columnExists(db, 'memory_item', col));
    
    const requiredIndexes = [
      'idx_memory_item_last_accessed',
      'idx_memory_item_consol_desc',
      'idx_memory_item_consol_active'
    ];
    const allIndexesExist = requiredIndexes.every(idx => this.indexExists(db, idx));
    
    // If all columns and indexes exist, migration is completely applied
    if (allColumnsExist && allIndexesExist) {
      throw new Error('Migration 003 appears to be completely applied. All required columns and indexes already exist.');
    }
    
    // Note: Partial application is allowed - if only some columns exist,
    // the up() method will skip adding existing columns and add missing ones.
  }

  /**
   * Calculate S(t) function: (1 - e^(-t)) / (1 + e^(-t))
   * @param t Time elapsed in hours
   */
  private calculateS(t: number): number {
    if (t <= 0) return 0;
    const expNegT = Math.exp(-t);
    return (1 - expNegT) / (1 + expNegT);
  }

  /**
   * Calculate consolidation score using Hou et al. normalized recall probability formula
   * p_n(t) = (1 - exp(-r * e^(-t/g_n))) / (1 - e^(-1))
   * 
   * @param recallCount n: number of recalls
   * @param timeElapsedHours t: time elapsed in hours
   * @param gValue g_n: current decay constant value
   * @param rBase r: initial recall probability constant (default 0.5)
   * @param pinned Whether the memory is pinned (minimum 0.25 if pinned)
   */
  private calculateConsolidationScore(
    recallCount: number,
    timeElapsedHours: number,
    gValue: number,
    rBase: number = 0.5,
    pinned: boolean = false
  ): number {
    // For n=1 (initial recall), g_0 = 1, so g_1 = 1 + S(t)
    const g_n = recallCount === 1 ? 1.0 + this.calculateS(timeElapsedHours) : gValue;
    
    if (g_n <= 0 || timeElapsedHours < 0) {
      return pinned ? 0.25 : 0.0;
    }

    // Calculate p_n(t) = (1 - exp(-r * e^(-t/g_n))) / (1 - e^(-1))
    const expNegTOverG = Math.exp(-timeElapsedHours / g_n);
    const numerator = 1 - Math.exp(-rBase * expNegTOverG);
    const denominator = 1 - Math.exp(-1);
    let score = numerator / denominator;

    // Clamp to 0.0 ~ 1.0 range
    score = Math.max(0.0, Math.min(1.0, score));

    // Pinned memories have minimum floor value of 0.25
    if (pinned && score < 0.25) {
      score = 0.25;
    }

    return score;
  }

  /**
   * Get r_base value based on memory type
   */
  private getRBaseForType(type: string): number {
    switch (type) {
      case 'procedural':
        return 0.6; // Procedural memory lasts longer
      case 'episodic':
      case 'semantic':
      default:
        return 0.5; // Default value
    }
  }

  /**
   * Execute migration (Up)
   */
  /**
   * Execute migration (Up)
   */
  async up(db: Database.Database): Promise<void> {
    // 1. Add columns conditionally (only if they don't exist)
    // SQLite does not support IF NOT EXISTS for ALTER TABLE ADD COLUMN,
    // so we check existence before adding each column
    
    if (!this.columnExists(db, 'memory_item', 'recall_count')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0');
    }
    
    if (!this.columnExists(db, 'memory_item', 'last_accessed_at')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN last_accessed_at TIMESTAMP');
    }
    
    if (!this.columnExists(db, 'memory_item', 'consolidation_score')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN consolidation_score REAL');
    }
    
    if (!this.columnExists(db, 'memory_item', 'g_value')) {
      db.exec('ALTER TABLE memory_item ADD COLUMN g_value REAL');
    }

    // 2. Create indexes (IF NOT EXISTS is supported for indexes)
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed ON memory_item(last_accessed_at DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_item_consol_desc ON memory_item(consolidation_score DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_memory_item_consol_active ON memory_item(consolidation_score) WHERE consolidation_score > 0.2');

    // 3. Initialize existing data
    // 기존 메모리는 recall_count=1, last_accessed_at=created_at, g_value=1로 초기화
    // consolidation_score는 Hou식 정규화 회상확률로 계산 (n=1, t=now-created_at, g_0=1)
    
    // 먼저 기본값 설정
    db.prepare(`
      UPDATE memory_item
      SET 
        recall_count = 1,
        last_accessed_at = created_at,
        g_value = 1.0
      WHERE recall_count IS NULL OR recall_count = 0
    `).run();

    // consolidation_score 계산
    // 각 메모리에 대해 타입별 r_base를 사용하여 점수 계산
    const memories = db.prepare(`
      SELECT id, type, created_at, pinned
      FROM memory_item
      WHERE consolidation_score IS NULL
    `).all() as Array<{ id: string; type: string; created_at: string; pinned: boolean | number }>;

    const now = Date.now();
    const updateStmt = db.prepare(`
      UPDATE memory_item
      SET consolidation_score = ?
      WHERE id = ?
    `);

    for (const memory of memories) {
      const createdTime = new Date(memory.created_at).getTime();
      const timeElapsedHours = (now - createdTime) / (1000 * 60 * 60); // Convert to hours
      
      const rBase = this.getRBaseForType(memory.type);
      // pinned는 SQLite에서 0/1 또는 boolean으로 저장될 수 있으므로 변환
      const isPinned = typeof memory.pinned === 'number' 
        ? memory.pinned === 1 
        : Boolean(memory.pinned);
      
      const score = this.calculateConsolidationScore(
        1, // recall_count = 1 (initial)
        timeElapsedHours,
        1.0, // g_0 = 1 (initial)
        rBase,
        isPinned
      );

      updateStmt.run(score, memory.id);
    }

    // Note: Schema version is recorded by MigrationRunner, not here
    // MigrationRunner.recordVersion() will be called after successful migration
  }

  /**
   * Rollback migration (Down)
   */
  async down(db: Database.Database): Promise<void> {
    // Note: SQLite does not support DROP COLUMN directly
    // In production, this would require recreating the table
    // For now, we'll drop the indexes and leave the columns (they won't cause issues)
    
    // Drop indexes
    db.exec('DROP INDEX IF EXISTS idx_memory_item_consol_active');
    db.exec('DROP INDEX IF EXISTS idx_memory_item_consol_desc');
    db.exec('DROP INDEX IF EXISTS idx_memory_item_last_accessed');

    // Note: Columns cannot be dropped in SQLite without recreating the table
    // This is a limitation of SQLite. In a production environment, you would need to:
    // 1. Create a new table without these columns
    // 2. Copy data from old table to new table
    // 3. Drop old table and rename new table
    // For now, we'll just remove the schema version record
    
    // Remove schema version record
    db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('3.0');
  }

  /**
   * Validate after migration
   */
  async validateAfter(db: Database.Database): Promise<void> {
    // Verify memory_item table still exists
    if (!this.tableExists(db, 'memory_item')) {
      throw new Error('memory_item table was removed during migration');
    }

    // Verify new columns were added
    const requiredColumns = ['recall_count', 'last_accessed_at', 'consolidation_score', 'g_value'];
    for (const column of requiredColumns) {
      if (!this.columnExists(db, 'memory_item', column)) {
        throw new Error(`Column ${column} was not added to memory_item table`);
      }
    }

    // Verify indexes were created
    const requiredIndexes = [
      'idx_memory_item_last_accessed',
      'idx_memory_item_consol_desc',
      'idx_memory_item_consol_active'
    ];
    for (const index of requiredIndexes) {
      if (!this.indexExists(db, index)) {
        throw new Error(`Index ${index} was not created`);
      }
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


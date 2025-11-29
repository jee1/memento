/**
 * Migration: 006 - FTS5 Reflection Notes Column
 * Description: Create new FTS5 table (memory_item_fts_new) with reflection_notes column for Zero-Downtime migration
 * Version: 6.0
 * Date: 2025-01-XX
 * 
 * This migration implements Step 1 of the Zero-Downtime migration strategy:
 * - Creates memory_item_fts_new table with reflection_notes column
 * - Does NOT re-index existing data (handled in Step 2)
 * - Does NOT create triggers (handled in Step 3)
 * - Does NOT replace tables (handled in Step 4)
 * 
 * See docs/architecture/zero-downtime-fts5-migration.md for full migration strategy.
 */

import type Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Migration } from '../types.js';
import { DependencyValidator } from '../dependency-validator.js';
import { normalizeReflectionNotes } from '../../../../shared/utils/reflection-notes-normalize.js';
import {
  initializeMigrationStatusTable,
  setMigrationStatus,
  getMigrationStatus
} from '../../../../shared/utils/fts5-migration-status.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * FTS5 Reflection Notes Migration (Step 1: New Table Creation)
 * 
 * This migration:
 * 1. Creates memory_item_fts_new virtual table with reflection_notes column
 * 2. Validates table creation
 * 3. Does NOT re-index existing data (handled separately)
 * 4. Does NOT create triggers (handled separately)
 */
export class FTS5ReflectionNotesMigration implements Migration {
  version = '6.0';
  name = 'fts5-reflection-notes';
  description = 'Create new FTS5 table (memory_item_fts_new) with reflection_notes column for Zero-Downtime migration';

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
   * Check if virtual table exists
   */
  private virtualTableExists(db: Database.Database, tableName: string): boolean {
    const result = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name=?
    `).get(tableName);
    return !!result;
  }

  /**
   * Validate before migration
   */
  async validateBefore(db: Database.Database): Promise<void> {
    // Check if memory_item table exists (required for content table reference)
    const memoryItemExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name=?
    `).get('memory_item');
    
    if (!memoryItemExists) {
      throw new Error('memory_item table does not exist. Cannot proceed with migration.');
    }

    // Check if migration has already been applied
    if (this.virtualTableExists(db, 'memento_schema_version')) {
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = ?
      `).get('6.0') as { version: string } | undefined;
      
      if (version) {
        throw new Error('Migration 006 has already been applied. Current schema version: 6.0');
      }
    }

    // Check if memory_item_fts_new table already exists (should not exist)
    if (this.virtualTableExists(db, 'memory_item_fts_new')) {
      throw new Error('memory_item_fts_new table already exists. Migration may have been partially applied.');
    }

    // Check if FTS5 is available
    try {
      db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS test_fts5 USING fts5(content)');
      db.exec('DROP TABLE IF EXISTS test_fts5');
    } catch (error) {
      throw new Error('FTS5 is not available. Cannot proceed with migration.');
    }
  }

  /**
   * Re-index existing data from memory_item to memory_item_fts_new
   * 
   * This implements Step 2 of the Zero-Downtime migration strategy:
   * - Processes data in batches (1000 records per batch)
   * - Normalizes reflection_notes using normalizeReflectionNotes utility
   * - Commits each batch separately for performance and safety
   * - Logs progress every 10%
   */
  private async reindexExistingData(db: Database.Database): Promise<void> {
    const BATCH_SIZE = 1000;
    const BATCH_DELAY_MS = 10;
    
    // Get total record count
    const totalCount = db.prepare(`
      SELECT COUNT(*) as count FROM memory_item
    `).get() as { count: number };
    
    const totalRecords = totalCount.count;
    
    if (totalRecords === 0) {
      // stderr로 로그 출력 (MCP 프로토콜 준수)
      process.stderr.write('[Migration 006] No records to re-index\n');
      return;
    }

    // stderr로 로그 출력 (MCP 프로토콜 준수)
    process.stderr.write(`[Migration 006] Starting re-indexing: ${totalRecords} records\n`);
    
    let processedCount = 0;
    let offset = 0;
    let lastLoggedPercent = -1;

    // Prepare statements
    const selectStmt = db.prepare(`
      SELECT rowid, content, tags, source, reflection_notes
      FROM memory_item
      ORDER BY rowid
      LIMIT ? OFFSET ?
    `);

    const insertStmt = db.prepare(`
      INSERT INTO memory_item_fts_new(rowid, content, tags, source, reflection_notes)
      VALUES (?, ?, ?, ?, ?)
    `);

    // Process in batches
    // Note: MigrationRunner가 이미 트랜잭션을 관리하므로 중첩 트랜잭션을 사용하지 않음
    // 모든 배치 처리는 MigrationRunner의 단일 트랜잭션 내에서 실행됨
    while (offset < totalRecords) {
      try {
        // Fetch batch
        const batch = selectStmt.all(BATCH_SIZE, offset) as Array<{
          rowid: number;
          content: string;
          tags: string | null;
          source: string | null;
          reflection_notes: string | null;
        }>;

        if (batch.length === 0) {
          break;
        }

        // Insert each record with normalized reflection_notes
        for (const record of batch) {
          // Normalize reflection_notes for FTS5 indexing
          const normalizedReflectionNotes = normalizeReflectionNotes(record.reflection_notes);
          
          insertStmt.run(
            record.rowid,
            record.content,
            record.tags,
            record.source,
            normalizedReflectionNotes || null  // Empty string becomes null
          );
        }
        
        processedCount += batch.length;
        offset += BATCH_SIZE;

        // Log progress every 10%
        const currentPercent = Math.floor((processedCount / totalRecords) * 100);
        if (currentPercent >= lastLoggedPercent + 10 || processedCount === totalRecords) {
          // stderr로 로그 출력 (MCP 프로토콜 준수)
          process.stderr.write(`[Migration 006] Re-indexing progress: ${processedCount}/${totalRecords} (${currentPercent}%)\n`);
          lastLoggedPercent = currentPercent;
        }

        // Delay between batches to minimize impact on other operations
        if (offset < totalRecords) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      } catch (error) {
        // MigrationRunner가 트랜잭션을 관리하므로 여기서는 에러만 전파
        throw new Error(
          `Re-indexing failed at batch starting at offset ${offset}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // stderr로 로그 출력 (MCP 프로토콜 준수)
    process.stderr.write(`[Migration 006] Re-indexing completed: ${processedCount} records\n`);
  }

  /**
   * Create temporary dual triggers for synchronizing new writes during migration
   * 
   * This implements Step 3 of the Zero-Downtime migration strategy:
   * - Creates temporary triggers that insert into memory_item_fts_new
   * - Existing triggers continue to insert into memory_item_fts
   * - Both tables are kept in sync during migration
   * 
   * Duplicate Insert Prevention:
   * - FTS5 automatically handles duplicate rowid inserts (updates existing record)
   * - Triggers fire only once per INSERT/UPDATE/DELETE event, so duplicates are unlikely
   * - Transaction-level duplicate prevention is handled at application level
   * 
   * Note: reflection_notes normalization is applied using normalize_reflection_notes function.
   */
  private createDualTriggers(db: Database.Database): void {
    // stderr로 로그 출력 (MCP 프로토콜 준수)
    process.stderr.write('[Migration 006] Creating temporary dual triggers...\n');

    // Register normalize_reflection_notes function before creating triggers
    this.registerNormalizeFunction(db);

    // INSERT trigger: Insert new records into memory_item_fts_new with normalization
    // FTS5 automatically handles duplicate rowid: if rowid exists, it updates the record
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_item_fts_insert_new AFTER INSERT ON memory_item BEGIN
        INSERT INTO memory_item_fts_new(rowid, content, tags, source, reflection_notes)
        VALUES (new.rowid, new.content, new.tags, new.source, normalize_reflection_notes(new.reflection_notes));
      END
    `);

    // UPDATE trigger: Update records in memory_item_fts_new with normalization
    // Delete old record first, then insert new record
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_item_fts_update_new AFTER UPDATE ON memory_item BEGIN
        -- Delete old record
        INSERT INTO memory_item_fts_new(memory_item_fts_new, rowid, content, tags, source, reflection_notes)
        VALUES('delete', old.rowid, old.content, old.tags, old.source, normalize_reflection_notes(old.reflection_notes));
        -- Insert new record
        INSERT INTO memory_item_fts_new(rowid, content, tags, source, reflection_notes)
        VALUES (new.rowid, new.content, new.tags, new.source, normalize_reflection_notes(new.reflection_notes));
      END
    `);

    // DELETE trigger: Delete records from memory_item_fts_new with normalization
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_item_fts_delete_new AFTER DELETE ON memory_item BEGIN
        INSERT INTO memory_item_fts_new(memory_item_fts_new, rowid, content, tags, source, reflection_notes)
        VALUES('delete', old.rowid, old.content, old.tags, old.source, normalize_reflection_notes(old.reflection_notes));
      END
    `);

    // stderr로 로그 출력 (MCP 프로토콜 준수)
    process.stderr.write('[Migration 006] Temporary dual triggers created\n');
  }

  /**
   * Drop temporary dual triggers
   * Used for rollback or cleanup
   */
  private dropDualTriggers(db: Database.Database): void {
    db.exec('DROP TRIGGER IF EXISTS memory_item_fts_insert_new');
    db.exec('DROP TRIGGER IF EXISTS memory_item_fts_update_new');
    db.exec('DROP TRIGGER IF EXISTS memory_item_fts_delete_new');
  }

  /**
   * Check if trigger exists
   */
  private triggerExists(db: Database.Database, triggerName: string): boolean {
    const result = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='trigger' AND name=?
    `).get(triggerName);
    return !!result;
  }

  /**
   * Register normalize_reflection_notes user-defined function
   * This function must be registered before triggers that use it
   * 
   * Note: SQLite does not support dropping user-defined functions directly.
   * If the function already exists and is in use by active statements,
   * registering it again will fail with "unable to delete/modify user-function due to active statements".
   * 
   * To avoid this, we check if the function is already registered and skip re-registration.
   */
  private functionRegistered = false;

  private registerNormalizeFunction(db: Database.Database): void {
    // 함수가 이미 등록되어 있으면 재등록하지 않음 (active statements 에러 방지)
    if (this.functionRegistered) {
      return;
    }

    try {
      db.function('normalize_reflection_notes', {
        deterministic: true,
        varargs: false
      }, (reflectionNotes: string | null) => {
        return normalizeReflectionNotes(reflectionNotes);
      });
      this.functionRegistered = true;
    } catch (error) {
      // 함수 등록 실패 시 에러를 다시 던짐 (마이그레이션 실패 처리)
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('active statements')) {
        // prepared statement가 활성화되어 있는 경우
        // 함수가 이미 등록되어 있다고 가정하고 계속 진행
        process.stderr.write(`⚠️ 함수 등록 스킵 (이미 등록됨 또는 active statements): ${errorMessage}\n`);
        this.functionRegistered = true; // 재시도 방지
        return;
      }
      throw error;
    }
  }

  /**
   * Perform atomic table replacement
   * 
   * This implements Step 4 of the Zero-Downtime migration strategy:
   * - Drops existing triggers
   * - Drops temporary dual triggers
   * - Drops existing FTS5 table
   * - Renames new table to original name
   * - Creates new triggers with reflection_notes support and normalization
   * 
   * All operations are performed in a single transaction for atomicity.
   */
  private performAtomicTableReplacement(db: Database.Database): void {
    // stderr로 로그 출력 (MCP 프로토콜 준수)
    process.stderr.write('[Migration 006] Performing atomic table replacement...\n');

    // Register normalize_reflection_notes function before creating triggers
    this.registerNormalizeFunction(db);

    // MigrationRunner가 트랜잭션을 관리하므로 여기서는 트랜잭션을 시작하지 않음
    // All operations are performed within the existing transaction managed by MigrationRunner

    // 1. Drop existing triggers
    db.exec('DROP TRIGGER IF EXISTS memory_item_fts_insert');
    db.exec('DROP TRIGGER IF EXISTS memory_item_fts_update');
    db.exec('DROP TRIGGER IF EXISTS memory_item_fts_delete');

    // 2. Drop temporary dual triggers
    this.dropDualTriggers(db);

    // 3. Drop existing FTS5 table
    db.exec('DROP TABLE IF EXISTS memory_item_fts');

    // 4. Rename new table to original name
    db.exec('ALTER TABLE memory_item_fts_new RENAME TO memory_item_fts');

    // 5. Create new triggers with reflection_notes support and normalization
    // Note: normalize_reflection_notes function must be registered before this migration
    db.exec(`
      CREATE TRIGGER memory_item_fts_insert AFTER INSERT ON memory_item BEGIN
        INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
        VALUES (new.rowid, new.content, new.tags, new.source, normalize_reflection_notes(new.reflection_notes));
      END
    `);

    db.exec(`
      CREATE TRIGGER memory_item_fts_update AFTER UPDATE ON memory_item BEGIN
        INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
        VALUES('delete', old.rowid, old.content, old.tags, old.source, normalize_reflection_notes(old.reflection_notes));
        INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
        VALUES (new.rowid, new.content, new.tags, new.source, normalize_reflection_notes(new.reflection_notes));
      END
    `);

    db.exec(`
      CREATE TRIGGER memory_item_fts_delete AFTER DELETE ON memory_item BEGIN
        INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
        VALUES('delete', old.rowid, old.content, old.tags, old.source, normalize_reflection_notes(old.reflection_notes));
      END
    `);

    // stderr로 로그 출력 (MCP 프로토콜 준수)
    process.stderr.write('[Migration 006] Atomic table replacement completed\n');
  }

  /**
   * Execute migration (Up)
   */
  async up(db: Database.Database): Promise<void> {
    // Initialize migration status table
    initializeMigrationStatusTable(db);

    // Update status to 'in_progress'
    setMigrationStatus(db, 'in_progress');

    try {
      // Step 1: Load and execute SQL script (create new table)
      const sqlScript = this.loadSQLFile('006-fts5-reflection-notes.sql');
      this.executeSQL(db, sqlScript);

      // Step 2: Re-index existing data
      await this.reindexExistingData(db);

      // Step 3: Create temporary dual triggers
      this.createDualTriggers(db);

      // Step 4: Perform atomic table replacement
      this.performAtomicTableReplacement(db);

      // Update status to 'completed'
      setMigrationStatus(db, 'completed');

      // Note: Schema version is recorded by MigrationRunner, not here
      // MigrationRunner.recordVersion() will be called after successful migration
      // 
      // Note: This migration implements Steps 1, 2, 3, and 4 of the Zero-Downtime migration strategy.
      // Trigger update with reflection_notes normalization (Step 3.8) is handled separately.
    } catch (error) {
      // Update status to 'failed' on error
      setMigrationStatus(
        db,
        'failed',
        error instanceof Error ? error.message : String(error)
      );
      throw error; // Re-throw to trigger rollback
    }
  }

  /**
   * Rollback migration (Down)
   */
  async down(db: Database.Database): Promise<void> {
    // Drop temporary dual triggers
    this.dropDualTriggers(db);

    // Drop the new FTS5 table
    db.exec('DROP TABLE IF EXISTS memory_item_fts_new');

    // Update status to 'pending' (재시도 가능하도록)
    try {
      setMigrationStatus(db, 'pending');
    } catch (error) {
      // 상태 업데이트 실패는 무시 (롤백은 계속 진행)
      // stderr로 로그 출력 (MCP 프로토콜 준수)
      process.stderr.write(`⚠️ 마이그레이션 상태 롤백 실패: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // Remove schema version record
    db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('6.0');
  }

  /**
   * Validate after migration
   */
  async validateAfter(db: Database.Database): Promise<void> {
    // After atomic table replacement, memory_item_fts_new should not exist
    // and memory_item_fts should exist with reflection_notes column
    
    // Verify memory_item_fts table exists (renamed from memory_item_fts_new)
    if (!this.virtualTableExists(db, 'memory_item_fts')) {
      throw new Error('memory_item_fts table was not created or renamed');
    }

    // Verify memory_item_fts_new table does not exist (should be renamed)
    if (this.virtualTableExists(db, 'memory_item_fts_new')) {
      throw new Error('memory_item_fts_new table still exists (should be renamed to memory_item_fts)');
    }

    // Verify table structure by checking if it's a virtual table
    const tableInfo = db.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='memory_item_fts'
    `).get() as { sql: string } | undefined;
    
    if (!tableInfo) {
      throw new Error('memory_item_fts table information not found');
    }

    // Verify reflection_notes column is included in the table definition
    if (!tableInfo.sql.includes('reflection_notes')) {
      throw new Error('reflection_notes column was not included in memory_item_fts table');
    }

    // Verify content table reference
    if (!tableInfo.sql.includes("content='memory_item'")) {
      throw new Error("content table reference 'memory_item' was not found in memory_item_fts table");
    }

    // Verify content_rowid reference
    if (!tableInfo.sql.includes("content_rowid='rowid'")) {
      throw new Error("content_rowid='rowid' was not found in memory_item_fts table");
    }

    // Verify new triggers were created (temporary dual triggers should be removed)
    const requiredTriggers = [
      'memory_item_fts_insert',
      'memory_item_fts_update',
      'memory_item_fts_delete'
    ];
    for (const triggerName of requiredTriggers) {
      if (!this.triggerExists(db, triggerName)) {
        throw new Error(`New trigger ${triggerName} was not created`);
      }
    }

    // Verify temporary dual triggers were removed
    const temporaryTriggers = [
      'memory_item_fts_insert_new',
      'memory_item_fts_update_new',
      'memory_item_fts_delete_new'
    ];
    for (const triggerName of temporaryTriggers) {
      if (this.triggerExists(db, triggerName)) {
        throw new Error(`Temporary dual trigger ${triggerName} still exists (should be removed)`);
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


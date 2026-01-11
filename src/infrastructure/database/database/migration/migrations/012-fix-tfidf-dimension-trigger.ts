/**
 * Migration: 012 - Fix TF-IDF Dimension Trigger
 * Description: Fix memory_embedding_vec_insert and memory_embedding_vec_update triggers
 *              to use dimensions = 512 for TF-IDF instead of 384
 * Version: 12.0
 * Date: 2025-01-11
 * 
 * 왜 필요한가?
 * - TF-IDF 임베딩은 512차원을 생성하지만, 트리거에서 dimensions = 384로 검사하여
 *   memory_item_vec_tfidf 테이블(512차원)에 삽입되지 않음
 * - 결과적으로 검색 시 차원 불일치 오류 발생
 * - 이 마이그레이션은 트리거를 재생성하여 TF-IDF 차원 조건을 384에서 512로 수정
 */

import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

/**
 * Fix TF-IDF Dimension Trigger Migration
 * 
 * This migration:
 * 1. Drops existing memory_embedding_vec_insert and memory_embedding_vec_update triggers
 * 2. Recreates them with correct dimension condition (512 for TF-IDF)
 */
export class FixTfidfDimensionTriggerMigration implements Migration {
  version = '12.0';
  name = 'fix-tfidf-dimension-trigger';
  description = 'Fix memory_embedding_vec_insert and memory_embedding_vec_update triggers to use dimensions = 512 for TF-IDF instead of 384';

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
   * Validate before migration
   */
  async validateBefore(db: Database.Database): Promise<void> {
    // Check if memory_embedding table exists (required for triggers)
    if (!this.tableExists(db, 'memory_embedding')) {
      throw new Error('memory_embedding table does not exist. Cannot proceed with migration.');
    }

    // Check if memory_item_vec_tfidf table exists (required for triggers)
    if (!this.tableExists(db, 'memory_item_vec_tfidf')) {
      throw new Error('memory_item_vec_tfidf table does not exist. Cannot proceed with migration.');
    }

    // Check if migration has already been applied
    if (this.tableExists(db, 'memento_schema_version')) {
      const version = db.prepare(`
        SELECT version FROM memento_schema_version WHERE version = ?
      `).get('12.0') as { version: string } | undefined;
      
      if (version) {
        throw new Error('Migration 012 has already been applied. Current schema version: 12.0');
      }
    }

    // Note: Dependency validation is handled by MigrationRunner automatically
    // MigrationRunner checks dependencies based on the version array in detectPendingMigrations
  }

  /**
   * Execute migration (Up)
   */
  async up(db: Database.Database): Promise<void> {
    // Drop existing triggers
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_insert');
    db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_update');

    // Recreate memory_embedding_vec_insert trigger with correct TF-IDF dimension (512)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_insert AFTER INSERT ON memory_embedding BEGIN
        INSERT INTO memory_item_vec(rowid, embedding) 
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.dimensions = 384;
        
        INSERT INTO memory_item_vec_tfidf(rowid, embedding) 
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'tfidf' AND NEW.dimensions = 512 AND NEW.projection_type = 'native';
        
        INSERT INTO memory_item_vec_minilm(rowid, embedding) 
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'minilm' AND NEW.dimensions = 384 AND NEW.projection_type = 'native';
        
        INSERT INTO memory_item_vec_openai(rowid, embedding) 
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'openai' AND NEW.dimensions = 1536 AND NEW.projection_type = 'native';
        
        INSERT INTO memory_item_vec_gemini(rowid, embedding) 
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'gemini' AND NEW.dimensions = 768 AND NEW.projection_type = 'native';
      END
    `);

    // Recreate memory_embedding_vec_update trigger with correct TF-IDF dimension (512)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_update AFTER UPDATE ON memory_embedding BEGIN
        DELETE FROM memory_item_vec WHERE rowid = NEW.id;
        DELETE FROM memory_item_vec_tfidf WHERE rowid = NEW.id;
        DELETE FROM memory_item_vec_minilm WHERE rowid = NEW.id;
        DELETE FROM memory_item_vec_openai WHERE rowid = NEW.id;
        DELETE FROM memory_item_vec_gemini WHERE rowid = NEW.id;

        INSERT INTO memory_item_vec(rowid, embedding) 
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.dimensions = 384;
        
        INSERT INTO memory_item_vec_tfidf(rowid, embedding) 
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'tfidf' AND NEW.dimensions = 512 AND NEW.projection_type = 'native';
        
        INSERT INTO memory_item_vec_minilm(rowid, embedding) 
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'minilm' AND NEW.dimensions = 384 AND NEW.projection_type = 'native';
        
        INSERT INTO memory_item_vec_openai(rowid, embedding) 
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'openai' AND NEW.dimensions = 1536 AND NEW.projection_type = 'native';
        
        INSERT INTO memory_item_vec_gemini(rowid, embedding) 
        SELECT NEW.id, json_extract(NEW.embedding, '$')
        WHERE NEW.embedding_provider = 'gemini' AND NEW.dimensions = 768 AND NEW.projection_type = 'native';
      END
    `);

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
      // Drop triggers
      db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_insert');
      db.exec('DROP TRIGGER IF EXISTS memory_embedding_vec_update');

      // Recreate triggers with old dimension condition (384 for TF-IDF)
      // Note: This restores the buggy behavior, but allows rollback
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_insert AFTER INSERT ON memory_embedding BEGIN
          INSERT INTO memory_item_vec(rowid, embedding) 
          SELECT NEW.id, json_extract(NEW.embedding, '$')
          WHERE NEW.dimensions = 384;
          
          INSERT INTO memory_item_vec_tfidf(rowid, embedding) 
          SELECT NEW.id, json_extract(NEW.embedding, '$')
          WHERE NEW.embedding_provider = 'tfidf' AND NEW.dimensions = 384 AND NEW.projection_type = 'native';
          
          INSERT INTO memory_item_vec_minilm(rowid, embedding) 
          SELECT NEW.id, json_extract(NEW.embedding, '$')
          WHERE NEW.embedding_provider = 'minilm' AND NEW.dimensions = 384 AND NEW.projection_type = 'native';
          
          INSERT INTO memory_item_vec_openai(rowid, embedding) 
          SELECT NEW.id, json_extract(NEW.embedding, '$')
          WHERE NEW.embedding_provider = 'openai' AND NEW.dimensions = 1536 AND NEW.projection_type = 'native';
          
          INSERT INTO memory_item_vec_gemini(rowid, embedding) 
          SELECT NEW.id, json_extract(NEW.embedding, '$')
          WHERE NEW.embedding_provider = 'gemini' AND NEW.dimensions = 768 AND NEW.projection_type = 'native';
        END
      `);

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_update AFTER UPDATE ON memory_embedding BEGIN
          DELETE FROM memory_item_vec WHERE rowid = NEW.id;
          DELETE FROM memory_item_vec_tfidf WHERE rowid = NEW.id;
          DELETE FROM memory_item_vec_minilm WHERE rowid = NEW.id;
          DELETE FROM memory_item_vec_openai WHERE rowid = NEW.id;
          DELETE FROM memory_item_vec_gemini WHERE rowid = NEW.id;

          INSERT INTO memory_item_vec(rowid, embedding) 
          SELECT NEW.id, json_extract(NEW.embedding, '$')
          WHERE NEW.dimensions = 384;
          
          INSERT INTO memory_item_vec_tfidf(rowid, embedding) 
          SELECT NEW.id, json_extract(NEW.embedding, '$')
          WHERE NEW.embedding_provider = 'tfidf' AND NEW.dimensions = 384 AND NEW.projection_type = 'native';
          
          INSERT INTO memory_item_vec_minilm(rowid, embedding) 
          SELECT NEW.id, json_extract(NEW.embedding, '$')
          WHERE NEW.embedding_provider = 'minilm' AND NEW.dimensions = 384 AND NEW.projection_type = 'native';
          
          INSERT INTO memory_item_vec_openai(rowid, embedding) 
          SELECT NEW.id, json_extract(NEW.embedding, '$')
          WHERE NEW.embedding_provider = 'openai' AND NEW.dimensions = 1536 AND NEW.projection_type = 'native';
          
          INSERT INTO memory_item_vec_gemini(rowid, embedding) 
          SELECT NEW.id, json_extract(NEW.embedding, '$')
          WHERE NEW.embedding_provider = 'gemini' AND NEW.dimensions = 768 AND NEW.projection_type = 'native';
        END
      `);

      // Remove schema version record
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run('12.0');
    } catch (error) {
      throw new Error(
        `Failed to rollback migration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validate after migration
   */
  async validateAfter(db: Database.Database): Promise<void> {
    // Verify triggers exist
    if (!this.triggerExists(db, 'memory_embedding_vec_insert')) {
      throw new Error('memory_embedding_vec_insert trigger was not created');
    }

    if (!this.triggerExists(db, 'memory_embedding_vec_update')) {
      throw new Error('memory_embedding_vec_update trigger was not created');
    }

    // Verify trigger SQL contains correct dimension condition for TF-IDF (512)
    const insertTrigger = db
      .prepare(`
        SELECT sql FROM sqlite_master 
        WHERE type='trigger' AND name='memory_embedding_vec_insert'
      `)
      .get() as { sql: string } | undefined;

    if (!insertTrigger || !insertTrigger.sql) {
      throw new Error('memory_embedding_vec_insert trigger SQL not found');
    }

    // Check if trigger contains correct TF-IDF dimension condition
    if (!insertTrigger.sql.includes("dimensions = 512") || 
        !insertTrigger.sql.includes("embedding_provider = 'tfidf'")) {
      throw new Error('memory_embedding_vec_insert trigger does not contain correct TF-IDF dimension condition (512)');
    }

    const updateTrigger = db
      .prepare(`
        SELECT sql FROM sqlite_master 
        WHERE type='trigger' AND name='memory_embedding_vec_update'
      `)
      .get() as { sql: string } | undefined;

    if (!updateTrigger || !updateTrigger.sql) {
      throw new Error('memory_embedding_vec_update trigger SQL not found');
    }

    // Check if trigger contains correct TF-IDF dimension condition
    if (!updateTrigger.sql.includes("dimensions = 512") || 
        !updateTrigger.sql.includes("embedding_provider = 'tfidf'")) {
      throw new Error('memory_embedding_vec_update trigger does not contain correct TF-IDF dimension condition (512)');
    }
  }
}

// Default export for migration detector
export default FixTfidfDimensionTriggerMigration;

/**
 * MigrationRunner API 사용 예제 테스트
 * 
 * 4.2.1: MigrationRunner API 사용 예제 테스트 작성
 * 
 * 이 테스트는 마이그레이션 시스템의 사용 예제를 보여주는 통합 테스트입니다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MigrationRunner } from '../migration-runner.js';
import { MigrationDetector } from '../migration-detector.js';
import type { Migration } from '../types.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../../test/helpers/test-database.js';

/**
 * 예제 마이그레이션: 테스트 테이블 생성
 */
class ExampleMigration implements Migration {
  version = '999';
  name = 'example-migration';
  description = 'MigrationRunner API 사용 예제를 위한 테스트 마이그레이션';

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS example_table (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS example_table');
  }

  async validateBefore(db: Database.Database): Promise<void> {
    // 테이블이 없어야 함
    const table = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='example_table'
    `).get();
    
    if (table) {
      throw new Error('example_table already exists');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    // 테이블이 있어야 함
    const table = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='example_table'
    `).get();
    
    if (!table) {
      throw new Error('example_table was not created');
    }
    
    // 테이블 구조 검증
    const columns = db.prepare("PRAGMA table_info(example_table)").all() as Array<{ name: string }>;
    const columnNames = columns.map(col => col.name);
    
    if (!columnNames.includes('id')) {
      throw new Error('id column is missing');
    }
    if (!columnNames.includes('name')) {
      throw new Error('name column is missing');
    }
    if (!columnNames.includes('created_at')) {
      throw new Error('created_at column is missing');
    }
  }
}

describe('4.2.1 MigrationRunner API 사용 예제', () => {
  let db: Database.Database;
  let runner: MigrationRunner;
  let migration: Migration;

  beforeEach(async () => {
    db = await setupTestDatabase();
    runner = new MigrationRunner(db);
    migration = new ExampleMigration();
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('기본 사용 예제', () => {
    it('MigrationRunner를 생성하고 마이그레이션을 실행할 수 있어야 함', async () => {
      // Given: MigrationRunner와 마이그레이션 인스턴스
      // When: 마이그레이션 실행 (백업 없이)
      const result = await runner.runMigration(migration, {
        createBackup: false,
        autoRollback: true,
        validate: true
      });

      // Then: 마이그레이션이 성공해야 함
      expect(result.success).toBe(true);
      expect(result.version).toBe('999');
      expect(result.name).toBe('example-migration');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
      expect(result.error).toBeUndefined();
    });

    it('마이그레이션 후 테이블이 생성되어야 함', async () => {
      // Given: MigrationRunner와 마이그레이션 인스턴스
      // When: 마이그레이션 실행
      const result = await runner.runMigration(migration, {
        createBackup: false
      });

      // Then: 테이블이 생성되어야 함
      expect(result.success).toBe(true);
      
      const table = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='example_table'
      `).get();
      
      expect(table).toBeDefined();
    });
  });

  describe('검증 기능 예제', () => {
    it('validateBefore가 실행되어야 함', async () => {
      // Given: MigrationRunner와 마이그레이션 인스턴스
      // When: 마이그레이션 실행 (validate=true)
      const result = await runner.runMigration(migration, {
        createBackup: false,
        validate: true
      });

      // Then: 검증이 수행되고 성공해야 함
      expect(result.success).toBe(true);
    });

    it('validateAfter가 실행되어야 함', async () => {
      // Given: MigrationRunner와 마이그레이션 인스턴스
      // When: 마이그레이션 실행 (validate=true)
      const result = await runner.runMigration(migration, {
        createBackup: false,
        validate: true
      });

      // Then: 검증이 수행되고 성공해야 함
      expect(result.success).toBe(true);
      
      // validateAfter에서 테이블 구조를 검증하므로
      // 테이블이 올바르게 생성되었는지 확인됨
      const table = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='example_table'
      `).get();
      
      expect(table).toBeDefined();
    });
  });

  describe('MigrationDetector와 함께 사용 예제', () => {
    it('MigrationDetector로 마이그레이션을 감지할 수 있어야 함', async () => {
      // Given: MigrationDetector 인스턴스
      const detector = new MigrationDetector();
      
      // When: 모든 마이그레이션 감지
      const allMigrations = await detector.detectAllMigrations();
      
      // Then: 마이그레이션이 감지되어야 함
      expect(Array.isArray(allMigrations)).toBe(true);
      // 예제 마이그레이션은 migrations 디렉토리에 없으므로
      // 실제 마이그레이션만 감지됨
    });

    it('실행 대기 중인 마이그레이션을 감지할 수 있어야 함', async () => {
      // Given: MigrationDetector 인스턴스
      const detector = new MigrationDetector();
      
      // When: 실행 대기 중인 마이그레이션 감지
      const detection = await detector.detectPendingMigrations(db);
      
      // Then: 감지 결과가 반환되어야 함
      expect(detection).toBeDefined();
      expect(detection.pendingMigrations).toBeDefined();
      expect(Array.isArray(detection.pendingMigrations)).toBe(true);
      expect(detection.appliedMigrations).toBeDefined();
      expect(Array.isArray(detection.appliedMigrations)).toBe(true);
    });
  });

  describe('에러 처리 예제', () => {
    it('검증 실패 시 마이그레이션이 실패해야 함', async () => {
      // Given: 이미 테이블이 존재하는 상태
      db.exec(`
        CREATE TABLE example_table (
          id TEXT PRIMARY KEY
        )
      `);
      
      // When: 마이그레이션 실행 (validateBefore에서 실패해야 함)
      const result = await runner.runMigration(migration, {
        createBackup: false,
        validate: true
      });

      // Then: 마이그레이션이 실패해야 함
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});


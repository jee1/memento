/**
 * MigrationRunner 테스트
 * 마이그레이션 실행기 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MigrationRunner } from './migration-runner.js';
import type { Migration, MigrationResult } from '../../../tools/types.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../test/helpers/test-database.js';
import { BackupManager } from './backup-manager.js';
import { SchemaVersionManager } from './schema-version-manager.js';
import { DependencyValidator } from './dependency-validator.js';
import { MigrationLogger } from './migration-logger.js';

/**
 * 테스트용 마이그레이션 구현
 */
class TestMigration implements Migration {
  version = '1.0';
  name = 'test-migration';
  description = 'Test migration for testing';

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS test_table (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      )
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS test_table');
  }

  async validateBefore(db: Database.Database): Promise<void> {
    // 테이블이 없어야 함
    const table = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'
    `).get();
    if (table) {
      throw new Error('test_table already exists');
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    // 테이블이 있어야 함
    const table = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'
    `).get();
    if (!table) {
      throw new Error('test_table was not created');
    }
  }
}

describe('MigrationRunner', () => {
  let db: Database.Database;
  let runner: MigrationRunner;
  let testMigration: Migration;

  beforeEach(async () => {
    db = await setupTestDatabase();
    runner = new MigrationRunner(db);
    testMigration = new TestMigration();
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('runMigration', () => {
    it('마이그레이션을 실행해야 함', async () => {
      // When: 마이그레이션 실행 (메모리 DB는 백업 미지원)
      const result = await runner.runMigration(testMigration, { createBackup: false });

      // Then: 마이그레이션이 성공해야 함
      expect(result.success).toBe(true);
      expect(result.version).toBe('1.0');
      expect(result.name).toBe('test-migration');
      expect(result.startTime).toBeInstanceOf(Date);
      expect(result.endTime).toBeInstanceOf(Date);
    });

    it('마이그레이션 전 검증을 수행해야 함', async () => {
      // When: 마이그레이션 실행 (validate=true, createBackup=false)
      const result = await runner.runMigration(testMigration, { validate: true, createBackup: false });

      // Then: 검증이 수행되고 성공해야 함
      expect(result.success).toBe(true);
    });

    it('마이그레이션 후 검증을 수행해야 함', async () => {
      // When: 마이그레이션 실행 (validate=true, createBackup=false)
      const result = await runner.runMigration(testMigration, { validate: true, createBackup: false });

      // Then: 검증이 수행되고 성공해야 함
      expect(result.success).toBe(true);
      // 테이블이 생성되었는지 확인
      const table = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'
      `).get();
      expect(table).toBeDefined();
    });

    it('스키마 버전을 기록해야 함', async () => {
      // When: 마이그레이션 실행 (createBackup=false)
      await runner.runMigration(testMigration, { createBackup: false });

      // Then: 스키마 버전이 기록되어야 함
      const versionManager = new SchemaVersionManager(db);
      const currentVersion = await versionManager.getCurrentVersion();
      expect(currentVersion).toBe('1.0');
    });

    it('마이그레이션 실패 시 롤백해야 함', async () => {
      // Given: 실패하는 마이그레이션
      const failingMigration: Migration = {
        ...testMigration,
        async up() {
          throw new Error('Migration failed');
        }
      };

      // When: 마이그레이션 실행 (autoRollback=true, createBackup=false)
      const result = await runner.runMigration(failingMigration, { autoRollback: true, createBackup: false });

      // Then: 롤백되어야 함
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('마이그레이션 실패 시 트랜잭션이 롤백되어야 함', async () => {
      // Given: 실패하는 마이그레이션
      const failingMigration: Migration = {
        ...testMigration,
        async up() {
          db.exec('CREATE TABLE IF NOT EXISTS test_table (id TEXT PRIMARY KEY)');
          throw new Error('Migration failed');
        }
      };

      // When: 마이그레이션 실행 (autoRollback=true, createBackup=false)
      await runner.runMigration(failingMigration, { autoRollback: true, createBackup: false });

      // Then: 테이블이 생성되지 않아야 함 (롤백됨)
      const table = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'
      `).get();
      expect(table).toBeUndefined();
    });
  });

  describe('runMigrations', () => {
    it('여러 마이그레이션을 순차적으로 실행해야 함', async () => {
      // Given: 여러 마이그레이션
      const migration1: Migration = {
        version: '1.0',
        name: 'migration-1',
        description: 'First migration',
        async up(db) {
          db.exec('CREATE TABLE IF NOT EXISTS table1 (id TEXT PRIMARY KEY)');
        },
        async down(db) {
          db.exec('DROP TABLE IF EXISTS table1');
        },
        async validateBefore() {},
        async validateAfter() {}
      };

      const migration2: Migration = {
        version: '2.0',
        name: 'migration-2',
        description: 'Second migration',
        async up(db) {
          db.exec('CREATE TABLE IF NOT EXISTS table2 (id TEXT PRIMARY KEY)');
        },
        async down(db) {
          db.exec('DROP TABLE IF EXISTS table2');
        },
        async validateBefore() {},
        async validateAfter() {}
      };

      // When: 여러 마이그레이션 실행 (createBackup=false)
      const results = await runner.runMigrations([migration1, migration2], { createBackup: false });

      // Then: 모든 마이그레이션이 성공해야 함
      expect(results.length).toBe(2);
      expect(results.every(r => r.success)).toBe(true);
      expect(results[0].version).toBe('1.0');
      expect(results[1].version).toBe('2.0');
    });

    it('마이그레이션 실패 시 이후 마이그레이션을 실행하지 않아야 함', async () => {
      // Given: 첫 번째 마이그레이션은 성공, 두 번째는 실패
      const migration1: Migration = {
        version: '1.0',
        name: 'migration-1',
        description: 'First migration',
        async up(db) {
          db.exec('CREATE TABLE IF NOT EXISTS table1 (id TEXT PRIMARY KEY)');
        },
        async down(db) {
          db.exec('DROP TABLE IF EXISTS table1');
        },
        async validateBefore() {},
        async validateAfter() {}
      };

      const failingMigration: Migration = {
        version: '2.0',
        name: 'migration-2',
        description: 'Failing migration',
        async up() {
          throw new Error('Migration failed');
        },
        async down() {},
        async validateBefore() {},
        async validateAfter() {}
      };

      // When: 여러 마이그레이션 실행 (createBackup=false)
      const results = await runner.runMigrations([migration1, failingMigration], { createBackup: false });

      // Then: 첫 번째는 성공, 두 번째는 실패
      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });
  });

  describe('rollbackMigration', () => {
    it('롤백을 수행해야 함', async () => {
      // Given: 마이그레이션 실행 및 백업 생성
      const result = await runner.runMigration(testMigration, { createBackup: false });
      expect(result.success).toBe(true);

      // When: 롤백 실행
      await runner.rollbackMigration(testMigration, '');

      // Then: 테이블이 삭제되었는지 확인
      const table = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'
      `).get();
      expect(table).toBeUndefined();
    });

    it('롤백 실패 시 에러를 발생시켜야 함', async () => {
      // Given: 롤백 실패하는 마이그레이션
      const failingRollbackMigration: Migration = {
        ...testMigration,
        async down() {
          throw new Error('Rollback failed');
        }
      };

      // 마이그레이션 먼저 실행
      await runner.runMigration(failingRollbackMigration, { createBackup: false });

      // When & Then: 롤백 실행 시 에러 발생
      await expect(
        runner.rollbackMigration(failingRollbackMigration, '')
      ).rejects.toThrow('Rollback failed');
    });
  });
});


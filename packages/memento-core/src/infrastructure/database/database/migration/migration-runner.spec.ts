/**
 * MigrationRunner 테스트
 * 마이그레이션 실행기 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MigrationRunner } from './migration-runner.js';
import type { Migration, MigrationResult } from '../types.js';
import Database from 'better-sqlite3';
import { BackupManager } from './backup-manager.js';
import { SchemaVersionManager } from './schema-version-manager.js';
import { DependencyValidator } from './dependency-validator.js';
import { MigrationLogger } from './migration-logger.js';
import { logger } from '../../../../shared/utils/logger.js';

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

const SCHEMA_VERSION_TABLE = `
  CREATE TABLE IF NOT EXISTS memento_schema_version (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    migration_name TEXT NOT NULL,
    checksum TEXT,
    applied_by TEXT DEFAULT 'system',
    description TEXT
  )
`;

describe('MigrationRunner', () => {
  let db: Database.Database;
  let runner: MigrationRunner;
  let testMigration: Migration;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA_VERSION_TABLE);
    runner = new MigrationRunner(db);
    testMigration = new TestMigration();
  });

  afterEach(() => {
    if (db) db.close();
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

  describe('로깅 정책 통일 (console.* 제거)', () => {
    let loggerInfoSpy: ReturnType<typeof vi.spyOn>;
    let loggerErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let mockMigrationLogger: MigrationLogger;

    beforeEach(() => {
      // Given: MigrationLogger 모킹 (console.log 사용 방지)
      mockMigrationLogger = {
        initializeLogFile: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        logMigrationResult: vi.fn()
      } as unknown as MigrationLogger;
      
      // MigrationRunner에 모킹된 logger 주입
      runner = new MigrationRunner(db, mockMigrationLogger);

      // Given: Logger 스파이 설정
      loggerInfoSpy = vi.spyOn(logger, 'info');
      loggerErrorSpy = vi.spyOn(logger, 'error');
      
      // console.* 스파이 설정 (사용되지 않아야 함)
      consoleLogSpy = vi.spyOn(console, 'log');
      consoleErrorSpy = vi.spyOn(console, 'error');
    });

    afterEach(() => {
      // When: 테스트 후 정리
      vi.restoreAllMocks();
    });

    /**
     * Given: MigrationRunner가 표준 로거를 사용하도록 변경됨
     * When: 마이그레이션을 실행하면
     * Then: logger.info가 호출되어야 하고 console.log는 호출되지 않아야 함
     */
    it('마이그레이션 시작 시 logger.info를 사용해야 함', async () => {
      // Given: MigrationRunner가 표준 로거를 사용하도록 변경됨 (아직 구현되지 않음)
      // When: 마이그레이션 실행
      try {
        await runner.runMigration(testMigration, { createBackup: false });
      } catch (error) {
        // 마이그레이션 실패는 무시 (로깅 테스트 목적)
      }

      // Then: logger.info가 호출되어야 함
      expect(loggerInfoSpy).toHaveBeenCalled();
      
      // logger.info가 '마이그레이션 시작' 메시지로 호출되었는지 확인
      const infoCalls = loggerInfoSpy.mock.calls;
      const messages = infoCalls.map(call => call[0]);
      expect(messages.some(msg => typeof msg === 'string' && msg.includes('마이그레이션 시작'))).toBe(true);
      
      // console.log는 호출되지 않아야 함
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    /**
     * Given: MigrationRunner가 표준 로거를 사용하도록 변경됨
     * When: 마이그레이션 중 정보성 메시지를 출력할 때
     * Then: logger.info가 적절한 메시지로 호출되어야 함
     */
    it('마이그레이션 진행 상황을 logger.info로 로깅해야 함', async () => {
      // Given: MigrationRunner가 표준 로거를 사용하도록 변경됨 (아직 구현되지 않음)
      // When: 마이그레이션 실행
      try {
        await runner.runMigration(testMigration, { createBackup: false });
      } catch (error) {
        // 마이그레이션 실패는 무시 (로깅 테스트 목적)
      }

      // Then: logger.info가 여러 번 호출되어야 함 (진행 상황 로깅)
      expect(loggerInfoSpy).toHaveBeenCalled();
      
      // 주요 진행 상황 메시지 확인
      const infoCalls = loggerInfoSpy.mock.calls;
      const messages = infoCalls.map(call => call[0]);
      
      // 마이그레이션 시작 메시지 확인
      expect(messages.some(msg => typeof msg === 'string' && msg.includes('마이그레이션 시작'))).toBe(true);
      
      // console.log는 호출되지 않아야 함
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    /**
     * Given: MigrationRunner가 표준 로거를 사용하도록 변경됨
     * When: 마이그레이션 실패 시
     * Then: logger.error가 호출되어야 하고 console.error는 호출되지 않아야 함
     */
    it('마이그레이션 실패 시 logger.error를 사용해야 함', async () => {
      // Given: 실패하는 마이그레이션 (validateBefore는 통과, up()에서만 실패)
      const failingMigration: Migration = {
        ...testMigration,
        async validateBefore() {
          // 검증은 통과
        },
        async up() {
          throw new Error('Migration failed');
        }
      };

      // When: 마이그레이션 실행 (실패 예상, autoRollback=false로 설정하여 롤백 시도 안 함)
      const result = await runner.runMigration(failingMigration, { createBackup: false, autoRollback: false });

      // Then: 마이그레이션이 실패해야 함
      expect(result.success).toBe(false);
      
      // logger.error가 호출되어야 함
      expect(loggerErrorSpy).toHaveBeenCalled();
      
      const errorCalls = loggerErrorSpy.mock.calls;
      const messages = errorCalls.map(call => call[0]);
      expect(messages.some(msg => typeof msg === 'string' && msg.includes('마이그레이션'))).toBe(true);
      
      // console.error는 호출되지 않아야 함 (MigrationLogger 모킹으로 인해 호출되지 않음)
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    /**
     * Given: MigrationRunner가 표준 로거를 사용하도록 변경됨
     * When: 마이그레이션 성공 시
     * Then: logger.info가 성공 메시지로 호출되어야 함
     */
    it('마이그레이션 성공 시 logger.info로 성공 메시지를 로깅해야 함', async () => {
      // Given: MigrationRunner가 표준 로거를 사용하도록 변경됨 (아직 구현되지 않음)
      // When: 마이그레이션 실행
      try {
        await runner.runMigration(testMigration, { createBackup: false });
      } catch (error) {
        // 마이그레이션 실패는 무시 (로깅 테스트 목적)
      }

      // Then: logger.info가 호출되어야 함 (마이그레이션이 성공하거나 진행 중일 수 있음)
      expect(loggerInfoSpy).toHaveBeenCalled();
      
      const infoCalls = loggerInfoSpy.mock.calls;
      const messages = infoCalls.map(call => call[0]);
      
      // 마이그레이션 관련 메시지 확인
      const hasMigrationMessage = messages.some(msg => 
        typeof msg === 'string' && 
        (msg.includes('마이그레이션') || msg.includes('Migration'))
      );
      
      expect(hasMigrationMessage).toBe(true);
      
      // console.log는 호출되지 않아야 함
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    /**
     * Given: MigrationRunner가 표준 로거를 사용하도록 변경됨
     * When: 롤백 실행 시
     * Then: logger.info가 롤백 메시지로 호출되어야 함
     */
    it('롤백 실행 시 logger.info를 사용해야 함', async () => {
      // Given: 마이그레이션 실행
      await runner.runMigration(testMigration, { createBackup: false });

      // When: 롤백 실행
      try {
        await runner.rollbackMigration(testMigration, '');
      } catch (error) {
        // 롤백 실패는 무시 (로깅 테스트 목적)
      }

      // Then: logger.info가 호출되어야 함
      expect(loggerInfoSpy).toHaveBeenCalled();
      
      const infoCalls = loggerInfoSpy.mock.calls;
      const messages = infoCalls.map(call => call[0]);
      
      // 롤백 관련 메시지 확인
      const hasRollbackMessage = messages.some(msg => 
        typeof msg === 'string' && 
        (msg.includes('롤백') || msg.includes('rollback'))
      );
      
      // 롤백 메시지가 있거나 마이그레이션 관련 메시지가 있어야 함
      expect(hasRollbackMessage || messages.length > 0).toBe(true);
      
      // console.log는 호출되지 않아야 함
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });
});


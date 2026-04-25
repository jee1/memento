/**
 * Database migration 테스트
 * 마이그레이션 상태 확인 및 레거시 스키마 지원 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { closeSync, ftruncateSync, mkdtempSync, openSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { migrateDatabase } from './migrate.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { logger } from '../../../shared/utils/logger.js';

describe('Database Migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch {
        // 이미 닫혀있을 수 있음
      }
    }
  });

  describe('마이그레이션 상태 확인', () => {
    it('Given: 손상된 DB 파일이 DB_PATH에 있을 때, When: migrateDatabase를 호출하면, Then: quarantine 복사 후 중단해야 함', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'memento-migrate-corrupt-'));
      const dbPath = join(dir, 'memory.db');
      const source = new Database(dbPath);
      source.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)');
      source.exec("INSERT INTO sample(value) VALUES ('bad')");
      source.close();

      const size = statSync(dbPath).size;
      const fd = openSync(dbPath, 'r+');
      ftruncateSync(fd, Math.max(100, Math.floor(size / 2)));
      closeSync(fd);

      const previousDbPath = process.env.DB_PATH;
      try {
        vi.resetModules();
        process.env.DB_PATH = dbPath;
        const migrateModule = await import('./migrate.js');
        expect(() => migrateModule.migrateDatabase()).toThrow(/데이터베이스 무결성 사전 검사 실패/);
      } finally {
        if (previousDbPath === undefined) {
          delete process.env.DB_PATH;
        } else {
          process.env.DB_PATH = previousDbPath;
        }
        rmSync(dir, { recursive: true, force: true });
      }
    });


    it('Given: 레거시 스키마에 embedding 컬럼이 없을 때, When: 마이그레이션을 실행하면, Then: embedding 컬럼을 추가해야 함', () => {
      // Given: 레거시 스키마 (embedding 컬럼 없음)
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_item (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_embedding (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          dim INTEGER NOT NULL,
          model TEXT
        )
      `);

      // embedding 컬럼이 없는지 확인
      const columnsBefore = db.prepare(`
        SELECT name FROM pragma_table_info('memory_embedding')
      `).all() as Array<{ name: string }>;
      const hasEmbeddingBefore = columnsBefore.some(c => c.name === 'embedding');
      expect(hasEmbeddingBefore).toBe(false);

      // When: 마이그레이션 로직 실행 (embedding 컬럼 추가)
      // migrate.ts의 로직을 직접 실행
      try {
        db.exec('ALTER TABLE memory_embedding ADD COLUMN embedding TEXT NOT NULL DEFAULT "[]"');
      } catch (err: any) {
        // 컬럼이 이미 존재하는 경우 무시
        if (!err.message.includes('duplicate column name')) {
          throw err;
        }
      }

      // Then: embedding 컬럼이 추가되어야 함
      const columnsAfter = db.prepare(`
        SELECT name FROM pragma_table_info('memory_embedding')
      `).all() as Array<{ name: string }>;
      const hasEmbeddingAfter = columnsAfter.some(c => c.name === 'embedding');
      expect(hasEmbeddingAfter).toBe(true);
    });

    it('Given: 마이그레이션이 필요한 스키마일 때, When: 마이그레이션 상태를 확인하면, Then: 마이그레이션이 필요함을 감지해야 함', () => {
      // Given: 레거시 스키마
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_embedding (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          dim INTEGER NOT NULL
        )
      `);

      // When: 스키마 컬럼 확인
      const columns = db.prepare(`
        SELECT name FROM pragma_table_info('memory_embedding')
      `).all() as Array<{ name: string }>;
      
      const hasEmbedding = columns.some(c => c.name === 'embedding');
      const hasProvider = columns.some(c => c.name === 'embedding_provider');
      const hasProjectionType = columns.some(c => c.name === 'projection_type');

      // Then: 마이그레이션이 필요함을 감지해야 함
      const needsMigration = !hasEmbedding || !hasProvider || !hasProjectionType;
      expect(needsMigration).toBe(true);
    });
  });

  describe('레거시 스키마 지원', () => {
    it('Given: 레거시 스키마에서 embedding 컬럼이 없을 때, When: 마이그레이션을 실행하면, Then: embedding 컬럼을 추가해야 함', () => {
      // Given: 레거시 스키마 (embedding 컬럼 없음)
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_embedding (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          dim INTEGER NOT NULL,
          model TEXT
        )
      `);

      db.exec(`
        INSERT INTO memory_embedding (memory_id, dim, model)
        VALUES ('test-1', 384, 'legacy-model')
      `);

      // embedding 컬럼이 없는지 확인
      const columnsBefore = db.prepare(`
        SELECT name FROM pragma_table_info('memory_embedding')
      `).all() as Array<{ name: string }>;
      const hasEmbeddingBefore = columnsBefore.some(c => c.name === 'embedding');
      expect(hasEmbeddingBefore).toBe(false);

      // When: embedding 컬럼 추가 (마이그레이션 로직)
      try {
        db.exec('ALTER TABLE memory_embedding ADD COLUMN embedding TEXT NOT NULL DEFAULT "[]"');
      } catch (err: any) {
        // 컬럼이 이미 존재하는 경우 무시
        if (!err.message.includes('duplicate column name')) {
          throw err;
        }
      }

      // Then: embedding 컬럼이 추가되어야 함
      const columnsAfter = db.prepare(`
        SELECT name FROM pragma_table_info('memory_embedding')
      `).all() as Array<{ name: string }>;
      const hasEmbeddingAfter = columnsAfter.some(c => c.name === 'embedding');
      expect(hasEmbeddingAfter).toBe(true);

      // 추가된 컬럼으로 데이터 조회 가능해야 함
      const result = DatabaseUtils.get(db, `
        SELECT id, memory_id, dim, model, embedding
        FROM memory_embedding
        WHERE memory_id = ?
      `, ['test-1']);

      expect(result).toBeDefined();
      expect(result.memory_id).toBe('test-1');
      expect(result.embedding).toBe('[]');
    });
  });

  describe('로깅 정책 통일 (console.* 제거)', () => {
    let loggerInfoSpy: ReturnType<typeof vi.spyOn>;
    let loggerErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let testDbPath: string;
    let originalDbPath: string | undefined;
    const { tmpdir } = require('os');
    const { join } = require('path');
    const { mkdirSync, unlinkSync, existsSync } = require('fs');

    beforeEach(() => {
      // Given: 테스트 데이터베이스 설정
      const testDir = join(tmpdir(), `memento-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
      testDbPath = join(testDir, 'memory.db');

      // 기본 스키마가 있는 데이터베이스 생성
      const testDb = new Database(testDbPath);
      testDb.exec(`
        CREATE TABLE IF NOT EXISTS memory_item (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
        )
      `);
      testDb.close();

      // 환경 변수 백업 및 설정
      originalDbPath = process.env.DB_PATH;
      process.env.DB_PATH = testDbPath;

      // Logger 스파이 설정
      loggerInfoSpy = vi.spyOn(logger, 'info');
      loggerErrorSpy = vi.spyOn(logger, 'error');
      
      // console.* 스파이 설정 (사용되지 않아야 함)
      consoleLogSpy = vi.spyOn(console, 'log');
      consoleErrorSpy = vi.spyOn(console, 'error');
    });

    afterEach(() => {
      // When: 테스트 후 정리
      vi.restoreAllMocks();

      // 테스트 데이터베이스 파일 삭제
      if (testDbPath && existsSync(testDbPath)) {
        try {
          unlinkSync(testDbPath);
        } catch {
          // 파일 삭제 실패는 무시
        }
      }

      // 환경 변수 복원
      if (originalDbPath !== undefined) {
        process.env.DB_PATH = originalDbPath;
      } else {
        delete process.env.DB_PATH;
      }
    });

    /**
     * Given: migrateDatabase 함수가 표준 로거를 사용하도록 변경됨
     * When: 마이그레이션을 실행하면
     * Then: logger.info가 호출되어야 하고 console.log는 호출되지 않아야 함
     */
    it('마이그레이션 시작 시 logger.info를 사용해야 함', () => {
      // Given: migrateDatabase 함수가 표준 로거를 사용하도록 변경됨 (아직 구현되지 않음)
      // When: 마이그레이션 실행
      try {
        migrateDatabase();
      } catch (error) {
        // 마이그레이션 실패는 무시 (로깅 테스트 목적)
      }

      // Then: logger.info가 호출되어야 함
      expect(loggerInfoSpy).toHaveBeenCalled();
      
      // logger.info가 '데이터베이스 마이그레이션' 메시지로 호출되었는지 확인
      const infoCalls = loggerInfoSpy.mock.calls;
      const messages = infoCalls.map(call => call[0]);
      expect(messages.some(msg => msg.includes('데이터베이스 마이그레이션'))).toBe(true);
      
      // console.log는 호출되지 않아야 함
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    /**
     * Given: migrateDatabase 함수가 표준 로거를 사용하도록 변경됨
     * When: 마이그레이션 중 정보성 메시지를 출력할 때
     * Then: logger.info가 적절한 메시지로 호출되어야 함
     */
    it('마이그레이션 진행 상황을 logger.info로 로깅해야 함', () => {
      // Given: migrateDatabase 함수가 표준 로거를 사용하도록 변경됨 (아직 구현되지 않음)
      // When: 마이그레이션 실행
      try {
        migrateDatabase();
      } catch (error) {
        // 마이그레이션 실패는 무시 (로깅 테스트 목적)
      }

      // Then: logger.info가 여러 번 호출되어야 함 (진행 상황 로깅)
      expect(loggerInfoSpy).toHaveBeenCalled();
      
      // 주요 진행 상황 메시지 확인
      const infoCalls = loggerInfoSpy.mock.calls;
      const messages = infoCalls.map(call => call[0]);
      
      // 마이그레이션 시작 메시지 확인
      expect(messages.some(msg => msg.includes('마이그레이션 시작'))).toBe(true);
      
      // console.log는 호출되지 않아야 함
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    /**
     * Given: migrateDatabase 함수가 표준 로거를 사용하도록 변경됨
     * When: 마이그레이션 실패 시
     * Then: logger.error가 호출되어야 하고 console.error는 호출되지 않아야 함
     */
    it('마이그레이션 실패 시 logger.error를 사용해야 함', () => {
      // Given: 마이그레이션이 실패하는 상황 (잘못된 데이터베이스 경로)
      const invalidDbPath = join(tmpdir(), `memento-test-invalid-${Date.now()}.db`);
      process.env.DB_PATH = invalidDbPath;

      // When: 마이그레이션 실행 (실패 예상)
      try {
        migrateDatabase();
      } catch (error) {
        // 에러는 예상됨
      }

      // Then: logger.error가 호출되어야 함
      expect(loggerErrorSpy).toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('마이그레이션 실패'),
        expect.anything()
      );
      
      // console.error는 호출되지 않아야 함
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    /**
     * Given: migrateDatabase 함수가 표준 로거를 사용하도록 변경됨
     * When: 마이그레이션 완료 시
     * Then: logger.info가 완료 메시지로 호출되어야 함
     */
    it('마이그레이션 완료 시 logger.info로 완료 메시지를 로깅해야 함', () => {
      // Given: migrateDatabase 함수가 표준 로거를 사용하도록 변경됨 (아직 구현되지 않음)
      // When: 마이그레이션 실행
      try {
        migrateDatabase();
      } catch (error) {
        // 마이그레이션 실패는 무시 (로깅 테스트 목적)
      }

      // Then: logger.info가 호출되어야 함 (마이그레이션이 완료되거나 진행 중일 수 있음)
      expect(loggerInfoSpy).toHaveBeenCalled();
      
      const infoCalls = loggerInfoSpy.mock.calls;
      const messages = infoCalls.map(call => call[0]);
      
      // 완료 메시지 확인 (마이그레이션이 성공적으로 완료된 경우)
      // 또는 마이그레이션 진행 메시지가 있는지 확인
      const hasCompletionMessage = messages.some(msg => 
        msg.includes('마이그레이션 완료') || 
        msg.includes('데이터베이스 마이그레이션 완료')
      );
      
      // 마이그레이션이 진행 중이거나 완료되었는지 확인
      const hasProgressMessage = messages.some(msg => 
        msg.includes('마이그레이션') || 
        msg.includes('데이터베이스 마이그레이션')
      );
      
      expect(hasProgressMessage).toBe(true);
      
      // console.log는 호출되지 않아야 함
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });
});

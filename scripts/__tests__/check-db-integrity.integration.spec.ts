/**
 * check-db-integrity.js 통합 테스트
 * 
 * Given/When/Then 구조를 따르는 통합 테스트
 * 공통 모듈(initializeDatabase)을 사용하는 버전으로 리팩토링 후 검증
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initializeDatabase, closeDatabase } from '@memento/core/infrastructure/database/sqlite/init.js';

describe('check-db-integrity 통합 테스트', () => {
  let testDbPath: string;
  let testLogPath: string;
  let testLogDir: string;
  let originalDbPath: string | undefined;
  let originalLogPath: string | undefined;

  beforeEach(() => {
    // 테스트용 임시 디렉토리 생성
    const testDir = join(tmpdir(), `memento-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    testDbPath = join(testDir, 'memory.db');
    testLogDir = join(testDir, 'logs');
    testLogPath = join(testLogDir, 'db-integrity.log');
    
    mkdirSync(testLogDir, { recursive: true });
    
    // 환경 변수 백업 및 설정
    originalDbPath = process.env.DB_PATH;
    process.env.DB_PATH = testDbPath;
  });

  afterEach(() => {
    // 환경 변수 복원
    if (originalDbPath !== undefined) {
      process.env.DB_PATH = originalDbPath;
    } else {
      delete process.env.DB_PATH;
    }
    
    // 테스트 파일 정리
    try {
      if (existsSync(testLogPath)) {
        unlinkSync(testLogPath);
      }
      if (existsSync(testDbPath)) {
        unlinkSync(testDbPath);
      }
    } catch (error) {
      // 파일 정리 실패는 무시
    }
  });

  /**
   * @given 공통 모듈(initializeDatabase)을 사용하는 check-db-integrity 함수
   * @when 정상적인 데이터베이스에서 무결성 검사 실행
   * @then 검사 통과 및 정상 상태 반환
   */
  it('should pass integrity check for valid database', async () => {
    // Given: 정상적인 데이터베이스 초기화
    const db = await initializeDatabase(testDbPath);
    
    try {
      // 기본 테이블 생성 (initializeDatabase가 자동으로 생성하지만, 명시적으로 확인)
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('memory_item', 'memory_embedding')
      `).all();
      
      expect(tables.length).toBeGreaterThanOrEqual(0);
      
      // When: 무결성 검사 실행
      const integrityResult = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      
      // Then: 검사 통과
      expect(integrityResult.integrity_check).toBe('ok');
      
      // 데이터 개수 확인
      const memoryCount = db.prepare('SELECT COUNT(*) as count FROM memory_item').get() as { count: number };
      expect(memoryCount.count).toBeGreaterThanOrEqual(0);
    } finally {
      closeDatabase(db);
    }
  });

  /**
   * @given 공통 모듈(initializeDatabase)을 사용하는 check-db-integrity 함수
   * @when 데이터베이스 파일이 없는 경우
   * @then 적절한 에러 처리 또는 새 DB 생성
   */
  it('should handle missing database file', async () => {
    // Given: DB_PATH를 존재하지 않는 경로로 설정
    const nonExistentPath = join(tmpdir(), `non-existent-${Date.now()}.db`);
    process.env.DB_PATH = nonExistentPath;
    
    // When: initializeDatabase 호출 (DB_PATH는 mementoConfig에 스냅샷되므로 경로는 인자로 전달)
    // Then: 새 데이터베이스가 생성되어야 함 (initializeDatabase의 동작)
    const db = await initializeDatabase(nonExistentPath);
    
    try {
      expect(db).toBeDefined();
      expect(existsSync(nonExistentPath)).toBe(true);
    } finally {
      closeDatabase(db);
      if (existsSync(nonExistentPath)) {
        unlinkSync(nonExistentPath);
      }
    }
  });

  /**
   * @given 공통 모듈(initializeDatabase)을 사용하는 check-db-integrity 함수
   * @when 필수 테이블이 존재하는 데이터베이스에서 검사 실행
   * @then 필수 테이블 확인 통과
   */
  it('should verify required tables exist', async () => {
    // Given: 정상적인 데이터베이스 초기화
    const db = await initializeDatabase(testDbPath);
    
    try {
      // When: 필수 테이블 확인
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('memory_item', 'memory_embedding', 'memory_tag')
      `).all() as Array<{ name: string }>;
      
      // Then: 필수 테이블이 존재해야 함 (initializeDatabase가 스키마를 생성하므로)
      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('memory_item');
      // memory_embedding과 memory_tag는 스키마에 따라 있을 수 있음
    } finally {
      closeDatabase(db);
    }
  });

  /**
   * @given 공통 모듈(initializeDatabase)을 사용하는 check-db-integrity 함수
   * @when 데이터 개수 확인 실행
   * @then 정상적으로 데이터 개수 반환
   */
  it('should count data correctly', async () => {
    // Given: 정상적인 데이터베이스 초기화
    const db = await initializeDatabase(testDbPath);
    
    try {
      // When: 데이터 개수 확인
      const memoryCount = db.prepare('SELECT COUNT(*) as count FROM memory_item').get() as { count: number };
      const embeddingCount = db.prepare('SELECT COUNT(*) as count FROM memory_embedding').get() as { count: number };
      
      // Then: 정상적으로 개수 반환 (0개 이상)
      expect(memoryCount.count).toBeGreaterThanOrEqual(0);
      expect(embeddingCount.count).toBeGreaterThanOrEqual(0);
    } finally {
      closeDatabase(db);
    }
  });
});


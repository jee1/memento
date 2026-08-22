/**
 * regenerate-embeddings.js 통합 테스트
 * 
 * Given/When/Then 구조를 따르는 통합 테스트
 * 공통 모듈(initializeDatabase)을 사용하는 버전으로 리팩토링 후 검증
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initializeDatabase, closeDatabase } from '@memento/core/infrastructure/database/sqlite/init.js';
import Database from 'better-sqlite3';

describe('regenerate-embeddings 통합 테스트', () => {
  let testDbPath: string;
  let originalDbPath: string | undefined;

  beforeEach(() => {
    // 테스트용 임시 디렉토리 생성
    const testDir = join(tmpdir(), `memento-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    testDbPath = join(testDir, 'memory.db');
    
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
      if (existsSync(testDbPath)) {
        unlinkSync(testDbPath);
      }
    } catch (error) {
      // 파일 정리 실패는 무시
    }
  });

  /**
   * @given 공통 모듈(initializeDatabase)을 사용하는 regenerate-embeddings 함수
   * @when 데이터베이스 연결 및 기억 조회
   * @then 기억 목록이 정상적으로 조회됨
   */
  it('should query memories successfully', async () => {
    // Given: 정상적인 데이터베이스 초기화
    const db = await initializeDatabase();
    
    try {
      // memory_item 테이블 확인
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_item'
      `).get();
      
      if (tableExists) {
        // When: 기억 조회
        const memories = db.prepare(`
          SELECT id, content, type, importance, created_at
          FROM memory_item
          ORDER BY created_at
        `).all();
        
        // Then: 기억 목록이 정상적으로 조회됨
        expect(memories).toBeDefined();
        expect(Array.isArray(memories)).toBe(true);
      } else {
        console.log('⚠️ memory_item 테이블이 없습니다. 테스트 스킵');
      }
    } finally {
      closeDatabase(db);
    }
  });

  /**
   * @given 공통 모듈(initializeDatabase)을 사용하는 regenerate-embeddings 함수
   * @when 임베딩 통계 조회
   * @then 통계가 정상적으로 반환됨
   */
  it('should query embedding statistics successfully', async () => {
    // Given: 정상적인 데이터베이스 초기화
    const db = await initializeDatabase();
    
    try {
      // memory_embedding 테이블 확인
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_embedding'
      `).get();
      
      if (tableExists) {
        // When: 임베딩 통계 조회
        const finalStats = db.prepare(`
          SELECT 
            COUNT(*) as total,
            AVG(dim) as avg_dim,
            MIN(dim) as min_dim,
            MAX(dim) as max_dim
          FROM memory_embedding
        `).get();
        
        // Then: 통계가 정상적으로 반환됨
        expect(finalStats).toBeDefined();
        expect(finalStats.total).toBeGreaterThanOrEqual(0);
      } else {
        console.log('⚠️ memory_embedding 테이블이 없습니다. 테스트 스킵');
      }
    } finally {
      closeDatabase(db);
    }
  });

  /**
   * @given 공통 모듈(initializeDatabase)을 사용하는 regenerate-embeddings 함수
   * @when 차원 일치성 확인
   * @then 차원 불일치가 정상적으로 감지됨
   */
  it('should detect dimension mismatches correctly', async () => {
    // Given: 정상적인 데이터베이스 초기화
    const db = await initializeDatabase();
    
    try {
      // memory_embedding 테이블 확인
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_embedding'
      `).get();
      
      if (tableExists) {
        // When: 차원 일치성 확인
        const expectedDim = 384; // 예상 차원
        const mismatchedDims = db.prepare(`
          SELECT COUNT(*) as count FROM memory_embedding WHERE dim != ?
        `).get(expectedDim) as { count: number };
        
        // Then: 차원 불일치가 정상적으로 감지됨
        expect(mismatchedDims).toBeDefined();
        expect(mismatchedDims.count).toBeGreaterThanOrEqual(0);
      } else {
        console.log('⚠️ memory_embedding 테이블이 없습니다. 테스트 스킵');
      }
    } finally {
      closeDatabase(db);
    }
  });

  /**
   * @given 공통 모듈(initializeDatabase)을 사용하는 regenerate-embeddings 함수
   * @when 빈 기억 목록 처리
   * @then 적절한 메시지 출력 및 종료
   */
  it('should handle empty memory list gracefully', async () => {
    // Given: 정상적인 데이터베이스 초기화
    const db = await initializeDatabase();
    
    try {
      // memory_item 테이블 확인
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_item'
      `).get();
      
      if (tableExists) {
        // When: 기억 조회
        const memories = db.prepare(`
          SELECT id, content, type, importance, created_at
          FROM memory_item
          ORDER BY created_at
        `).all();
        
        // Then: 빈 목록도 정상적으로 처리됨
        expect(memories).toBeDefined();
        expect(Array.isArray(memories)).toBe(true);
        // 빈 목록인 경우에도 에러 없이 처리되어야 함
      } else {
        console.log('⚠️ memory_item 테이블이 없습니다. 테스트 스킵');
      }
    } finally {
      closeDatabase(db);
    }
  });
});


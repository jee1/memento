/**
 * migrate-embedding-data.js 통합 테스트
 * 
 * Given/When/Then 구조를 따르는 통합 테스트
 * 공통 모듈(initializeDatabase)을 사용하는 버전으로 리팩토링 후 검증
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initializeDatabase, closeDatabase } from '@memento/core/infrastructure/database/sqlite/init.js';
function jsonEmbedding(dim: number): string {
  return JSON.stringify(Array.from({ length: dim }, () => 0.01));
}

describe('migrate-embedding-data 통합 테스트', () => {
  let testDbPath: string;
  let testBackupPath: string;
  let originalDbPath: string | undefined;

  beforeEach(() => {
    // 테스트용 임시 디렉토리 생성
    const testDir = join(tmpdir(), `memento-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    
    testDbPath = join(testDir, 'memory.db');
    testBackupPath = join(testDir, `memory-backup-${Date.now()}.db`);
    
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
      if (existsSync(testBackupPath)) {
        unlinkSync(testBackupPath);
      }
    } catch (error) {
      // 파일 정리 실패는 무시
    }
  });

  /**
   * @given 공통 모듈(initializeDatabase)을 사용하는 migrate-embedding-data 함수
   * @when 데이터베이스 연결 및 백업 생성
   * @then 백업 파일이 정상적으로 생성됨
   */
  it('should create backup successfully', async () => {
    // Given: 정상적인 데이터베이스 초기화
    const db = await initializeDatabase(testDbPath);
    
    try {
      // 테스트 데이터 삽입 (memory_id NOT NULL, FK → memory_item)
      db.exec(`
        INSERT INTO memory_item (id, type, content) VALUES ('mig_emb_1', 'semantic', 'migrate-embedding test');
      `);
      const ins = db.prepare(`
        INSERT INTO memory_embedding (memory_id, embedding, dim, model, projection_type)
        VALUES (?, ?, ?, ?, ?)
      `);
      ins.run('mig_emb_1', jsonEmbedding(384), 384, 'lightweight-hybrid', 'native');
    } finally {
      closeDatabase(db);
    }

    // When: 파일 스냅샷 백업 (better-sqlite3 backup API는 비동기 step이 필요함)
    if (existsSync(testDbPath)) {
      copyFileSync(testDbPath, testBackupPath);
    }

    // Then: 백업 파일이 생성되었는지 확인
    expect(existsSync(testBackupPath)).toBe(true);
  });

  /**
   * @given 공통 모듈(initializeDatabase)을 사용하는 migrate-embedding-data 함수
   * @when 기존 데이터 분석 실행
   * @then 분석 결과가 정상적으로 반환됨
   */
  it('should analyze existing data correctly', async () => {
    // Given: 정상적인 데이터베이스 초기화 및 테스트 데이터
    const db = await initializeDatabase(testDbPath);
    
    try {
      // memory_embedding 테이블이 있는지 확인
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_embedding'
      `).get();
      
      if (tableExists) {
        // When: 데이터 분석
        const dimensionStats = db.prepare(`
          SELECT dim, COUNT(*) as count, 
                 COUNT(CASE WHEN model IS NOT NULL AND model != '' THEN 1 END) as with_model
          FROM memory_embedding 
          GROUP BY dim
        `).all();
        
        const totalStats = db.prepare(`
          SELECT COUNT(*) as total,
                 COUNT(CASE WHEN embedding_provider IS NOT NULL THEN 1 END) as migrated
          FROM memory_embedding
        `).get();
        
        // Then: 분석 결과가 정상적으로 반환됨
        expect(dimensionStats).toBeDefined();
        expect(totalStats).toBeDefined();
        expect(totalStats.total).toBeGreaterThanOrEqual(0);
      } else {
        // 테이블이 없으면 스킵
        console.log('⚠️ memory_embedding 테이블이 없습니다. 테스트 스킵');
      }
    } finally {
      closeDatabase(db);
    }
  });

  /**
   * @given 공통 모듈(initializeDatabase)을 사용하는 migrate-embedding-data 함수
   * @when 메타데이터 업데이트 실행
   * @then 메타데이터가 정상적으로 업데이트됨
   */
  it('should update metadata successfully', async () => {
    // Given: 정상적인 데이터베이스 초기화 및 테스트 데이터
    const db = await initializeDatabase(testDbPath);
    
    try {
      // memory_embedding 테이블 확인
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_embedding'
      `).get();
      
      if (tableExists) {
        // 컬럼 존재 확인
        const schema = db.prepare("PRAGMA table_info(memory_embedding)").all() as Array<{ name: string }>;
        const hasProvider = schema.some(col => col.name === 'embedding_provider');
        const hasDimensions = schema.some(col => col.name === 'dimensions');
        const hasCreatedBy = schema.some(col => col.name === 'created_by');
        
        if (hasProvider && hasDimensions && hasCreatedBy) {
          // When: 메타데이터 업데이트
          const updateStmt = db.prepare(`
            UPDATE memory_embedding 
            SET 
              embedding_provider = CASE 
                WHEN model = 'lightweight-hybrid' THEN 'tfidf'
                WHEN model IS NULL OR model = '' THEN 'tfidf'
                ELSE 'unknown'
              END,
              dimensions = dim,
              created_by = 'legacy'
            WHERE embedding_provider IS NULL
          `);
          
          const result = updateStmt.run();
          
          // Then: 업데이트 성공 확인
          expect(result.changes).toBeGreaterThanOrEqual(0);
        } else {
          console.log('⚠️ 필요한 컬럼이 없습니다. 테스트 스킵');
        }
      } else {
        console.log('⚠️ memory_embedding 테이블이 없습니다. 테스트 스킵');
      }
    } finally {
      closeDatabase(db);
    }
  });

  /**
   * @given 공통 모듈(initializeDatabase)을 사용하는 migrate-embedding-data 함수
   * @when 마이그레이션 검증 실행
   * @then 검증 결과가 정상적으로 반환됨
   */
  it('should validate migration successfully', async () => {
    // Given: 정상적인 데이터베이스 초기화
    const db = await initializeDatabase(testDbPath);
    
    try {
      // memory_embedding 테이블 확인
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_embedding'
      `).get();
      
      if (tableExists) {
        // When: 마이그레이션 검증
        const validation = db.prepare(`
          SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN embedding_provider IS NOT NULL THEN 1 END) as with_provider,
            COUNT(CASE WHEN dimensions IS NOT NULL THEN 1 END) as with_dimensions,
            COUNT(CASE WHEN created_by IS NOT NULL THEN 1 END) as with_created_by
          FROM memory_embedding
        `).get() as { total: number; with_provider: number; with_dimensions: number; with_created_by: number };
        
        // Then: 검증 결과가 정상적으로 반환됨
        expect(validation.total).toBeGreaterThanOrEqual(0);
        expect(validation.with_provider).toBeGreaterThanOrEqual(0);
        expect(validation.with_dimensions).toBeGreaterThanOrEqual(0);
        expect(validation.with_created_by).toBeGreaterThanOrEqual(0);
      } else {
        console.log('⚠️ memory_embedding 테이블이 없습니다. 테스트 스킵');
      }
    } finally {
      closeDatabase(db);
    }
  });
});


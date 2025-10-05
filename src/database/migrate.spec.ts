import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { migrateDatabase } from './migrate.js';
import Database from 'better-sqlite3';
import { mementoConfig } from '../config/index.js';

// Mock dependencies
vi.mock('better-sqlite3');
vi.mock('../config/index.js', () => ({
  mementoConfig: {
    dbPath: './test-data/test.db'
  }
}));

describe('Database Migration', () => {
  let mockDb: any;
  let consoleSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock database instance
    mockDb = {
      exec: vi.fn(),
      close: vi.fn()
    };

    vi.mocked(Database).mockImplementation(() => mockDb);
    
    // Mock console
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {})
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('migrateDatabase', () => {
    it('데이터베이스 마이그레이션을 실행해야 함', () => {
      migrateDatabase();

      expect(mockDb.exec).toHaveBeenCalled();
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('사용성 통계 컬럼을 추가해야 함', () => {
      migrateDatabase();

      expect(mockDb.exec).toHaveBeenCalledWith('ALTER TABLE memory_item ADD COLUMN view_count INTEGER DEFAULT 0');
      expect(mockDb.exec).toHaveBeenCalledWith('ALTER TABLE memory_item ADD COLUMN cite_count INTEGER DEFAULT 0');
      expect(mockDb.exec).toHaveBeenCalledWith('ALTER TABLE memory_item ADD COLUMN edit_count INTEGER DEFAULT 0');
    });

    it('임베딩 테이블을 생성해야 함', () => {
      migrateDatabase();

      const embeddingTableCall = mockDb.exec.mock.calls.find(call => 
        call[0].includes('CREATE TABLE IF NOT EXISTS memory_embedding')
      );
      
      expect(embeddingTableCall).toBeDefined();
      expect(embeddingTableCall[0]).toContain('memory_id TEXT NOT NULL');
      expect(embeddingTableCall[0]).toContain('embedding TEXT NOT NULL');
    });

    it('기존 데이터를 업데이트해야 함', () => {
      migrateDatabase();

      const updateCall = mockDb.exec.mock.calls.find(call => 
        call[0].includes('UPDATE memory_item')
      );
      
      expect(updateCall).toBeDefined();
      expect(updateCall[0]).toContain('SET view_count = 0, cite_count = 0, edit_count = 0');
    });

    it('성공 메시지를 출력해야 함', () => {
      migrateDatabase();

      expect(consoleSpy.log).toHaveBeenCalledWith('🔄 데이터베이스 마이그레이션 시작');
      expect(consoleSpy.log).toHaveBeenCalledWith('📊 사용성 통계 컬럼 추가 중...');
      expect(consoleSpy.log).toHaveBeenCalledWith('✅ 사용성 통계 컬럼 추가 완료');
      expect(consoleSpy.log).toHaveBeenCalledWith('🧠 임베딩 테이블 생성 중...');
      expect(consoleSpy.log).toHaveBeenCalledWith('✅ 임베딩 테이블 생성 완료');
      expect(consoleSpy.log).toHaveBeenCalledWith('🔧 기존 데이터 업데이트 중...');
      expect(consoleSpy.log).toHaveBeenCalledWith('✅ 기존 데이터 업데이트 완료');
      expect(consoleSpy.log).toHaveBeenCalledWith('🎉 데이터베이스 마이그레이션 완료!');
    });

    it('중복 컬럼 에러를 무시해야 함', () => {
      mockDb.exec.mockImplementation((sql: string) => {
        if (sql.includes('ALTER TABLE memory_item ADD COLUMN')) {
          throw new Error('duplicate column name: view_count');
        }
      });

      expect(() => migrateDatabase()).not.toThrow();
    });

    it('에러 발생 시 에러 메시지를 출력하고 에러를 던져야 함', () => {
      mockDb.exec.mockImplementation(() => {
        throw new Error('Migration failed');
      });

      expect(() => migrateDatabase()).toThrow('Migration failed');
      expect(consoleSpy.error).toHaveBeenCalledWith('❌ 마이그레이션 실패:', expect.any(Error));
    });
  });
});
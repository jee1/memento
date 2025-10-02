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
      close: vi.fn(),
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        all: vi.fn(),
        get: vi.fn()
      })
    };

    vi.mocked(Database).mockImplementation(() => mockDb);
    
    // Mock console methods
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {})
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('migrateDatabase', () => {
    it('마이그레이션을 성공적으로 실행해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      expect(Database).toHaveBeenCalledWith('./test-data/test.db');
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('사용성 통계 컬럼을 추가해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      expect(mockDb.exec).toHaveBeenCalledWith('ALTER TABLE memory_item ADD COLUMN view_count INTEGER DEFAULT 0');
      expect(mockDb.exec).toHaveBeenCalledWith('ALTER TABLE memory_item ADD COLUMN cite_count INTEGER DEFAULT 0');
      expect(mockDb.exec).toHaveBeenCalledWith('ALTER TABLE memory_item ADD COLUMN edit_count INTEGER DEFAULT 0');
    });

    it('중복 컬럼 에러를 무시해야 함', () => {
      mockDb.exec.mockImplementation((sql: string) => {
        if (sql.includes('view_count')) {
          throw new Error('duplicate column name: view_count');
        }
        if (sql.includes('cite_count')) {
          throw new Error('duplicate column name: cite_count');
        }
        if (sql.includes('edit_count')) {
          throw new Error('duplicate column name: edit_count');
        }
      });

      expect(() => migrateDatabase()).not.toThrow();
    });

    it('중복 컬럼이 아닌 다른 에러는 던져야 함', () => {
      mockDb.exec.mockImplementation((sql: string) => {
        if (sql.includes('view_count')) {
          throw new Error('table not found');
        }
      });

      expect(() => migrateDatabase()).toThrow('table not found');
    });

    it('임베딩 테이블을 생성해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS memory_embedding'));
    });

    it('임베딩 인덱스를 생성해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id'));
      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_memory_embedding_model'));
    });

    it('링크 테이블을 생성해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS memory_link'));
    });

    it('링크 인덱스를 생성해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_memory_link_source'));
      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_memory_link_target'));
    });

    it('피드백 테이블을 생성해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS memory_feedback'));
    });

    it('피드백 인덱스를 생성해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_memory_feedback_memory_id'));
      expect(mockDb.exec).toHaveBeenCalledWith(expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_memory_feedback_event_type'));
    });

    it('성공 메시지를 출력해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      expect(consoleSpy.log).toHaveBeenCalledWith('🔄 데이터베이스 마이그레이션 시작');
      expect(consoleSpy.log).toHaveBeenCalledWith('📊 사용성 통계 컬럼 추가 중...');
      expect(consoleSpy.log).toHaveBeenCalledWith('✅ 사용성 통계 컬럼 추가 완료');
      expect(consoleSpy.log).toHaveBeenCalledWith('🧠 임베딩 테이블 생성 중...');
      expect(consoleSpy.log).toHaveBeenCalledWith('✅ 임베딩 테이블 생성 완료');
      expect(consoleSpy.log).toHaveBeenCalledWith('🔗 링크 테이블 생성 중...');
      expect(consoleSpy.log).toHaveBeenCalledWith('✅ 링크 테이블 생성 완료');
      expect(consoleSpy.log).toHaveBeenCalledWith('💬 피드백 테이블 생성 중...');
      expect(consoleSpy.log).toHaveBeenCalledWith('✅ 피드백 테이블 생성 완료');
      expect(consoleSpy.log).toHaveBeenCalledWith('🎉 데이터베이스 마이그레이션 완료');
    });

    it('에러 발생 시 에러 메시지를 출력하고 에러를 던져야 함', () => {
      const error = new Error('Migration failed');
      mockDb.exec.mockImplementation(() => {
        throw error;
      });

      expect(() => migrateDatabase()).toThrow('Migration failed');
      expect(consoleSpy.error).toHaveBeenCalledWith('❌ 데이터베이스 마이그레이션 실패:', error);
    });

    it('데이터베이스 연결 실패 시 에러를 던져야 함', () => {
      vi.mocked(Database).mockImplementation(() => {
        throw new Error('Connection failed');
      });

      expect(() => migrateDatabase()).toThrow('Connection failed');
    });

    it('마이그레이션 완료 후 데이터베이스를 닫아야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      expect(mockDb.close).toHaveBeenCalled();
    });

    it('에러 발생 시에도 데이터베이스를 닫아야 함', () => {
      mockDb.exec.mockImplementation(() => {
        throw new Error('Migration failed');
      });

      try {
        migrateDatabase();
      } catch (error) {
        // Expected error
      }

      expect(mockDb.close).toHaveBeenCalled();
    });
  });

  describe('테이블 생성', () => {
    it('임베딩 테이블에 올바른 컬럼을 포함해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      const embeddingTableCall = mockDb.exec.mock.calls.find(call => 
        call[0].includes('CREATE TABLE IF NOT EXISTS memory_embedding')
      );

      expect(embeddingTableCall).toBeDefined();
      expect(embeddingTableCall[0]).toContain('memory_id TEXT NOT NULL');
      expect(embeddingTableCall[0]).toContain('embedding BLOB NOT NULL');
      expect(embeddingTableCall[0]).toContain('model TEXT NOT NULL');
      expect(embeddingTableCall[0]).toContain('created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    });

    it('링크 테이블에 올바른 컬럼을 포함해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      const linkTableCall = mockDb.exec.mock.calls.find(call => 
        call[0].includes('CREATE TABLE IF NOT EXISTS memory_link')
      );

      expect(linkTableCall).toBeDefined();
      expect(linkTableCall[0]).toContain('source_id TEXT NOT NULL');
      expect(linkTableCall[0]).toContain('target_id TEXT NOT NULL');
      expect(linkTableCall[0]).toContain('relation_type TEXT NOT NULL');
      expect(linkTableCall[0]).toContain('created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    });

    it('피드백 테이블에 올바른 컬럼을 포함해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      const feedbackTableCall = mockDb.exec.mock.calls.find(call => 
        call[0].includes('CREATE TABLE IF NOT EXISTS memory_feedback')
      );

      expect(feedbackTableCall).toBeDefined();
      expect(feedbackTableCall[0]).toContain('memory_id TEXT NOT NULL');
      expect(feedbackTableCall[0]).toContain('event_type TEXT NOT NULL');
      expect(feedbackTableCall[0]).toContain('score REAL');
      expect(feedbackTableCall[0]).toContain('created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    });
  });

  describe('인덱스 생성', () => {
    it('임베딩 테이블에 필요한 인덱스를 생성해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      const indexCalls = mockDb.exec.mock.calls.filter(call => 
        call[0].includes('CREATE INDEX IF NOT EXISTS idx_memory_embedding')
      );

      expect(indexCalls).toHaveLength(2);
      expect(indexCalls.some(call => call[0].includes('memory_id'))).toBe(true);
      expect(indexCalls.some(call => call[0].includes('model'))).toBe(true);
    });

    it('링크 테이블에 필요한 인덱스를 생성해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      const indexCalls = mockDb.exec.mock.calls.filter(call => 
        call[0].includes('CREATE INDEX IF NOT EXISTS idx_memory_link')
      );

      expect(indexCalls).toHaveLength(2);
      expect(indexCalls.some(call => call[0].includes('source_id'))).toBe(true);
      expect(indexCalls.some(call => call[0].includes('target_id'))).toBe(true);
    });

    it('피드백 테이블에 필요한 인덱스를 생성해야 함', () => {
      mockDb.exec.mockImplementation(() => {});

      migrateDatabase();

      const indexCalls = mockDb.exec.mock.calls.filter(call => 
        call[0].includes('CREATE INDEX IF NOT EXISTS idx_memory_feedback')
      );

      expect(indexCalls).toHaveLength(2);
      expect(indexCalls.some(call => call[0].includes('memory_id'))).toBe(true);
      expect(indexCalls.some(call => call[0].includes('event_type'))).toBe(true);
    });
  });
});

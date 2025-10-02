import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { initializeDatabase } from './init.js';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { mementoConfig } from '../config/index.js';

// Mock dependencies
vi.mock('better-sqlite3');
vi.mock('fs');
vi.mock('../config/index.js', () => ({
  mementoConfig: {
    dbPath: './test-data/test.db'
  }
}));

// Mock file system
const mockMkdirSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync
}));

// Mock path and url modules
vi.mock('path', () => ({
  join: vi.fn((...args) => args.join('/')),
  dirname: vi.fn((path) => path.split('/').slice(0, -1).join('/'))
}));

vi.mock('url', () => ({
  fileURLToPath: vi.fn(() => '/test/path/init.js')
}));

describe('Database Init', () => {
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock database instance
    mockDb = {
      pragma: vi.fn(),
      loadExtension: vi.fn(),
      exec: vi.fn(),
      close: vi.fn(),
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        all: vi.fn(),
        get: vi.fn()
      })
    };

    vi.mocked(Database).mockImplementation(() => mockDb);
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockImplementation(() => {});
    vi.mocked(readFileSync).mockReturnValue('CREATE TABLE test (id INTEGER PRIMARY KEY);');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initializeDatabase', () => {
    it('데이터베이스를 성공적으로 초기화해야 함', () => {
      const result = initializeDatabase();

      expect(result).toBe(mockDb);
      expect(Database).toHaveBeenCalledWith('./test-data/test.db');
    });

    it('데이터 디렉토리를 생성해야 함', () => {
      mockExistsSync.mockReturnValue(false);

      initializeDatabase();

      expect(mockMkdirSync).toHaveBeenCalledWith('./test-data', { recursive: true });
    });

    it('디렉토리가 이미 존재하면 생성하지 않아야 함', () => {
      mockExistsSync.mockReturnValue(true);

      initializeDatabase();

      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it('WAL 모드를 활성화해야 함', () => {
      initializeDatabase();

      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
    });

    it('외래키 제약 조건을 활성화해야 함', () => {
      initializeDatabase();

      expect(mockDb.pragma).toHaveBeenCalledWith('foreign_keys = ON');
    });

    it('프로덕션 환경에서 FTS5 확장을 로드하지 않아야 함', () => {
      process.env.NODE_ENV = 'production';

      initializeDatabase();

      expect(mockDb.loadExtension).not.toHaveBeenCalled();
    });

    it('Docker 환경에서 FTS5 확장을 로드하지 않아야 함', () => {
      process.env.DOCKER = 'true';

      initializeDatabase();

      expect(mockDb.loadExtension).not.toHaveBeenCalled();
    });

    it('로컬 환경에서 FTS5 확장을 로드해야 함', () => {
      process.env.NODE_ENV = 'development';
      process.env.DOCKER = 'false';

      initializeDatabase();

      expect(mockDb.loadExtension).toHaveBeenCalledWith('fts5');
    });

    it('FTS5 로드 실패 시 경고를 출력해야 함', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockDb.loadExtension.mockImplementation(() => {
        throw new Error('FTS5 not available');
      });

      initializeDatabase();

      expect(consoleSpy).toHaveBeenCalledWith('⚠️ FTS5 확장을 로드할 수 없습니다. 텍스트 검색 기능이 제한될 수 있습니다.');
    });

    it('스키마 파일을 읽고 실행해야 함', () => {
      initializeDatabase();

      expect(readFileSync).toHaveBeenCalled();
      expect(mockDb.exec).toHaveBeenCalledWith('CREATE TABLE test (id INTEGER PRIMARY KEY);');
    });

    it('스키마 파일 읽기 실패 시 에러를 던져야 함', () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });

      expect(() => initializeDatabase()).toThrow('스키마 파일을 읽을 수 없습니다');
    });

    it('데이터베이스 초기화 실패 시 에러를 던져야 함', () => {
      vi.mocked(Database).mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      expect(() => initializeDatabase()).toThrow('Database connection failed');
    });

    it('디렉토리 생성 실패 시 에러를 무시해야 함', () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // 에러가 발생하지 않아야 함
      expect(() => initializeDatabase()).not.toThrow();
    });

    it('환경 변수에 따라 다른 동작을 해야 함', () => {
      process.env.NODE_ENV = 'test';
      process.env.DOCKER = 'false';

      initializeDatabase();

      expect(mockDb.loadExtension).toHaveBeenCalledWith('fts5');
    });
  });

  describe('데이터베이스 설정', () => {
    it('올바른 데이터베이스 경로를 사용해야 함', () => {
      initializeDatabase();

      expect(Database).toHaveBeenCalledWith('./test-data/test.db');
    });

    it('데이터베이스 연결 후 설정을 적용해야 함', () => {
      initializeDatabase();

      expect(mockDb.pragma).toHaveBeenCalledWith('journal_mode = WAL');
      expect(mockDb.pragma).toHaveBeenCalledWith('foreign_keys = ON');
    });
  });

  describe('에러 처리', () => {
    it('스키마 실행 실패 시 에러를 던져야 함', () => {
      mockDb.exec.mockImplementation(() => {
        throw new Error('SQL execution failed');
      });

      expect(() => initializeDatabase()).toThrow('데이터베이스 초기화에 실패했습니다');
    });

    it('데이터베이스 연결 실패 시 적절한 에러를 던져야 함', () => {
      vi.mocked(Database).mockImplementation(() => {
        throw new Error('Connection failed');
      });

      expect(() => initializeDatabase()).toThrow('Connection failed');
    });
  });

  describe('환경별 동작', () => {
    it('개발 환경에서 FTS5를 로드해야 함', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DOCKER;

      initializeDatabase();

      expect(mockDb.loadExtension).toHaveBeenCalledWith('fts5');
    });

    it('프로덕션 환경에서 FTS5를 로드하지 않아야 함', () => {
      process.env.NODE_ENV = 'production';

      initializeDatabase();

      expect(mockDb.loadExtension).not.toHaveBeenCalled();
    });

    it('Docker 환경에서 FTS5를 로드하지 않아야 함', () => {
      process.env.DOCKER = 'true';

      initializeDatabase();

      expect(mockDb.loadExtension).not.toHaveBeenCalled();
    });
  });
});

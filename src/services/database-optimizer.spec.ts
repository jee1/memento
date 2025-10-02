import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DatabaseOptimizer, IndexRecommendation, QueryAnalysis, DatabaseStats } from './database-optimizer.js';
import { DatabaseUtils } from '../utils/database.js';
import Database from 'better-sqlite3';

// Mock DatabaseUtils
vi.mock('../utils/database.js', () => ({
  DatabaseUtils: {
    all: vi.fn(),
    run: vi.fn()
  }
}));

describe('DatabaseOptimizer', () => {
  let optimizer: DatabaseOptimizer;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {} as Database.Database;
    optimizer = new DatabaseOptimizer(mockDb);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with database instance', () => {
      expect(optimizer).toBeInstanceOf(DatabaseOptimizer);
    });
  });

  describe('analyzePerformance', () => {
    it('should analyze database performance and return stats', async () => {
      // Mock table analysis
      vi.mocked(DatabaseUtils.all).mockImplementation((db, query) => {
        if (query.includes('SELECT name FROM sqlite_master')) {
          return Promise.resolve([{ name: 'memory_item' }, { name: 'memory_embedding' }]);
        }
        if (query.includes('SELECT COUNT(*) as count FROM memory_item')) {
          return Promise.resolve([{ count: 100 }]);
        }
        if (query.includes('SELECT COUNT(*) as count FROM memory_embedding')) {
          return Promise.resolve([{ count: 50 }]);
        }
        if (query.includes('SELECT page_count * page_size as size')) {
          return Promise.resolve([{ size: 1024000 }]);
        }
        if (query.includes('SELECT COUNT(*) as count FROM sqlite_master WHERE type = \'index\'')) {
          return Promise.resolve([{ count: 3 }]);
        }
        if (query.includes('SELECT name, tbl_name, sql FROM sqlite_master WHERE type = \'index\'')) {
          return Promise.resolve([
            { name: 'idx_memory_item_id', tbl_name: 'memory_item', sql: 'CREATE INDEX idx_memory_item_id ON memory_item (id)' }
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await optimizer.analyzePerformance();

      expect(result).toHaveProperty('tableStats');
      expect(result).toHaveProperty('indexStats');
      expect(result).toHaveProperty('queryStats');
      expect(result.tableStats).toHaveProperty('memory_item');
      expect(result.tableStats).toHaveProperty('memory_embedding');
    });
  });

  describe('generateIndexRecommendations', () => {
    it('should generate index recommendations based on query patterns', async () => {
      // Mock query history
      (optimizer as any).queryHistory.set('SELECT * FROM memory_item WHERE type = ?', {
        count: 15,
        totalTime: 500,
        lastUsed: new Date()
      });

      const recommendations = await optimizer.generateIndexRecommendations();

      expect(Array.isArray(recommendations)).toBe(true);
      recommendations.forEach(rec => {
        expect(rec).toHaveProperty('table');
        expect(rec).toHaveProperty('columns');
        expect(rec).toHaveProperty('type');
        expect(rec).toHaveProperty('priority');
        expect(rec).toHaveProperty('reason');
        expect(rec).toHaveProperty('estimatedImprovement');
      });
    });

    it('should prioritize high-frequency queries', async () => {
      // Mock high-frequency query
      (optimizer as any).queryHistory.set('SELECT * FROM memory_item WHERE type = ? AND privacy_scope = ?', {
        count: 60,
        totalTime: 2000,
        lastUsed: new Date()
      });

      const recommendations = await optimizer.generateIndexRecommendations();

      const highPriorityRecs = recommendations.filter(rec => rec.priority === 'high');
      expect(highPriorityRecs.length).toBeGreaterThan(0);
    });
  });

  describe('recordQuery', () => {
    it('should record query execution statistics', () => {
      const query = 'SELECT * FROM memory_item WHERE id = ?';
      const executionTime = 25;

      optimizer.recordQuery(query, executionTime);

      const history = (optimizer as any).queryHistory;
      expect(history.has(query)).toBe(true);
      expect(history.get(query)).toEqual({
        count: 1,
        totalTime: executionTime,
        lastUsed: expect.any(Date)
      });
    });

    it('should update existing query statistics', () => {
      const query = 'SELECT * FROM memory_item WHERE id = ?';
      
      optimizer.recordQuery(query, 25);
      optimizer.recordQuery(query, 30);

      const history = (optimizer as any).queryHistory;
      const stats = history.get(query);
      expect(stats.count).toBe(2);
      expect(stats.totalTime).toBe(55);
    });
  });

  describe('createIndex', () => {
    it('should create a new index', async () => {
      vi.mocked(DatabaseUtils.run).mockResolvedValue(undefined);

      await optimizer.createIndex('test_index', 'memory_item', ['type', 'privacy_scope']);

      expect(DatabaseUtils.run).toHaveBeenCalledWith(
        mockDb,
        'CREATE INDEX IF NOT EXISTS test_index ON memory_item (type, privacy_scope)'
      );
    });

    it('should create a unique index when specified', async () => {
      vi.mocked(DatabaseUtils.run).mockResolvedValue(undefined);

      await optimizer.createIndex('unique_index', 'memory_item', ['id'], true);

      expect(DatabaseUtils.run).toHaveBeenCalledWith(
        mockDb,
        'CREATE UNIQUE INDEX IF NOT EXISTS unique_index ON memory_item (id)'
      );
    });
  });

  describe('dropIndex', () => {
    it('should drop an existing index', async () => {
      vi.mocked(DatabaseUtils.run).mockResolvedValue(undefined);

      await optimizer.dropIndex('test_index');

      expect(DatabaseUtils.run).toHaveBeenCalledWith(
        mockDb,
        'DROP INDEX IF EXISTS test_index'
      );
    });
  });

  describe('analyzeDatabase', () => {
    it('should run database analysis', async () => {
      vi.mocked(DatabaseUtils.run).mockResolvedValue(undefined);

      await optimizer.analyzeDatabase();

      expect(DatabaseUtils.run).toHaveBeenCalledWith(mockDb, 'ANALYZE');
    });
  });

  describe('generateOptimizationReport', () => {
    it('should generate a comprehensive optimization report', async () => {
      // Mock analyzePerformance
      vi.spyOn(optimizer, 'analyzePerformance').mockResolvedValue({
        tableStats: {
          memory_item: {
            rowCount: 100,
            size: 1024000,
            indexCount: 3,
            lastAnalyzed: new Date()
          }
        },
        indexStats: {
          idx_memory_item_id: {
            name: 'idx_memory_item_id',
            table: 'memory_item',
            columns: ['id'],
            size: 512000,
            usage: 0
          }
        },
        queryStats: {
          totalQueries: 50,
          averageTime: 25.5,
          slowQueries: []
        }
      });

      // Mock generateIndexRecommendations
      vi.spyOn(optimizer, 'generateIndexRecommendations').mockResolvedValue([
        {
          table: 'memory_item',
          columns: ['type'],
          type: 'btree',
          priority: 'high',
          reason: '자주 사용되는 필터 조건 (15회)',
          estimatedImprovement: '50-80% 쿼리 성능 향상 예상'
        }
      ]);

      const report = await optimizer.generateOptimizationReport();

      expect(report).toContain('데이터베이스 성능 최적화 리포트');
      expect(report).toContain('memory_item');
      expect(report).toContain('인덱스 추천');
      expect(report).toContain('자주 사용되는 필터 조건');
    });
  });

  describe('private methods', () => {
    describe('extractColumnsFromQuery', () => {
      it('should extract columns from WHERE clause', () => {
        const query = 'SELECT * FROM memory_item WHERE type = ? AND privacy_scope = ?';
        const columns = (optimizer as any).extractColumnsFromQuery(query);
        
        expect(columns).toContain('type');
        expect(columns).toContain('privacy_scope');
      });

      it('should extract columns from ORDER BY clause', () => {
        const query = 'SELECT * FROM memory_item ORDER BY created_at DESC, id ASC';
        const columns = (optimizer as any).extractColumnsFromQuery(query);
        
        expect(columns).toContain('created_at');
        expect(columns).toContain('id');
      });
    });

    describe('extractColumnFromCondition', () => {
      it('should extract column from equality condition', () => {
        const condition = 'type = ?';
        const column = (optimizer as any).extractColumnFromCondition(condition);
        
        expect(column).toBe('type');
      });

      it('should extract column from comparison condition', () => {
        const condition = 'created_at > ?';
        const column = (optimizer as any).extractColumnFromCondition(condition);
        
        expect(column).toBe('created_at');
      });

      it('should return null for invalid condition', () => {
        const condition = 'invalid condition';
        const column = (optimizer as any).extractColumnFromCondition(condition);
        
        expect(column).toBeNull();
      });
    });

    describe('extractColumnsFromIndexSQL', () => {
      it('should extract columns from index SQL', () => {
        const sql = 'CREATE INDEX idx_test ON table_name (col1, col2)';
        const columns = (optimizer as any).extractColumnsFromIndexSQL(sql);
        
        expect(columns).toEqual(['col1', 'col2']);
      });

      it('should return empty array for invalid SQL', () => {
        const sql = 'CREATE INDEX idx_test ON table_name';
        const columns = (optimizer as any).extractColumnsFromIndexSQL(sql);
        
        expect(columns).toEqual([]);
      });
    });

    describe('assessQueryComplexity', () => {
      it('should assess simple query complexity', () => {
        const query = 'SELECT * FROM memory_item WHERE id = ?';
        const complexity = (optimizer as any).assessQueryComplexity(query);
        
        expect(complexity).toBe('simple');
      });

      it('should assess medium query complexity', () => {
        const query = 'SELECT * FROM memory_item WHERE type = ? ORDER BY created_at DESC';
        const complexity = (optimizer as any).assessQueryComplexity(query);
        
        expect(complexity).toBe('medium');
      });

      it('should assess complex query complexity', () => {
        const query = 'SELECT m1.* FROM memory_item m1 JOIN memory_embedding m2 ON m1.id = m2.memory_id WHERE m1.type = ? GROUP BY m1.id HAVING COUNT(*) > 1 ORDER BY m1.created_at DESC';
        const complexity = (optimizer as any).assessQueryComplexity(query);
        
        expect(complexity).toBe('complex');
      });
    });

    describe('generateQueryRecommendations', () => {
      it('should recommend against SELECT *', () => {
        const query = 'SELECT * FROM memory_item WHERE id = ?';
        const recommendations = (optimizer as any).generateQueryRecommendations(query);
        
        expect(recommendations).toContain('SELECT * 대신 필요한 컬럼만 명시하세요');
      });

      it('should recommend index hints for ORDER BY', () => {
        const query = 'SELECT id, content FROM memory_item ORDER BY created_at DESC';
        const recommendations = (optimizer as any).generateQueryRecommendations(query);
        
        expect(recommendations).toContain('ORDER BY 절에 인덱스 힌트를 추가하세요');
      });

      it('should recommend FTS5 for LIKE patterns', () => {
        const query = 'SELECT * FROM memory_item WHERE content LIKE \'%search%\'';
        const recommendations = (optimizer as any).generateQueryRecommendations(query);
        
        expect(recommendations).toContain('LIKE \'%...\' 패턴은 인덱스를 사용할 수 없습니다. FTS5를 고려하세요');
      });

      it('should recommend JOIN for subqueries', () => {
        const query = 'SELECT * FROM memory_item WHERE id IN (SELECT memory_id FROM memory_embedding)';
        const recommendations = (optimizer as any).generateQueryRecommendations(query);
        
        expect(recommendations).toContain('서브쿼리를 JOIN으로 변경하는 것을 고려하세요');
      });
    });
  });
});

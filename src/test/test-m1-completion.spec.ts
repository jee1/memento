import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';
import { getHybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { getVectorSearchEngine } from '../algorithms/vector-search-engine.js';
import { getPerformanceMonitor } from '../services/performance-monitor.js';
import { getBatchScheduler } from '../services/batch-scheduler.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { ForgettingPolicyService } from '../services/forgetting-policy-service.js';
import { MemoryInjectionPrompt } from '../tools/memory-injection-prompt.js';

// Mock external dependencies
vi.mock('../services/memory-embedding-service.js');
vi.mock('../services/forgetting-policy-service.js');

describe('M1 완성도 테스트', () => {
  let db: Database.Database;
  let hybridSearchEngine: any;
  let vectorSearchEngine: any;
  let performanceMonitor: any;
  let batchScheduler: any;
  let embeddingService: any;
  let forgettingService: any;
  let memoryInjectionPrompt: MemoryInjectionPrompt;

  beforeEach(async () => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    
    // Initialize database schema
    await DatabaseUtils.initializeDatabase(db);
    
    // Initialize services
    hybridSearchEngine = getHybridSearchEngine();
    vectorSearchEngine = getVectorSearchEngine();
    performanceMonitor = getPerformanceMonitor();
    batchScheduler = getBatchScheduler({
      cleanupInterval: 1000,
      monitoringInterval: 500,
      enableLogging: false
    });
    memoryInjectionPrompt = new MemoryInjectionPrompt();

    // Mock embedding service
    embeddingService = {
      isAvailable: vi.fn().mockReturnValue(true),
      generateEmbedding: vi.fn().mockResolvedValue(Array(1536).fill(0.1)),
      searchBySimilarity: vi.fn().mockResolvedValue([]),
      getEmbeddingStats: vi.fn().mockResolvedValue({ totalEmbeddings: 0, averageSimilarity: 0 })
    };
    vi.mocked(MemoryEmbeddingService).mockImplementation(() => embeddingService);

    // Mock forgetting service
    forgettingService = {
      executeMemoryCleanup: vi.fn().mockResolvedValue({
        softDeleted: [],
        hardDeleted: [],
        reviewed: [],
        totalProcessed: 0
      })
    };
    vi.mocked(ForgettingPolicyService).mockImplementation(() => forgettingService);

    // Initialize services
    vectorSearchEngine.initialize(db);
    performanceMonitor.initialize(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    batchScheduler.stop();
    vi.clearAllMocks();
  });

  describe('M1 핵심 기능 완성도', () => {
    it('should have all required database tables', () => {
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as { name: string }[];

      const tableNames = tables.map(t => t.name);
      const requiredTables = [
        'memory_item',
        'memory_embedding', 
        'memory_tag',
        'memory_item_tag',
        'memory_link',
        'feedback_event',
        'wm_buffer'
      ];

      requiredTables.forEach(tableName => {
        expect(tableNames).toContain(tableName);
      });
    });

    it('should have all required virtual tables', () => {
      const virtualTables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND (name LIKE '%_fts' OR name LIKE '%_vss')
        ORDER BY name
      `).all() as { name: string }[];

      const virtualTableNames = virtualTables.map(t => t.name);
      
      expect(virtualTableNames).toContain('memory_item_fts');
      expect(virtualTableNames).toContain('memory_item_vec');
    });

    it('should have all required indexes', () => {
      const indexes = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all() as { name: string }[];

      const indexNames = indexes.map(i => i.name);
      const requiredIndexes = [
        'idx_memory_item_type',
        'idx_memory_item_created_at',
        'idx_memory_item_last_accessed',
        'idx_memory_item_importance',
        'idx_memory_item_pinned',
        'idx_memory_item_user_id',
        'idx_memory_item_project_id'
      ];

      requiredIndexes.forEach(indexName => {
        expect(indexNames).toContain(indexName);
      });
    });
  });

  describe('M1 메모리 관리 기능', () => {
    it('should support all memory types', () => {
      const memoryTypes = ['working', 'episodic', 'semantic', 'procedural'];
      
      memoryTypes.forEach(type => {
        const result = db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
          VALUES (?, ?, ?, ?, 'private', datetime('now'))
        `).run(`test-${type}`, type, `Test ${type} memory`, 0.5);
        
        expect(result.changes).toBe(1);
      });

      // 검증
      const count = db.prepare('SELECT COUNT(*) as count FROM memory_item').get() as { count: number };
      expect(count.count).toBe(4);
    });

    it('should support all privacy scopes', () => {
      const privacyScopes = ['private', 'team', 'public'];
      
      privacyScopes.forEach(scope => {
        const result = db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
          VALUES (?, 'episodic', 'Test memory', 0.5, ?, datetime('now'))
        `).run(`test-${scope}`, scope);
        
        expect(result.changes).toBe(1);
      });

      // 검증
      const count = db.prepare('SELECT COUNT(*) as count FROM memory_item').get() as { count: number };
      expect(count.count).toBe(3);
    });

    it('should support memory pinning', () => {
      const result = db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
        VALUES (?, 'episodic', 'Pinned memory', 0.8, 'private', datetime('now'), 1)
      `).run('pinned-test');

      expect(result.changes).toBe(1);

      // 검증
      const memory = db.prepare('SELECT * FROM memory_item WHERE id = ?').get('pinned-test') as any;
      expect(memory.pinned).toBe(1);
    });

    it('should support memory tags', () => {
      // 메모리 저장
      db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, 'episodic', 'Tagged memory', 0.5, 'private', datetime('now'))
      `).run('tagged-test');

      // 태그 저장
      const tagResult = db.prepare(`
        INSERT INTO memory_tag (name) VALUES (?)
      `).run('test-tag');

      // 메모리-태그 관계 저장
      const relationResult = db.prepare(`
        INSERT INTO memory_item_tag (memory_id, tag_id) VALUES (?, ?)
      `).run('tagged-test', tagResult.lastInsertRowid);

      expect(relationResult.changes).toBe(1);
    });

    it('should support memory links', () => {
      // 두 메모리 저장
      db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, 'episodic', 'Source memory', 0.5, 'private', datetime('now'))
      `).run('source-memory');

      db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
        VALUES (?, 'semantic', 'Target memory', 0.7, 'private', datetime('now'))
      `).run('target-memory');

      // 메모리 링크 저장
      const linkResult = db.prepare(`
        INSERT INTO memory_link (source_id, target_id, relation_type)
        VALUES (?, ?, ?)
      `).run('source-memory', 'target-memory', 'derived_from');

      expect(linkResult.changes).toBe(1);
    });
  });

  describe('M1 검색 기능 완성도', () => {
    beforeEach(() => {
      // 테스트 데이터 준비
      const testMemories = [
        {
          id: 'search-test-1',
          type: 'episodic',
          content: 'React Hook을 사용한 상태 관리 방법',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 'search-test-2',
          type: 'semantic',
          content: 'JavaScript 클로저의 개념과 활용',
          importance: 0.9,
          created_at: '2024-01-02T00:00:00Z'
        },
        {
          id: 'search-test-3',
          type: 'procedural',
          content: 'TypeScript 프로젝트 설정 절차',
          importance: 0.7,
          created_at: '2024-01-03T00:00:00Z'
        }
      ];

      testMemories.forEach(memory => {
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
          VALUES (?, ?, ?, ?, 'private', ?, 0)
        `).run(
          memory.id,
          memory.type,
          memory.content,
          memory.importance,
          memory.created_at
        );
      });
    });

    it('should perform text search', async () => {
      const searchResult = await hybridSearchEngine.search(db, {
        query: 'React Hook',
        limit: 10
      });

      expect(searchResult).toHaveProperty('items');
      expect(searchResult).toHaveProperty('total_count');
      expect(searchResult).toHaveProperty('query_time');
      expect(Array.isArray(searchResult.items)).toBe(true);
    });

    it('should perform vector search', async () => {
      const queryVector = Array(1536).fill(0.1);
      const searchResult = await vectorSearchEngine.search(queryVector, {
        limit: 10,
        threshold: 0.5
      });

      expect(Array.isArray(searchResult)).toBe(true);
    });

    it('should perform hybrid search with filters', async () => {
      const searchResult = await hybridSearchEngine.search(db, {
        query: 'JavaScript',
        filters: {
          type: ['semantic', 'procedural']
        },
        limit: 10
      });

      expect(searchResult.items.length).toBeGreaterThan(0);
      searchResult.items.forEach(item => {
        expect(['semantic', 'procedural']).toContain(item.type);
      });
    });

    it('should support memory injection prompt', async () => {
      const result = await memoryInjectionPrompt.execute(
        {
          query: 'React',
          token_budget: 1000,
          max_memories: 5
        },
        {
          db,
          services: { hybridSearchEngine }
        }
      );

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
    });
  });

  describe('M1 성능 모니터링 완성도', () => {
    it('should collect all required metrics', async () => {
      const metrics = await performanceMonitor.collectMetrics();
      
      // 기본 메트릭
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('uptime');
      
      // 메모리 메트릭
      expect(metrics.memory).toHaveProperty('rss');
      expect(metrics.memory).toHaveProperty('heapTotal');
      expect(metrics.memory).toHaveProperty('heapUsed');
      expect(metrics.memory).toHaveProperty('external');
      
      // CPU 메트릭
      expect(metrics.cpu).toHaveProperty('user');
      expect(metrics.cpu).toHaveProperty('system');
      
      // 데이터베이스 메트릭
      expect(metrics.database).toHaveProperty('size');
      expect(metrics.database).toHaveProperty('memoryCount');
      expect(metrics.database).toHaveProperty('queryTime');
    });

    it('should generate performance alerts', async () => {
      // 고메모리 사용량 시뮬레이션
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 0,
        heapTotal: 1000,
        heapUsed: 900, // 90% 사용률
        external: 0,
        arrayBuffers: 0
      });

      await performanceMonitor.collectMetrics();
      
      const alerts = performanceMonitor.getActiveAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      
      const memoryAlert = alerts.find(alert => alert.type === 'memory');
      expect(memoryAlert).toBeDefined();
      expect(memoryAlert?.severity).toBe('critical');

      // 원래 함수 복원
      process.memoryUsage = originalMemoryUsage;
    });

    it('should provide performance summary', () => {
      const summary = performanceMonitor.getPerformanceSummary();
      
      expect(summary).toHaveProperty('current');
      expect(summary).toHaveProperty('alerts');
      expect(summary).toHaveProperty('trends');
      
      expect(summary.alerts).toHaveProperty('active');
      expect(summary.alerts).toHaveProperty('total');
      expect(summary.trends).toHaveProperty('memoryTrend');
      expect(summary.trends).toHaveProperty('dbSizeTrend');
    });
  });

  describe('M1 배치 처리 완성도', () => {
    it('should start and stop scheduler', async () => {
      await batchScheduler.start(db);
      
      const status = batchScheduler.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.activeJobs).toContain('cleanup');
      expect(status.activeJobs).toContain('monitoring');

      batchScheduler.stop();
      
      const stoppedStatus = batchScheduler.getStatus();
      expect(stoppedStatus.isRunning).toBe(false);
      expect(stoppedStatus.activeJobs).toEqual([]);
    });

    it('should execute memory cleanup job', async () => {
      await batchScheduler.start(db);
      
      const result = await batchScheduler.runJob('cleanup');
      
      expect(result.jobType).toBe('memory_cleanup');
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('startTime');
      expect(result).toHaveProperty('endTime');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('errors');
    });

    it('should execute monitoring job', async () => {
      await batchScheduler.start(db);
      
      const result = await batchScheduler.runJob('monitoring');
      
      expect(result.jobType).toBe('monitoring');
      expect(result.success).toBe(true);
      expect(result.details).toHaveProperty('metrics');
      expect(result.details).toHaveProperty('stats');
      expect(result.details).toHaveProperty('alerts');
    });
  });

  describe('M1 벡터 검색 완성도', () => {
    it('should initialize vector search engine', () => {
      const status = vectorSearchEngine.getIndexStatus();
      
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('tableExists');
      expect(status).toHaveProperty('recordCount');
      expect(typeof status.available).toBe('boolean');
      expect(typeof status.tableExists).toBe('boolean');
      expect(typeof status.recordCount).toBe('number');
    });

    it('should perform vector search', async () => {
      const queryVector = Array(1536).fill(0.1);
      const results = await vectorSearchEngine.search(queryVector, {
        limit: 10,
        threshold: 0.5
      });

      expect(Array.isArray(results)).toBe(true);
      results.forEach(result => {
        expect(result).toHaveProperty('memory_id');
        expect(result).toHaveProperty('similarity');
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('type');
        expect(result).toHaveProperty('importance');
        expect(result).toHaveProperty('created_at');
      });
    });

    it('should perform hybrid search', async () => {
      const queryVector = Array(1536).fill(0.1);
      const textQuery = 'test query';
      const results = await vectorSearchEngine.hybridSearch(queryVector, textQuery, {
        limit: 10,
        threshold: 0.5
      });

      expect(Array.isArray(results)).toBe(true);
    });

    it('should rebuild index', async () => {
      const result = await vectorSearchEngine.rebuildIndex();
      expect(typeof result).toBe('boolean');
    });

    it('should perform performance test', async () => {
      const queryVector = Array(1536).fill(0.1);
      const result = await vectorSearchEngine.performanceTest(queryVector, 3);

      expect(result).toHaveProperty('averageTime');
      expect(result).toHaveProperty('minTime');
      expect(result).toHaveProperty('maxTime');
      expect(result).toHaveProperty('results');
      expect(typeof result.averageTime).toBe('number');
      expect(typeof result.minTime).toBe('number');
      expect(typeof result.maxTime).toBe('number');
      expect(typeof result.results).toBe('number');
    });
  });

  describe('M1 전체 시스템 완성도', () => {
    it('should complete full M1 workflow', async () => {
      // 1. 메모리 저장
      const memoryId = 'm1-completion-test';
      db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
        VALUES (?, 'episodic', 'M1 완성도 테스트 메모리', 0.9, 'private', datetime('now'), 0)
      `).run(memoryId);

      // 2. 성능 모니터링
      const metrics = await performanceMonitor.collectMetrics();
      expect(metrics.database.memoryCount).toBe(1);

      // 3. 배치 스케줄러 시작
      await batchScheduler.start(db);
      expect(batchScheduler.getStatus().isRunning).toBe(true);

      // 4. 하이브리드 검색
      const searchResult = await hybridSearchEngine.search(db, {
        query: 'M1 완성도',
        limit: 10
      });
      expect(searchResult.items.length).toBeGreaterThan(0);

      // 5. 메모리 주입
      const injectionResult = await memoryInjectionPrompt.execute(
        {
          query: 'M1',
          token_budget: 500,
          max_memories: 3
        },
        {
          db,
          services: { hybridSearchEngine }
        }
      );
      expect(injectionResult.content[0].text).toContain('M1');

      // 6. 벡터 검색
      const queryVector = Array(1536).fill(0.1);
      const vectorResults = await vectorSearchEngine.search(queryVector, {
        limit: 10,
        threshold: 0.5
      });
      expect(Array.isArray(vectorResults)).toBe(true);

      // 7. 정리
      batchScheduler.stop();
      expect(batchScheduler.getStatus().isRunning).toBe(false);
    });

    it('should handle all M1 error scenarios', async () => {
      // 데이터베이스 연결 끊기
      db.close();

      // 성능 모니터링에서 에러 처리 확인
      const metrics = await performanceMonitor.collectMetrics();
      expect(metrics.database.memoryCount).toBe(0);
      expect(metrics.database.size).toBe(0);

      // 임베딩 서비스 비활성화
      embeddingService.isAvailable.mockReturnValue(false);

      // 새로운 데이터베이스로 재시작
      const newDb = new Database(':memory:');
      await DatabaseUtils.initializeDatabase(newDb);

      const searchResult = await hybridSearchEngine.search(newDb, {
        query: 'test query',
        limit: 10
      });

      // 텍스트 검색만으로도 결과가 나와야 함
      expect(searchResult).toHaveProperty('items');
      expect(searchResult).toHaveProperty('total_count');

      newDb.close();
    });
  });

  describe('M1 성능 요구사항', () => {
    it('should meet search performance requirements', async () => {
      // 테스트 데이터 준비
      for (let i = 0; i < 100; i++) {
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at)
          VALUES (?, 'episodic', 'Performance test memory ' + ?, 0.5, 'private', datetime('now'))
        `).run(`perf-test-${i}`, i);
      }

      const startTime = Date.now();
      const searchResult = await hybridSearchEngine.search(db, {
        query: 'Performance test',
        limit: 10
      });
      const endTime = Date.now();

      expect(searchResult.items.length).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(1000); // 1초 이내
    });

    it('should handle concurrent operations', async () => {
      // 동시 검색 실행
      const searchPromises = Array.from({ length: 10 }, (_, i) =>
        hybridSearchEngine.search(db, {
          query: `concurrent test ${i}`,
          limit: 5
        })
      );

      const results = await Promise.all(searchPromises);
      
      // 모든 검색이 성공해야 함
      results.forEach(result => {
        expect(result).toHaveProperty('items');
        expect(result).toHaveProperty('total_count');
        expect(Array.isArray(result.items)).toBe(true);
      });
    });
  });
});


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

describe('Memento M1 통합 테스트', () => {
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
      cleanupInterval: 1000, // 1초 for testing
      monitoringInterval: 500, // 0.5초 for testing
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

    // Initialize vector search engine
    vectorSearchEngine.initialize(db);
    
    // Initialize performance monitor
    performanceMonitor.initialize(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    batchScheduler.stop();
    vi.clearAllMocks();
  });

  describe('데이터베이스 초기화', () => {
    it('should initialize database with all required tables', () => {
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `).all() as { name: string }[];

      const tableNames = tables.map(t => t.name);
      
      expect(tableNames).toContain('memory_item');
      expect(tableNames).toContain('memory_embedding');
      expect(tableNames).toContain('memory_tag');
      expect(tableNames).toContain('memory_item_tag');
      expect(tableNames).toContain('memory_link');
      expect(tableNames).toContain('feedback_event');
      expect(tableNames).toContain('wm_buffer');
    });

    it('should create FTS5 virtual table', () => {
      const ftsTables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name LIKE '%_fts'
      `).all() as { name: string }[];

      expect(ftsTables.some(t => t.name === 'memory_item_fts')).toBe(true);
    });

    it('should create VSS virtual table', () => {
      const vssTables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name LIKE '%_vss'
      `).all() as { name: string }[];

      expect(vssTables.some(t => t.name === 'memory_item_vec')).toBe(true);
    });
  });

  describe('메모리 저장 및 검색 통합', () => {
    it('should store and retrieve memories through hybrid search', async () => {
      // 1. 메모리 저장
      const memoryData = {
        id: 'test-memory-1',
        type: 'episodic',
        content: 'React Hook을 사용한 상태 관리 방법',
        importance: 0.8,
        privacy_scope: 'private',
        created_at: new Date().toISOString(),
        pinned: false,
        source: 'test',
        agent_id: 'test-agent',
        user_id: 'test-user',
        project_id: 'test-project'
      };

      db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned, source, agent_id, user_id, project_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memoryData.id,
        memoryData.type,
        memoryData.content,
        memoryData.importance,
        memoryData.privacy_scope,
        memoryData.created_at,
        memoryData.pinned ? 1 : 0,
        memoryData.source,
        memoryData.agent_id,
        memoryData.user_id,
        memoryData.project_id
      );

      // 2. 하이브리드 검색으로 메모리 검색
      const searchResult = await hybridSearchEngine.search(db, {
        query: 'React Hook 상태 관리',
        limit: 10
      });

      expect(searchResult.items).toHaveLength(1);
      expect(searchResult.items[0].content).toContain('React Hook');
      expect(searchResult.items[0].type).toBe('episodic');
    });

    it('should handle multiple memory types in search', async () => {
      // 다양한 타입의 메모리 저장
      const memories = [
        {
          id: 'working-1',
          type: 'working',
          content: '현재 작업 중인 React 컴포넌트',
          importance: 0.6
        },
        {
          id: 'episodic-1',
          type: 'episodic',
          content: 'React 프로젝트에서 발생한 버그 해결 경험',
          importance: 0.8
        },
        {
          id: 'semantic-1',
          type: 'semantic',
          content: 'React Hook의 기본 개념과 사용법',
          importance: 0.9
        },
        {
          id: 'procedural-1',
          type: 'procedural',
          content: 'React 컴포넌트 개발 절차',
          importance: 0.7
        }
      ];

      for (const memory of memories) {
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
          VALUES (?, ?, ?, ?, 'private', datetime('now'), 0)
        `).run(memory.id, memory.type, memory.content, memory.importance);
      }

      // 검색 실행
      const searchResult = await hybridSearchEngine.search(db, {
        query: 'React',
        limit: 10
      });

      expect(searchResult.items.length).toBeGreaterThan(0);
      
      // 모든 메모리 타입이 검색 결과에 포함되는지 확인
      const resultTypes = searchResult.items.map(item => item.type);
      expect(resultTypes).toContain('working');
      expect(resultTypes).toContain('episodic');
      expect(resultTypes).toContain('semantic');
      expect(resultTypes).toContain('procedural');
    });
  });

  describe('성능 모니터링 통합', () => {
    it('should collect performance metrics', async () => {
      const metrics = await performanceMonitor.collectMetrics();
      
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('database');
      expect(metrics).toHaveProperty('uptime');
      
      expect(metrics.memory).toHaveProperty('rss');
      expect(metrics.memory).toHaveProperty('heapTotal');
      expect(metrics.memory).toHaveProperty('heapUsed');
      expect(metrics.database).toHaveProperty('size');
      expect(metrics.database).toHaveProperty('memoryCount');
    });

    it('should detect performance alerts', async () => {
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
  });

  describe('배치 스케줄러 통합', () => {
    it('should start and stop scheduler correctly', async () => {
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

    it('should execute cleanup job', async () => {
      await batchScheduler.start(db);
      
      const result = await batchScheduler.runJob('cleanup');
      
      expect(result.jobType).toBe('memory_cleanup');
      expect(result.success).toBe(true);
      expect(forgettingService.executeMemoryCleanup).toHaveBeenCalledWith(db);
    });

    it('should execute monitoring job', async () => {
      await batchScheduler.start(db);
      
      const result = await batchScheduler.runJob('monitoring');
      
      expect(result.jobType).toBe('monitoring');
      expect(result.success).toBe(true);
      expect(result.details).toHaveProperty('metrics');
      expect(result.details).toHaveProperty('stats');
    });
  });

  describe('메모리 주입 프롬프트 통합', () => {
    it('should inject memories into prompt', async () => {
      // 테스트 메모리 저장
      db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
        VALUES ('test-1', 'episodic', 'React Hook 사용법', 0.8, 'private', datetime('now'), 0)
      `).run();

      const result = await memoryInjectionPrompt.execute(
        {
          query: 'React Hook',
          token_budget: 1000,
          max_memories: 5
        },
        {
          db,
          services: { hybridSearchEngine }
        }
      );

      expect(result).toHaveProperty('content');
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('React Hook');
    });

    it('should handle empty search results in memory injection', async () => {
      const result = await memoryInjectionPrompt.execute(
        {
          query: 'nonexistent query',
          token_budget: 1000,
          max_memories: 5
        },
        {
          db,
          services: { hybridSearchEngine }
        }
      );

      expect(result.content[0].text).toBe('관련 기억을 찾을 수 없습니다.');
    });
  });

  describe('벡터 검색 통합', () => {
    it('should initialize vector search engine', () => {
      const status = vectorSearchEngine.getIndexStatus();
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('tableExists');
      expect(status).toHaveProperty('recordCount');
    });

    it('should perform vector search when VSS is available', async () => {
      // VSS 사용 가능하도록 모킹
      vectorSearchEngine.getIndexStatus = vi.fn().mockReturnValue({
        available: true,
        tableExists: true,
        recordCount: 0
      });

      const queryVector = Array(1536).fill(0.1);
      const results = await vectorSearchEngine.search(queryVector, {
        limit: 10,
        threshold: 0.5
      });

      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('에러 처리 통합', () => {
    it('should handle database connection errors gracefully', async () => {
      // 데이터베이스 연결 끊기
      db.close();

      // 성능 모니터링에서 에러 처리 확인
      const metrics = await performanceMonitor.collectMetrics();
      expect(metrics.database.memoryCount).toBe(0);
      expect(metrics.database.size).toBe(0);
    });

    it('should handle service unavailability', async () => {
      // 임베딩 서비스 비활성화
      embeddingService.isAvailable.mockReturnValue(false);

      const searchResult = await hybridSearchEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      // 텍스트 검색만으로도 결과가 나와야 함
      expect(searchResult).toHaveProperty('items');
      expect(searchResult).toHaveProperty('total_count');
    });
  });

  describe('전체 워크플로우', () => {
    it('should complete full memory lifecycle', async () => {
      // 1. 메모리 저장
      const memoryId = 'workflow-test-1';
      db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
        VALUES (?, 'episodic', '전체 워크플로우 테스트 메모리', 0.9, 'private', datetime('now'), 0)
      `).run(memoryId);

      // 2. 성능 모니터링 시작
      performanceMonitor.initialize(db);
      const metrics = await performanceMonitor.collectMetrics();
      expect(metrics.database.memoryCount).toBe(1);

      // 3. 배치 스케줄러 시작
      await batchScheduler.start(db);
      const status = batchScheduler.getStatus();
      expect(status.isRunning).toBe(true);

      // 4. 하이브리드 검색
      const searchResult = await hybridSearchEngine.search(db, {
        query: '워크플로우 테스트',
        limit: 10
      });
      expect(searchResult.items.length).toBeGreaterThan(0);

      // 5. 메모리 주입
      const injectionResult = await memoryInjectionPrompt.execute(
        {
          query: '워크플로우',
          token_budget: 500,
          max_memories: 3
        },
        {
          db,
          services: { hybridSearchEngine }
        }
      );
      expect(injectionResult.content[0].text).toContain('워크플로우');

      // 6. 정리
      batchScheduler.stop();
      expect(batchScheduler.getStatus().isRunning).toBe(false);
    });
  });

  describe('동시성 테스트', () => {
    it('should handle concurrent searches', async () => {
      // 여러 메모리 저장
      for (let i = 0; i < 10; i++) {
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
          VALUES (?, 'episodic', '동시성 테스트 메모리 ' + ?, 0.5, 'private', datetime('now'), 0)
        `).run(`concurrent-${i}`, i);
      }

      // 동시 검색 실행
      const searchPromises = Array.from({ length: 5 }, (_, i) =>
        hybridSearchEngine.search(db, {
          query: `테스트 ${i}`,
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


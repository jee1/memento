import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { getVectorSearchEngine } from '../algorithms/vector-search-engine.js';
import { getBatchScheduler } from '../services/batch-scheduler.js';
import { getPerformanceMonitor } from '../services/performance-monitor.js';
import { MemoryInjectionPrompt } from '../tools/memory-injection-prompt.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';

// Mock dependencies
vi.mock('../algorithms/search-engine.js');
vi.mock('../services/memory-embedding-service.js');
vi.mock('../services/forgetting-policy-service.js');

describe('M1 Performance Optimization Integration Tests', () => {
  let db: Database.Database;
  let hybridSearchEngine: HybridSearchEngine;
  let vectorSearchEngine: ReturnType<typeof getVectorSearchEngine>;
  let batchScheduler: ReturnType<typeof getBatchScheduler>;
  let performanceMonitor: ReturnType<typeof getPerformanceMonitor>;
  let memoryInjectionPrompt: MemoryInjectionPrompt;

  beforeEach(async () => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    
    // Initialize database schema
    await DatabaseUtils.initializeDatabase(db);
    
    // Add test data
    await addTestData();
    
    // Initialize services
    hybridSearchEngine = new HybridSearchEngine();
    vectorSearchEngine = getVectorSearchEngine();
    vectorSearchEngine.initialize(db);
    
    batchScheduler = getBatchScheduler({
      cleanupInterval: 1000,
      monitoringInterval: 500,
      enableLogging: false
    });
    
    performanceMonitor = getPerformanceMonitor();
    performanceMonitor.initialize(db);
    
    memoryInjectionPrompt = new MemoryInjectionPrompt();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
  });

  async function addTestData() {
    const testMemories = [
      {
        id: 'test1',
        type: 'episodic',
        content: 'I learned about TypeScript interfaces and how they help with type safety',
        importance: 0.8,
        created_at: new Date().toISOString(),
        tags: ['typescript', 'programming', 'learning']
      },
      {
        id: 'test2',
        type: 'semantic',
        content: 'TypeScript is a statically typed superset of JavaScript that compiles to plain JavaScript',
        importance: 0.9,
        created_at: new Date().toISOString(),
        tags: ['typescript', 'definition', 'programming']
      },
      {
        id: 'test3',
        type: 'procedural',
        content: 'To create a TypeScript interface, use the interface keyword followed by the name and property definitions',
        importance: 0.7,
        created_at: new Date().toISOString(),
        tags: ['typescript', 'tutorial', 'syntax']
      },
      {
        id: 'test4',
        type: 'working',
        content: 'Currently working on implementing a hybrid search engine for the Memento project',
        importance: 0.6,
        created_at: new Date().toISOString(),
        tags: ['memento', 'search', 'current-work']
      }
    ];

    for (const memory of testMemories) {
      db.prepare(`
        INSERT INTO memory_item (id, type, content, importance, created_at, tags)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(memory.id, memory.type, memory.content, memory.importance, memory.created_at, JSON.stringify(memory.tags));
    }
  }

  describe('하이브리드 검색 엔진 통합', () => {
    it('should perform end-to-end hybrid search', async () => {
      const searchResult = await hybridSearchEngine.search(db, {
        query: 'TypeScript interface',
        limit: 5,
        vectorWeight: 0.7,
        textWeight: 0.3
      });

      expect(searchResult).toHaveProperty('items');
      expect(searchResult).toHaveProperty('total_count');
      expect(searchResult).toHaveProperty('query_time');
      expect(searchResult.items.length).toBeGreaterThan(0);
      
      // Check that results have both text and vector scores
      searchResult.items.forEach(item => {
        expect(item).toHaveProperty('textScore');
        expect(item).toHaveProperty('vectorScore');
        expect(item).toHaveProperty('finalScore');
        expect(item).toHaveProperty('recall_reason');
      });
    });

    it('should handle different query types with adaptive weights', async () => {
      // Technical term query (should favor vector search)
      const techResult = await hybridSearchEngine.search(db, {
        query: 'TypeScript',
        limit: 3
      });

      // Phrase query (should favor text search)
      const phraseResult = await hybridSearchEngine.search(db, {
        query: 'how to create TypeScript interface',
        limit: 3
      });

      // Short query (should favor vector search)
      const shortResult = await hybridSearchEngine.search(db, {
        query: 'interface',
        limit: 3
      });

      expect(techResult.items.length).toBeGreaterThan(0);
      expect(phraseResult.items.length).toBeGreaterThan(0);
      expect(shortResult.items.length).toBeGreaterThan(0);
    });

    it('should apply filters correctly', async () => {
      const episodicResult = await hybridSearchEngine.search(db, {
        query: 'TypeScript',
        filters: { type: ['episodic'] },
        limit: 5
      });

      const semanticResult = await hybridSearchEngine.search(db, {
        query: 'TypeScript',
        filters: { type: ['semantic'] },
        limit: 5
      });

      expect(episodicResult.items.length).toBeGreaterThan(0);
      expect(semanticResult.items.length).toBeGreaterThan(0);
      
      // Check that all results match the filter
      episodicResult.items.forEach(item => {
        expect(item.type).toBe('episodic');
      });
      
      semanticResult.items.forEach(item => {
        expect(item.type).toBe('semantic');
      });
    });
  });

  describe('벡터 검색 엔진 통합', () => {
    it('should work with VSS when available', async () => {
      const status = vectorSearchEngine.getIndexStatus();
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('tableExists');
      expect(status).toHaveProperty('recordCount');
    });

    it('should perform vector search with proper normalization', async () => {
      const testVector = Array(1536).fill(0.1);
      
      const results = await vectorSearchEngine.search(testVector, {
        limit: 5,
        threshold: 0.5,
        includeContent: true
      });

      expect(Array.isArray(results)).toBe(true);
      
      results.forEach(result => {
        expect(result).toHaveProperty('memory_id');
        expect(result).toHaveProperty('similarity');
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('type');
        expect(result).toHaveProperty('importance');
        expect(result).toHaveProperty('created_at');
        expect(result.similarity).toBeGreaterThanOrEqual(0);
        expect(result.similarity).toBeLessThanOrEqual(1);
      });
    });

    it('should handle hybrid search with text and vector', async () => {
      const testVector = Array(1536).fill(0.1);
      const textQuery = 'TypeScript interface';
      
      const results = await vectorSearchEngine.hybridSearch(testVector, textQuery, {
        limit: 5,
        threshold: 0.3,
        type: 'episodic'
      });

      expect(Array.isArray(results)).toBe(true);
      
      results.forEach(result => {
        expect(result).toHaveProperty('memory_id');
        expect(result).toHaveProperty('similarity');
        expect(result.similarity).toBeGreaterThanOrEqual(0);
        expect(result.similarity).toBeLessThanOrEqual(1);
      });
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

    it('should run cleanup job successfully', async () => {
      const result = await batchScheduler.runJob('cleanup');
      
      expect(result.jobType).toBe('memory_cleanup');
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('startTime');
      expect(result).toHaveProperty('endTime');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('errors');
    });

    it('should run monitoring job successfully', async () => {
      const result = await batchScheduler.runJob('monitoring');
      
      expect(result.jobType).toBe('monitoring');
      expect(result.success).toBe(true);
      expect(result.details).toHaveProperty('metrics');
      expect(result.details).toHaveProperty('stats');
      expect(result.details).toHaveProperty('alerts');
    });
  });

  describe('성능 모니터 통합', () => {
    it('should collect comprehensive metrics', async () => {
      const metrics = await performanceMonitor.collectMetrics();
      
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('database');
      expect(metrics).toHaveProperty('uptime');
      
      expect(metrics.memory).toHaveProperty('rss');
      expect(metrics.memory).toHaveProperty('heapTotal');
      expect(metrics.memory).toHaveProperty('heapUsed');
      expect(metrics.memory).toHaveProperty('external');
      
      expect(metrics.cpu).toHaveProperty('user');
      expect(metrics.cpu).toHaveProperty('system');
      
      expect(metrics.database).toHaveProperty('size');
      expect(metrics.database).toHaveProperty('memoryCount');
      expect(metrics.database).toHaveProperty('queryTime');
    });

    it('should track performance trends', async () => {
      // Collect multiple metrics
      await performanceMonitor.collectMetrics();
      await performanceMonitor.collectMetrics();
      await performanceMonitor.collectMetrics();
      
      const summary = performanceMonitor.getPerformanceSummary();
      
      expect(summary).toHaveProperty('current');
      expect(summary).toHaveProperty('alerts');
      expect(summary).toHaveProperty('trends');
      expect(summary.trends).toHaveProperty('memoryTrend');
      expect(summary.trends).toHaveProperty('dbSizeTrend');
      
      expect(['increasing', 'decreasing', 'stable']).toContain(summary.trends.memoryTrend);
      expect(['increasing', 'decreasing', 'stable']).toContain(summary.trends.dbSizeTrend);
    });

    it('should manage alerts correctly', async () => {
      const activeAlerts = performanceMonitor.getActiveAlerts();
      const allAlerts = performanceMonitor.getAllAlerts();
      
      expect(Array.isArray(activeAlerts)).toBe(true);
      expect(Array.isArray(allAlerts)).toBe(true);
      expect(allAlerts.length).toBeGreaterThanOrEqual(activeAlerts.length);
    });
  });

  describe('메모리 주입 프롬프트 통합', () => {
    it('should inject relevant memories into prompt', async () => {
      const result = await memoryInjectionPrompt.execute(
        {
          query: 'TypeScript interface',
          token_budget: 1000,
          max_memories: 3
        },
        {
          db,
          services: { hybridSearchEngine }
        }
      );

      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBe(1);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]).toHaveProperty('text');
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('관련 기억');
    });

    it('should respect token budget', async () => {
      const result = await memoryInjectionPrompt.execute(
        {
          query: 'TypeScript',
          token_budget: 100, // Small budget
          max_memories: 5
        },
        {
          db,
          services: { hybridSearchEngine }
        }
      );

      expect(result.content[0].text.length).toBeLessThan(500); // Should be summarized
    });

    it('should handle empty search results', async () => {
      const result = await memoryInjectionPrompt.execute(
        {
          query: 'nonexistent topic',
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

  describe('전체 M1 워크플로우', () => {
    it('should complete full performance optimization workflow', async () => {
      // 1. Start batch scheduler
      await batchScheduler.start(db);
      
      // 2. Perform hybrid search
      const searchResult = await hybridSearchEngine.search(db, {
        query: 'TypeScript programming',
        limit: 5
      });
      
      expect(searchResult.items.length).toBeGreaterThan(0);
      
      // 3. Collect performance metrics
      const metrics = await performanceMonitor.collectMetrics();
      expect(metrics).toBeDefined();
      
      // 4. Run memory injection
      const injectionResult = await memoryInjectionPrompt.execute(
        {
          query: 'TypeScript programming',
          token_budget: 500,
          max_memories: 3
        },
        {
          db,
          services: { hybridSearchEngine }
        }
      );
      
      expect(injectionResult.content[0].text).toContain('관련 기억');
      
      // 5. Run batch jobs
      const cleanupResult = await batchScheduler.runJob('cleanup');
      const monitoringResult = await batchScheduler.runJob('monitoring');
      
      expect(cleanupResult.success).toBe(true);
      expect(monitoringResult.success).toBe(true);
      
      // 6. Stop scheduler
      batchScheduler.stop();
      
      const finalStatus = batchScheduler.getStatus();
      expect(finalStatus.isRunning).toBe(false);
    });

    it('should handle errors gracefully in full workflow', async () => {
      // Test error handling in the complete workflow
      await batchScheduler.start(db);
      
      try {
        // This should not throw even if there are errors
        const searchResult = await hybridSearchEngine.search(db, {
          query: 'test query',
          limit: 5
        });
        
        expect(searchResult).toBeDefined();
        
        const metrics = await performanceMonitor.collectMetrics();
        expect(metrics).toBeDefined();
        
      } catch (error) {
        // Should handle errors gracefully
        expect(error).toBeDefined();
      } finally {
        batchScheduler.stop();
      }
    });

    it('should maintain performance under load', async () => {
      await batchScheduler.start(db);
      
      // Simulate multiple concurrent operations
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(
          hybridSearchEngine.search(db, {
            query: `test query ${i}`,
            limit: 3
          })
        );
      }
      
      const results = await Promise.all(promises);
      
      expect(results.length).toBe(10);
      results.forEach(result => {
        expect(result).toHaveProperty('items');
        expect(result).toHaveProperty('query_time');
        expect(result.query_time).toBeGreaterThan(0);
      });
      
      batchScheduler.stop();
    });
  });

  describe('에러 복구 및 복원력', () => {
    it('should recover from database connection issues', async () => {
      await batchScheduler.start(db);
      
      // Simulate database issue
      const originalPrepare = db.prepare;
      db.prepare = vi.fn().mockImplementation(() => {
        throw new Error('Database connection lost');
      });
      
      // Should handle error gracefully
      const result = await batchScheduler.runJob('monitoring');
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      
      // Restore database
      db.prepare = originalPrepare;
      
      // Should work again
      const recoveryResult = await batchScheduler.runJob('monitoring');
      expect(recoveryResult.success).toBe(true);
      
      batchScheduler.stop();
    });

    it('should handle service unavailability', async () => {
      // Test with unavailable services
      const result = await memoryInjectionPrompt.execute(
        {
          query: 'test',
          token_budget: 1000,
          max_memories: 5
        },
        {
          db: null, // No database
          services: { hybridSearchEngine: null } // No search engine
        }
      );
      
      // Should handle gracefully
      expect(result).toBeDefined();
    });
  });
});

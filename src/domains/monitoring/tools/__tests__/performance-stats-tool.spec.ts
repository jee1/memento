/**
 * PerformanceStatsTool 테스트
 * 성능 통계 도구 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerformanceStatsTool } from '../performance-stats-tool.js';
import type { ToolContext, ToolResult } from '../types.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../test/helpers/test-database.js';

describe('PerformanceStatsTool', () => {
  let tool: PerformanceStatsTool;
  let db: Database.Database;
  let context: ToolContext;
  let mockPerformanceMonitor: any;

  beforeEach(async () => {
    tool = new PerformanceStatsTool();
    db = await setupTestDatabase();
    
    // Mock performance monitor
    mockPerformanceMonitor = {
      collectMetrics: vi.fn().mockResolvedValue({
        database: {
          queryCount: 100,
          averageQueryTime: 5.2,
          slowQueries: 2
        },
        search: {
          totalSearches: 50,
          averageSearchTime: 10.5,
          cacheHits: 30
        },
        memory: {
          totalMemories: 1000,
          memoryUsage: 1024 * 1024 * 10 // 10MB
        },
        system: {
          cpuUsage: 25.5,
          memoryUsage: 512 * 1024 * 1024 // 512MB
        }
      }),
      generateReport: vi.fn().mockResolvedValue({
        summary: {
          overallScore: 0.85,
          recommendations: ['Optimize slow queries', 'Increase cache size']
        },
        details: {
          database: { status: 'good' },
          search: { status: 'good' },
          memory: { status: 'normal' },
          system: { status: 'good' }
        }
      })
    };
    
    context = {
      db,
      services: {
        performanceMonitor: mockPerformanceMonitor
      } as any
    };
  });

  afterEach(() => {
    cleanupTestDatabase(db);
    vi.clearAllMocks();
  });

  describe('성능 통계 조회', () => {
    it('성능 통계를 반환해야 함', async () => {
      // When: 성능 통계 조회
      const result = await tool.handle({}, context);

      // Then: 통계 정보가 반환되어야 함
      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData).toHaveProperty('metrics');
      expect(resultData.metrics).toHaveProperty('database');
      expect(resultData.metrics).toHaveProperty('search');
      expect(resultData.metrics).toHaveProperty('memory');
      expect(resultData.metrics).toHaveProperty('system');
      expect(resultData).toHaveProperty('report');
      expect(resultData).toHaveProperty('message', '성능 통계 조회 완료');
    });

    it('데이터베이스 메트릭을 포함해야 함', async () => {
      // When: 성능 통계 조회
      const result = await tool.handle({}, context);

      // Then: 데이터베이스 메트릭이 포함되어야 함
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.metrics.database).toHaveProperty('queryCount');
      expect(resultData.metrics.database).toHaveProperty('averageQueryTime');
      expect(resultData.metrics.database).toHaveProperty('slowQueries');
    });

    it('검색 메트릭을 포함해야 함', async () => {
      // When: 성능 통계 조회
      const result = await tool.handle({}, context);

      // Then: 검색 메트릭이 포함되어야 함
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.metrics.search).toHaveProperty('totalSearches');
      expect(resultData.metrics.search).toHaveProperty('averageSearchTime');
      expect(resultData.metrics.search).toHaveProperty('cacheHits');
    });

    it('메모리 메트릭을 포함해야 함', async () => {
      // When: 성능 통계 조회
      const result = await tool.handle({}, context);

      // Then: 메모리 메트릭이 포함되어야 함
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.metrics.memory).toHaveProperty('totalMemories');
      expect(resultData.metrics.memory).toHaveProperty('memoryUsage');
    });

    it('시스템 메트릭을 포함해야 함', async () => {
      // When: 성능 통계 조회
      const result = await tool.handle({}, context);

      // Then: 시스템 메트릭이 포함되어야 함
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.metrics.system).toHaveProperty('cpuUsage');
      expect(resultData.metrics.system).toHaveProperty('memoryUsage');
    });

    it('성능 리포트를 포함해야 함', async () => {
      // When: 성능 통계 조회
      const result = await tool.handle({}, context);

      // Then: 리포트가 포함되어야 함
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.report).toHaveProperty('summary');
      expect(resultData.report).toHaveProperty('details');
      expect(resultData.report.summary).toHaveProperty('overallScore');
      expect(resultData.report.summary).toHaveProperty('recommendations');
    });

    it('collectMetrics와 generateReport를 호출해야 함', async () => {
      // When: 성능 통계 조회
      await tool.handle({}, context);

      // Then: 두 메서드가 호출되어야 함
      expect(mockPerformanceMonitor.collectMetrics).toHaveBeenCalledTimes(1);
      expect(mockPerformanceMonitor.generateReport).toHaveBeenCalledTimes(1);
    });
  });

  describe('에러 처리', () => {
    it('데이터베이스가 없으면 에러를 발생시켜야 함', async () => {
      // Given: 데이터베이스가 없는 컨텍스트
      const invalidContext = {
        ...context,
        db: null as any
      };

      // When & Then: 에러 발생
      await expect(tool.handle({}, invalidContext)).rejects.toThrow();
    });

    it('성능 모니터가 없으면 에러를 발생시켜야 함', async () => {
      // Given: 성능 모니터가 없는 컨텍스트
      const invalidContext = {
        ...context,
        services: {
          ...context.services,
          performanceMonitor: null as any
        }
      };

      // When & Then: 에러 발생
      await expect(tool.handle({}, invalidContext)).rejects.toThrow();
    });

    it('서비스 실행 중 에러가 발생하면 에러를 전파해야 함', async () => {
      // Given: 에러를 발생시키는 모킹된 서비스
      mockPerformanceMonitor.collectMetrics = vi.fn().mockRejectedValue(new Error('Service error'));

      // When & Then: 에러 발생
      await expect(tool.handle({}, context)).rejects.toThrow('성능 통계 조회 실패');
    });
  });

  describe('도구 메타데이터', () => {
    it('올바른 도구 정의를 반환해야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 올바른 정의 반환
      expect(definition.name).toBe('performance_stats');
      expect(definition.description).toBe('성능 통계를 조회합니다');
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(typeof definition.handler).toBe('function');
    });
  });
});


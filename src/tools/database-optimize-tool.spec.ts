/**
 * DatabaseOptimizeTool 테스트
 * 데이터베이스 최적화 도구 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseOptimizeTool } from './database-optimize-tool.js';
import type { ToolContext, ToolResult } from './types.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../test/helpers/test-database.js';

describe('DatabaseOptimizeTool', () => {
  let tool: DatabaseOptimizeTool;
  let db: Database.Database;
  let context: ToolContext;
  let mockDatabaseOptimizer: any;

  beforeEach(async () => {
    tool = new DatabaseOptimizeTool();
    db = await setupTestDatabase();
    
    // Mock database optimizer
    mockDatabaseOptimizer = {
      analyzeDatabase: vi.fn().mockResolvedValue(undefined),
      generateIndexRecommendations: vi.fn().mockResolvedValue([
        {
          table: 'memory_item',
          columns: ['created_at'],
          priority: 'high',
          reason: 'Frequent queries on created_at'
        },
        {
          table: 'memory_item',
          columns: ['type'],
          priority: 'low',
          reason: 'Less frequent queries'
        }
      ]),
      createIndex: vi.fn().mockResolvedValue(undefined),
      generateOptimizationReport: vi.fn().mockResolvedValue({
        totalTables: 5,
        totalIndexes: 10,
        recommendations: 2,
        optimizationScore: 0.85
      })
    };
    
    context = {
      db,
      services: {
        databaseOptimizer: mockDatabaseOptimizer
      } as any
    };
  });

  afterEach(() => {
    cleanupTestDatabase(db);
    vi.clearAllMocks();
  });

  describe('분석 모드', () => {
    it('데이터베이스 분석을 수행해야 함', async () => {
      // When: analyze=true로 실행
      const result = await tool.handle({ analyze: true, create_indexes: false }, context);

      // Then: 분석이 수행되어야 함
      expect(mockDatabaseOptimizer.analyzeDatabase).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('content');
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.operations).toContain('데이터베이스 분석 완료');
    });

    it('분석 결과를 반환해야 함', async () => {
      // When: analyze=true로 실행
      const result = await tool.handle({ analyze: true, create_indexes: false }, context);

      // Then: 리포트가 포함되어야 함
      expect(result).toHaveProperty('content');
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData).toHaveProperty('report');
      expect(resultData.report).toHaveProperty('totalTables');
      expect(resultData.report).toHaveProperty('totalIndexes');
    });
  });

  describe('인덱스 생성 모드', () => {
    it('추천 인덱스를 생성해야 함', async () => {
      // When: create_indexes=true로 실행
      const result = await tool.handle({ analyze: false, create_indexes: true }, context);

      // Then: high priority 인덱스만 생성되어야 함
      expect(mockDatabaseOptimizer.generateIndexRecommendations).toHaveBeenCalledTimes(1);
      expect(mockDatabaseOptimizer.createIndex).toHaveBeenCalledTimes(1);
      expect(mockDatabaseOptimizer.createIndex).toHaveBeenCalledWith(
        'idx_memory_item_created_at',
        'memory_item',
        ['created_at']
      );
      
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.operations).toContain('인덱스 생성: idx_memory_item_created_at');
    });

    it('low priority 인덱스는 생성하지 않아야 함', async () => {
      // When: create_indexes=true로 실행
      await tool.handle({ analyze: false, create_indexes: true }, context);

      // Then: high priority 인덱스만 생성되어야 함
      const calls = mockDatabaseOptimizer.createIndex.mock.calls;
      expect(calls.length).toBe(1); // high priority만
      expect(calls[0][0]).toBe('idx_memory_item_created_at');
    });
  });

  describe('통합 모드', () => {
    it('분석과 인덱스 생성을 모두 수행해야 함', async () => {
      // When: analyze=true, create_indexes=true로 실행
      const result = await tool.handle({ analyze: true, create_indexes: true }, context);

      // Then: 분석과 인덱스 생성이 모두 수행되어야 함
      expect(mockDatabaseOptimizer.analyzeDatabase).toHaveBeenCalledTimes(1);
      expect(mockDatabaseOptimizer.generateIndexRecommendations).toHaveBeenCalledTimes(1);
      expect(mockDatabaseOptimizer.createIndex).toHaveBeenCalledTimes(1);
      
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.operations).toContain('데이터베이스 분석 완료');
      expect(resultData.operations).toContain('인덱스 생성: idx_memory_item_created_at');
    });
  });

  describe('기본값 처리', () => {
    it('파라미터가 없으면 아무 작업도 수행하지 않아야 함', async () => {
      // When: 파라미터 없이 실행
      const result = await tool.handle({}, context);

      // Then: 분석이나 인덱스 생성이 수행되지 않아야 함
      expect(mockDatabaseOptimizer.analyzeDatabase).not.toHaveBeenCalled();
      expect(mockDatabaseOptimizer.generateIndexRecommendations).not.toHaveBeenCalled();
      expect(mockDatabaseOptimizer.createIndex).not.toHaveBeenCalled();
      
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.operations).toHaveLength(0);
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
      await expect(tool.handle({ analyze: true }, invalidContext)).rejects.toThrow();
    });

    it('데이터베이스 최적화기가 없으면 에러를 발생시켜야 함', async () => {
      // Given: 데이터베이스 최적화기가 없는 컨텍스트
      const invalidContext = {
        ...context,
        services: {
          ...context.services,
          databaseOptimizer: null as any
        }
      };

      // When & Then: 에러 발생
      await expect(tool.handle({ analyze: true }, invalidContext)).rejects.toThrow();
    });

    it('서비스 실행 중 에러가 발생하면 에러를 전파해야 함', async () => {
      // Given: 에러를 발생시키는 모킹된 서비스
      mockDatabaseOptimizer.analyzeDatabase = vi.fn().mockRejectedValue(new Error('Service error'));

      // When & Then: 에러 발생
      await expect(tool.handle({ analyze: true }, context)).rejects.toThrow('데이터베이스 최적화 실패');
    });
  });

  describe('도구 메타데이터', () => {
    it('올바른 도구 정의를 반환해야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 올바른 정의 반환
      expect(definition.name).toBe('database_optimize');
      expect(definition.description).toBe('데이터베이스 최적화를 수행합니다');
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(definition.inputSchema.properties).toHaveProperty('analyze');
      expect(definition.inputSchema.properties).toHaveProperty('create_indexes');
      expect(typeof definition.handler).toBe('function');
    });
  });
});


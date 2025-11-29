/**
 * ForgettingStatsTool 테스트
 * 망각 통계 도구 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForgettingStatsTool } from '../forgetting-stats-tool.js';
import type { ToolContext, ToolResult } from '../types.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase, createTestMemory } from '../test/helpers/test-database.js';
import { ForgettingPolicyService } from '../forgetting/services/forgetting-policy-service.js';

describe('ForgettingStatsTool', () => {
  let tool: ForgettingStatsTool;
  let db: Database.Database;
  let context: ToolContext;

  beforeEach(async () => {
    tool = new ForgettingStatsTool();
    db = await setupTestDatabase();
    context = {
      db,
      services: {
        forgettingPolicyService: new ForgettingPolicyService()
      } as any
    };
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('망각 통계 조회', () => {
    it('망각 통계를 반환해야 함', async () => {
      // Given: 테스트 메모리 생성
      createTestMemory(db, {
        content: 'Test memory for stats',
        type: 'episodic',
        importance: 0.5
      });

      // When: 망각 통계 조회
      const result = await tool.handle({}, context);

      // Then: 통계 정보가 반환되어야 함
      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData).toHaveProperty('stats');
      expect(resultData.stats).toHaveProperty('totalMemories');
      expect(resultData.stats).toHaveProperty('forgetCandidates');
      expect(resultData.stats).toHaveProperty('reviewCandidates');
      expect(resultData.stats).toHaveProperty('averageForgetScore');
      expect(resultData.stats).toHaveProperty('memoryDistribution');
      expect(resultData).toHaveProperty('message', '망각 통계 조회 완료');
    });

    it('여러 메모리의 통계를 집계해야 함', async () => {
      // Given: 여러 테스트 메모리 생성
      createTestMemory(db, {
        content: 'Memory 1',
        type: 'episodic',
        importance: 0.5
      });
      createTestMemory(db, {
        content: 'Memory 2',
        type: 'semantic',
        importance: 0.7
      });
      createTestMemory(db, {
        content: 'Memory 3',
        type: 'working',
        importance: 0.3
      });

      // When: 망각 통계 조회
      const result = await tool.handle({}, context);

      // Then: 모든 메모리가 통계에 포함되어야 함
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.stats.totalMemories).toBe(3);
      expect(resultData.stats.memoryDistribution.episodic).toBe(1);
      expect(resultData.stats.memoryDistribution.semantic).toBe(1);
      expect(resultData.stats.memoryDistribution.working).toBe(1);
    });

    it('메모리가 없으면 0 통계를 반환해야 함', async () => {
      // When: 망각 통계 조회 (메모리 없음)
      const result = await tool.handle({}, context);

      // Then: 0 통계 반환
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.stats.totalMemories).toBe(0);
      expect(resultData.stats.forgetCandidates).toBe(0);
      expect(resultData.stats.reviewCandidates).toBe(0);
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

    it('망각 정책 서비스가 없으면 에러를 발생시켜야 함', async () => {
      // Given: 망각 정책 서비스가 없는 컨텍스트
      const invalidContext = {
        ...context,
        services: {
          ...context.services,
          forgettingPolicyService: null as any
        }
      };

      // When & Then: 에러 발생
      await expect(tool.handle({}, invalidContext)).rejects.toThrow();
    });

    it('서비스 실행 중 에러가 발생하면 에러를 전파해야 함', async () => {
      // Given: 에러를 발생시키는 모킹된 서비스
      const mockService = {
        generateForgettingStats: vi.fn().mockRejectedValue(new Error('Service error'))
      };
      const invalidContext = {
        ...context,
        services: {
          ...context.services,
          forgettingPolicyService: mockService as any
        }
      };

      // When & Then: 에러 발생
      await expect(tool.handle({}, invalidContext)).rejects.toThrow('망각 통계 조회 실패');
    });
  });

  describe('도구 메타데이터', () => {
    it('올바른 도구 정의를 반환해야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 올바른 정의 반환
      expect(definition.name).toBe('forgetting_stats');
      expect(definition.description).toBe('망각 통계를 조회합니다');
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(typeof definition.handler).toBe('function');
    });
  });
});


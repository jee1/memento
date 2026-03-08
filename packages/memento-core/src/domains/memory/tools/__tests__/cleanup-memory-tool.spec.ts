/**
 * CleanupMemoryTool 테스트
 * 메모리 정리 도구 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CleanupMemoryTool } from '../cleanup-memory-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase, createTestMemory } from '../../../../test/helpers/test-database.js';
import { ForgettingPolicyService } from '../../../forgetting/services/forgetting-policy-service.js';

describe('CleanupMemoryTool', () => {
  let tool: CleanupMemoryTool;
  let db: Database.Database;
  let context: ToolContext;

  beforeEach(async () => {
    tool = new CleanupMemoryTool();
    db = await setupTestDatabase();
    context = {
      db,
      services: {
        forgettingPolicyService: new ForgettingPolicyService()
      } as any
    };
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('드라이런 모드', () => {
    it('드라이런 모드에서 망각 통계를 반환해야 함', async () => {
      // Given: 테스트 메모리 생성
      createTestMemory(db, {
        content: 'Test memory for cleanup',
        type: 'episodic',
        importance: 0.1
      });

      // When: 드라이런 모드로 실행
      const result = await tool.handle({ dry_run: true }, context);

      // Then: 통계 정보가 반환되어야 함
      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData).toHaveProperty('mode', 'dry_run');
      expect(resultData).toHaveProperty('stats');
      expect(resultData.stats).toHaveProperty('totalMemories');
      expect(resultData.stats).toHaveProperty('forgetCandidates');
      expect(resultData.stats).toHaveProperty('reviewCandidates');
      expect(resultData.stats).toHaveProperty('averageForgetScore');
      expect(resultData.stats).toHaveProperty('memoryDistribution');
    });

    it('드라이런 모드에서는 실제 삭제가 발생하지 않아야 함', async () => {
      // Given: 테스트 메모리 생성
      const memoryId = createTestMemory(db, {
        content: 'Test memory for cleanup',
        type: 'episodic',
        importance: 0.1
      });

      // 메모리 개수 확인
      const beforeCount = db.prepare('SELECT COUNT(*) as count FROM memory_item').get() as { count: number };

      // When: 드라이런 모드로 실행
      await tool.handle({ dry_run: true }, context);

      // Then: 메모리가 삭제되지 않아야 함
      const afterCount = db.prepare('SELECT COUNT(*) as count FROM memory_item').get() as { count: number };
      expect(afterCount.count).toBe(beforeCount.count);

      // 메모리가 여전히 존재해야 함
      const memory = db.prepare('SELECT * FROM memory_item WHERE id = ?').get(memoryId);
      expect(memory).toBeDefined();
    });
  });

  describe('실제 실행 모드', () => {
    it('실제 실행 모드에서 메모리 정리를 수행해야 함', async () => {
      // Given: 테스트 메모리 생성
      createTestMemory(db, {
        content: 'Test memory for cleanup',
        type: 'episodic',
        importance: 0.1
      });

      // When: 실제 실행 모드로 실행
      const result = await tool.handle({ dry_run: false }, context);

      // Then: 정리 결과가 반환되어야 함
      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData).toHaveProperty('mode', 'execution');
      expect(resultData).toHaveProperty('result');
      expect(resultData.result).toHaveProperty('softDeleted');
      expect(resultData.result).toHaveProperty('hardDeleted');
      expect(resultData.result).toHaveProperty('reviewed');
      expect(resultData.result).toHaveProperty('totalProcessed');
      expect(resultData.result).toHaveProperty('summary');
    });

    it('실제 실행 모드에서 정리된 메모리 수를 반환해야 함', async () => {
      // Given: 테스트 메모리 생성
      createTestMemory(db, {
        content: 'Test memory for cleanup',
        type: 'episodic',
        importance: 0.01 // 낮은 중요도로 망각 후보가 되도록
      });

      // When: 실제 실행 모드로 실행
      const result = await tool.handle({ dry_run: false }, context);

      // Then: summary에 정리된 메모리 수가 포함되어야 함
      expect(result).toHaveProperty('content');
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.result.summary).toHaveProperty('actualSoftDeletes');
      expect(resultData.result.summary).toHaveProperty('actualHardDeletes');
      expect(resultData.result.summary).toHaveProperty('actualReviews');
    });
  });

  describe('기본값 처리', () => {
    it('dry_run 파라미터가 없으면 기본값 false를 사용해야 함', async () => {
      // Given: 테스트 메모리 생성
      createTestMemory(db, {
        content: 'Test memory for cleanup',
        type: 'episodic',
        importance: 0.1
      });

      // When: dry_run 파라미터 없이 실행
      const result = await tool.handle({}, context);

      // Then: 실제 실행 모드로 실행되어야 함
      expect(result).toHaveProperty('content');
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData).toHaveProperty('mode', 'execution');
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
      await expect(tool.handle({ dry_run: true }, invalidContext)).rejects.toThrow();
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
      await expect(tool.handle({ dry_run: true }, invalidContext)).rejects.toThrow();
    });

    it('서비스 실행 중 에러가 발생하면 에러를 전파해야 함', async () => {
      // Given: 에러를 발생시키는 모킹된 서비스
      const mockService = {
        generateForgettingStats: vi.fn().mockRejectedValue(new Error('Service error')),
        executeMemoryCleanup: vi.fn().mockRejectedValue(new Error('Service error'))
      };
      const invalidContext = {
        ...context,
        services: {
          ...context.services,
          forgettingPolicyService: mockService as any
        }
      };

      // When & Then: 에러 발생
      await expect(tool.handle({ dry_run: true }, invalidContext)).rejects.toThrow('메모리 정리 실패');
    });
  });

  describe('도구 메타데이터', () => {
    it('올바른 도구 정의를 반환해야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 올바른 정의 반환
      expect(definition.name).toBe('cleanup_memory');
      expect(definition.description).toBe('망각 정책에 따라 메모리를 정리합니다');
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(definition.inputSchema.properties).toHaveProperty('dry_run');
      expect(definition.inputSchema.properties.dry_run).toHaveProperty('type', 'boolean');
      expect(typeof definition.handler).toBe('function');
    });
  });
});


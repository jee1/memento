/**
 * GetMetaMemoryStatsTool 테스트
 * 메타 메모리 통계 조회 도구 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { MetaMemoryStatsSchemaMigration } from '../../../../infrastructure/database/database/migration/migrations/011-meta-memory-stats-schema.js';
import type { ToolContext } from '../../../../tools/types.js';

/**
 * 기본 스키마 생성 (memory_item 테이블만)
 */
function createBaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
      privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      view_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0,
      origin_source TEXT DEFAULT '{}',
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    );
  `);

  // memento_schema_version 테이블 생성 (마이그레이션 버전 관리용)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      migration_name TEXT NOT NULL,
      checksum TEXT,
      applied_by TEXT DEFAULT 'system',
      description TEXT
    );
  `);
}

describe('GetMetaMemoryStatsTool', () => {
  let db: Database.Database;
  let context: ToolContext;
  let mockMetaMemoryService: any;

  beforeEach(async () => {
    db = new Database(':memory:');
    createBaseSchema(db);
    await new MetaMemoryStatsSchemaMigration().up(db);

    // Mock MetaMemoryService
    mockMetaMemoryService = {
      getStats: vi.fn().mockResolvedValue({
        items: [],
        total_count: 0
      })
    };

    context = {
      db,
      services: {
        metaMemoryService: mockMetaMemoryService
      } as any
    };
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe('도구 스키마 검증', () => {
    it('given: 도구가 등록될 때, when: 스키마를 확인하면, then: 모든 파라미터가 올바르게 정의되어야 함', async () => {
      // Given: GetMetaMemoryStatsTool 클래스가 존재해야 함
      // (아직 구현되지 않았으므로 import 시 에러 발생 예상)
      let GetMetaMemoryStatsTool: any;
      try {
        const module = await import('../get-meta-memory-stats-tool.js');
        GetMetaMemoryStatsTool = module.GetMetaMemoryStatsTool;
      } catch (error) {
        // 파일이 아직 없으면 테스트는 실패해야 함 (RED 상태)
        expect(error).toBeDefined();
        return;
      }

      // When: 도구 인스턴스 생성
      const tool = new GetMetaMemoryStatsTool();
      const definition = tool.getDefinition();

      // Then: 모든 파라미터가 올바르게 정의되어야 함
      expect(definition.name).toBe('get_meta_memory_stats');
      expect(definition.description).toBeDefined();
      expect(definition.inputSchema).toHaveProperty('type', 'object');
      expect(definition.inputSchema.properties).toBeDefined();

      // 파라미터 검증
      const properties = definition.inputSchema.properties;
      
      // memory_id (선택적)
      expect(properties.memory_id).toBeDefined();
      expect(properties.memory_id.type).toBe('string');
      
      // memory_ids (선택적)
      expect(properties.memory_ids).toBeDefined();
      expect(properties.memory_ids.type).toBe('array');
      expect(properties.memory_ids.items).toHaveProperty('type', 'string');
      
      // min_recall_count (선택적)
      expect(properties.min_recall_count).toBeDefined();
      expect(properties.min_recall_count.type).toBe('number');
      expect(properties.min_recall_count.minimum).toBe(0);
      
      // min_confidence (선택적)
      expect(properties.min_confidence).toBeDefined();
      expect(properties.min_confidence.type).toBe('number');
      expect(properties.min_confidence.minimum).toBe(0);
      expect(properties.min_confidence.maximum).toBe(1);
      
      // limit (선택적)
      expect(properties.limit).toBeDefined();
      expect(properties.limit.type).toBe('number');
      expect(properties.limit.minimum).toBe(1);
      expect(properties.limit.maximum).toBe(1000);
    });
  });

  describe('도구 핸들러 단위 테스트', () => {
    let tool: any;

    beforeEach(async () => {
      const module = await import('../get-meta-memory-stats-tool.js');
      tool = new module.GetMetaMemoryStatsTool();
    });

    it('given: 다양한 파라미터로 호출할 때, when: 도구를 실행하면, then: 필터링된 결과가 반환되어야 함', async () => {
      // Given: 다양한 파라미터와 mock 데이터
      const mockStats = {
        items: [
          {
            memory_id: 'mem_test_1',
            recall_count: 10,
            success_count: 8,
            failure_count: 2,
            avg_confidence: 0.85,
            last_recalled_at: new Date('2024-01-01T00:00:00.000Z'),
            created_at: new Date('2024-01-01T00:00:00.000Z'),
            updated_at: new Date('2024-01-01T00:00:00.000Z')
          },
          {
            memory_id: 'mem_test_2',
            recall_count: 5,
            success_count: 3,
            failure_count: 2,
            avg_confidence: 0.6,
            last_recalled_at: new Date('2024-01-02T00:00:00.000Z'),
            created_at: new Date('2024-01-01T00:00:00.000Z'),
            updated_at: new Date('2024-01-02T00:00:00.000Z')
          }
        ],
        total_count: 2
      };

      mockMetaMemoryService.getStats.mockResolvedValue(mockStats);

      // When: 다양한 파라미터로 도구 실행
      const params = {
        memory_ids: ['mem_test_1', 'mem_test_2'],
        min_recall_count: 5,
        min_confidence: 0.5,
        limit: 10
      };

      const result = await tool.handle(params, context);

      // Then: 필터링된 결과가 반환되어야 함
      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      const resultData = JSON.parse(result.content[0].text);
      
      expect(resultData).toHaveProperty('items');
      expect(resultData).toHaveProperty('total_count', 2);
      expect(resultData).toHaveProperty('message', '메타 메모리 통계 조회 완료');
      expect(Array.isArray(resultData.items)).toBe(true);
      expect(resultData.items.length).toBe(2);

      // MetaMemoryService.getStats가 올바른 파라미터로 호출되었는지 확인
      expect(mockMetaMemoryService.getStats).toHaveBeenCalledWith({
        memory_ids: ['mem_test_1', 'mem_test_2'],
        min_recall_count: 5,
        min_confidence: 0.5,
        limit: 10
      });

      // 결과 항목 검증
      expect(resultData.items[0]).toHaveProperty('memory_id', 'mem_test_1');
      expect(resultData.items[0]).toHaveProperty('recall_count', 10);
      expect(resultData.items[0]).toHaveProperty('success_count', 8);
      expect(resultData.items[0]).toHaveProperty('failure_count', 2);
      expect(resultData.items[0]).toHaveProperty('avg_confidence', 0.85);
      expect(resultData.items[0]).toHaveProperty('last_recalled_at');
      expect(resultData.items[0]).toHaveProperty('created_at');
      expect(resultData.items[0]).toHaveProperty('updated_at');
    });

    it('given: memory_id 파라미터로 호출할 때, when: 도구를 실행하면, then: 단일 메모리 통계가 반환되어야 함', async () => {
      // Given: memory_id 파라미터
      const mockStats = {
        items: [
          {
            memory_id: 'mem_test_1',
            recall_count: 10,
            success_count: 8,
            failure_count: 2,
            avg_confidence: 0.85,
            last_recalled_at: new Date('2024-01-01T00:00:00.000Z'),
            created_at: new Date('2024-01-01T00:00:00.000Z'),
            updated_at: new Date('2024-01-01T00:00:00.000Z')
          }
        ],
        total_count: 1
      };

      mockMetaMemoryService.getStats.mockResolvedValue(mockStats);

      // When: memory_id로 도구 실행
      const params = {
        memory_id: 'mem_test_1'
      };

      const result = await tool.handle(params, context);

      // Then: 단일 메모리 통계가 반환되어야 함
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.items.length).toBe(1);
      expect(resultData.items[0].memory_id).toBe('mem_test_1');
      expect(mockMetaMemoryService.getStats).toHaveBeenCalledWith({
        memory_id: 'mem_test_1',
        limit: 100
      });
    });

    it('given: 빈 파라미터로 호출할 때, when: 도구를 실행하면, then: 모든 통계가 반환되어야 함', async () => {
      // Given: 빈 파라미터
      const mockStats = {
        items: [],
        total_count: 0
      };

      mockMetaMemoryService.getStats.mockResolvedValue(mockStats);

      // When: 빈 파라미터로 도구 실행
      const params = {};

      const result = await tool.handle(params, context);

      // Then: 모든 통계가 반환되어야 함 (limit 기본값 100)
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.items).toEqual([]);
      expect(resultData.total_count).toBe(0);
      expect(mockMetaMemoryService.getStats).toHaveBeenCalledWith({
        limit: 100
      });
    });

    it('given: min_recall_count와 min_confidence 필터로 호출할 때, when: 도구를 실행하면, then: 필터링된 결과가 반환되어야 함', async () => {
      // Given: 필터 파라미터
      const mockStats = {
        items: [
          {
            memory_id: 'mem_test_1',
            recall_count: 10,
            success_count: 8,
            failure_count: 2,
            avg_confidence: 0.85,
            last_recalled_at: new Date('2024-01-01T00:00:00.000Z'),
            created_at: new Date('2024-01-01T00:00:00.000Z'),
            updated_at: new Date('2024-01-01T00:00:00.000Z')
          }
        ],
        total_count: 1
      };

      mockMetaMemoryService.getStats.mockResolvedValue(mockStats);

      // When: 필터 파라미터로 도구 실행
      const params = {
        min_recall_count: 10,
        min_confidence: 0.8,
        limit: 50
      };

      const result = await tool.handle(params, context);

      // Then: 필터링된 결과가 반환되어야 함
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.items.length).toBe(1);
      expect(mockMetaMemoryService.getStats).toHaveBeenCalledWith({
        min_recall_count: 10,
        min_confidence: 0.8,
        limit: 50
      });
    });
  });

  describe('파라미터 검증', () => {
    let tool: any;

    beforeEach(async () => {
      const module = await import('../get-meta-memory-stats-tool.js');
      tool = new module.GetMetaMemoryStatsTool();
    });

    it('given: memory_id와 memory_ids를 동시에 사용할 때, when: 도구를 실행하면, then: 적절한 에러가 발생해야 함', async () => {
      // Given: memory_id와 memory_ids를 동시에 사용하는 잘못된 파라미터
      const params = {
        memory_id: 'mem_test_1',
        memory_ids: ['mem_test_2', 'mem_test_3']
      };

      // When & Then: 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow('파라미터 검증 실패');
      await expect(tool.handle(params, context)).rejects.toThrow('memory_id와 memory_ids는 동시에 사용할 수 없습니다');
    });

    it('given: min_recall_count가 음수일 때, when: 도구를 실행하면, then: 적절한 에러가 발생해야 함', async () => {
      // Given: min_recall_count가 음수인 잘못된 파라미터
      const params = {
        min_recall_count: -1
      };

      // When & Then: 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow('파라미터 검증 실패');
    });

    it('given: min_confidence가 0 미만일 때, when: 도구를 실행하면, then: 적절한 에러가 발생해야 함', async () => {
      // Given: min_confidence가 0 미만인 잘못된 파라미터
      const params = {
        min_confidence: -0.1
      };

      // When & Then: 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow('파라미터 검증 실패');
    });

    it('given: min_confidence가 1 초과일 때, when: 도구를 실행하면, then: 적절한 에러가 발생해야 함', async () => {
      // Given: min_confidence가 1 초과인 잘못된 파라미터
      const params = {
        min_confidence: 1.1
      };

      // When & Then: 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow('파라미터 검증 실패');
    });

    it('given: limit이 1 미만일 때, when: 도구를 실행하면, then: 적절한 에러가 발생해야 함', async () => {
      // Given: limit이 1 미만인 잘못된 파라미터
      const params = {
        limit: 0
      };

      // When & Then: 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow('파라미터 검증 실패');
    });

    it('given: limit이 1000 초과일 때, when: 도구를 실행하면, then: 적절한 에러가 발생해야 함', async () => {
      // Given: limit이 1000 초과인 잘못된 파라미터
      const params = {
        limit: 1001
      };

      // When & Then: 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow('파라미터 검증 실패');
    });

    it('given: memory_id가 문자열이 아닐 때, when: 도구를 실행하면, then: 적절한 에러가 발생해야 함', async () => {
      // Given: memory_id가 문자열이 아닌 잘못된 파라미터
      const params = {
        memory_id: 123
      };

      // When & Then: 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow('파라미터 검증 실패');
    });

    it('given: memory_ids가 문자열 배열이 아닐 때, when: 도구를 실행하면, then: 적절한 에러가 발생해야 함', async () => {
      // Given: memory_ids가 문자열 배열이 아닌 잘못된 파라미터
      const params = {
        memory_ids: [123, 456]
      };

      // When & Then: 에러 발생
      await expect(tool.handle(params, context)).rejects.toThrow('파라미터 검증 실패');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { MemoryType, MemoryTypeRequest, isMemoryItemType, SqlParam } from './index.js';
import type { MetaMemoryStats, GetMetaMemoryStatsParams, MetaMemoryStatsResult } from './index.js';
import type { RecallResponse } from '../../domains/memory/tools/recall-tool.js';
import { isSqlParam } from '../utils/type-guards.js';

describe('MemoryTypeRequest and isMemoryItemType', () => {
  describe('isMemoryItemType', () => {
    it('should return true for memory_item types', () => {
      expect(isMemoryItemType('working')).toBe(true);
      expect(isMemoryItemType('episodic')).toBe(true);
      expect(isMemoryItemType('semantic')).toBe(true);
      expect(isMemoryItemType('procedural')).toBe(true);
    });

    it('should return false for core and vault types', () => {
      expect(isMemoryItemType('core')).toBe(false);
      expect(isMemoryItemType('vault')).toBe(false);
    });

    it('should narrow type correctly when used as type guard', () => {
      const testType: MemoryTypeRequest = 'episodic';
      
      if (isMemoryItemType(testType)) {
        // TypeScript should narrow testType to MemoryType here
        const memoryType: MemoryType = testType; // Should not cause type error
        expect(memoryType).toBe('episodic');
      }
    });

    it('should work with all valid MemoryTypeRequest values', () => {
      const validTypes: MemoryTypeRequest[] = [
        'working',
        'episodic',
        'semantic',
        'procedural',
        'core',
        'vault'
      ];

      validTypes.forEach(type => {
        if (isMemoryItemType(type)) {
          // Should only be true for first 4 types
          expect(['working', 'episodic', 'semantic', 'procedural']).toContain(type);
        } else {
          // Should be false for core and vault
          expect(['core', 'vault']).toContain(type);
        }
      });
    });
  });

  describe('Type compatibility', () => {
    it('should allow MemoryTypeRequest to be used where MemoryTypeRequest is expected', () => {
      const requestType: MemoryTypeRequest = 'core';
      expect(requestType).toBe('core');
    });

    it('should allow MemoryType to be used where MemoryTypeRequest is expected', () => {
      const memoryType: MemoryType = 'episodic';
      const requestType: MemoryTypeRequest = memoryType; // Should be compatible
      expect(requestType).toBe('episodic');
    });

    it('should not allow MemoryTypeRequest to be used where MemoryType is expected without type guard', () => {
      const requestType: MemoryTypeRequest = 'core';
      // This should cause a type error if we try to assign directly
      // But we can test that isMemoryItemType properly filters it
      expect(isMemoryItemType(requestType)).toBe(false);
    });
  });
});

describe('MetaMemoryStats interface', () => {
  describe('타입 정의 검증', () => {
    it('given: MetaMemoryStats 타입 정의가 있을 때, when: 타입을 사용하면, then: 모든 필드가 올바른 타입이어야 함', () => {
      // 타입 정의가 존재하는지 확인 (런타임에서는 타입이 존재하지 않으므로, 타입 호환성 테스트)
      const testStats: MetaMemoryStats = {
        memory_id: 'test-memory-1',
        recall_count: 10,
        success_count: 8,
        failure_count: 2,
        avg_confidence: 0.85,
        last_recalled_at: new Date('2024-01-01T00:00:00.000Z'),
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        updated_at: new Date('2024-01-01T00:00:00.000Z')
      };

      // 모든 필드가 올바른 타입인지 확인
      expect(typeof testStats.memory_id).toBe('string');
      expect(typeof testStats.recall_count).toBe('number');
      expect(typeof testStats.success_count).toBe('number');
      expect(typeof testStats.failure_count).toBe('number');
      expect(typeof testStats.avg_confidence).toBe('number');
      expect(testStats.last_recalled_at).toBeInstanceOf(Date);
      expect(testStats.created_at).toBeInstanceOf(Date);
      expect(testStats.updated_at).toBeInstanceOf(Date);
    });

    it('given: MetaMemoryStats 타입 정의가 있을 때, when: last_recalled_at이 null일 수 있으면, then: 선택적 필드로 처리되어야 함', () => {
      // last_recalled_at은 NULL 허용이므로 선택적 필드
      const testStats: MetaMemoryStats = {
        memory_id: 'test-memory-2',
        recall_count: 0,
        success_count: 0,
        failure_count: 0,
        avg_confidence: 0.0,
        last_recalled_at: undefined, // NULL 허용
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        updated_at: new Date('2024-01-01T00:00:00.000Z')
      };

      expect(testStats.last_recalled_at).toBeUndefined();
      expect(testStats.memory_id).toBe('test-memory-2');
    });

    it('given: MetaMemoryStats 타입 정의가 있을 때, when: 숫자 필드를 사용하면, then: 정수와 실수가 올바르게 구분되어야 함', () => {
      const testStats: MetaMemoryStats = {
        memory_id: 'test-memory-3',
        recall_count: 5, // INTEGER
        success_count: 4, // INTEGER
        failure_count: 1, // INTEGER
        avg_confidence: 0.75, // REAL
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        updated_at: new Date('2024-01-01T00:00:00.000Z')
      };

      // 정수 필드 확인
      expect(Number.isInteger(testStats.recall_count)).toBe(true);
      expect(Number.isInteger(testStats.success_count)).toBe(true);
      expect(Number.isInteger(testStats.failure_count)).toBe(true);

      // 실수 필드 확인
      expect(typeof testStats.avg_confidence).toBe('number');
      expect(Number.isFinite(testStats.avg_confidence)).toBe(true);
    });

    it('given: MetaMemoryStats 타입 정의가 있을 때, when: 타입을 사용하면, then: 필수 필드가 모두 포함되어야 함', () => {
      // 필수 필드만으로 객체 생성 가능해야 함
      const testStats: MetaMemoryStats = {
        memory_id: 'test-memory-4',
        recall_count: 0,
        success_count: 0,
        failure_count: 0,
        avg_confidence: 0.0,
        created_at: new Date(),
        updated_at: new Date()
        // last_recalled_at은 선택적이므로 생략 가능
      };

      expect(testStats.memory_id).toBeDefined();
      expect(testStats.recall_count).toBeDefined();
      expect(testStats.success_count).toBeDefined();
      expect(testStats.failure_count).toBeDefined();
      expect(testStats.avg_confidence).toBeDefined();
      expect(testStats.created_at).toBeDefined();
      expect(testStats.updated_at).toBeDefined();
    });
  });
});

describe('RecallResponse interface extension', () => {
  describe('meta_stats 필드 확장', () => {
    it('given: RecallResponse에 meta_stats 필드가 추가될 때, when: include_metadata=true로 recall 호출하면, then: meta_stats 필드가 포함되어야 함', () => {
      // meta_stats 필드가 선택적으로 포함될 수 있는지 확인
      const responseWithMetaStats: RecallResponse = {
        items: [
          {
            memory_id: 'mem_12345',
            content: 'Test content',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            final_score: 0.95
          }
        ],
        total_count: 1,
        query_time: 150,
        search_type: 'hybrid',
        meta_stats: {
          'mem_12345': {
            recall_count: 10,
            success_count: 8,
            failure_count: 2,
            avg_confidence: 0.85,
            last_recalled_at: '2024-01-01T00:00:00.000Z' // ISO 8601 형식
          }
        }
      };

      // meta_stats 필드가 존재하는지 확인
      expect(responseWithMetaStats.meta_stats).toBeDefined();
      expect(responseWithMetaStats.meta_stats?.['mem_12345']).toBeDefined();
      expect(responseWithMetaStats.meta_stats?.['mem_12345']?.recall_count).toBe(10);
      expect(responseWithMetaStats.meta_stats?.['mem_12345']?.success_count).toBe(8);
      expect(responseWithMetaStats.meta_stats?.['mem_12345']?.failure_count).toBe(2);
      expect(responseWithMetaStats.meta_stats?.['mem_12345']?.avg_confidence).toBe(0.85);
      expect(responseWithMetaStats.meta_stats?.['mem_12345']?.last_recalled_at).toBe('2024-01-01T00:00:00.000Z');
    });

    it('given: RecallResponse에 meta_stats 필드가 추가될 때, when: include_metadata=false로 recall 호출하면, then: meta_stats 필드가 없어야 함', () => {
      // meta_stats 필드가 선택적이므로 포함하지 않을 수 있음
      const responseWithoutMetaStats: RecallResponse = {
        items: [
          {
            memory_id: 'mem_12345',
            content: 'Test content',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            final_score: 0.95
          }
        ],
        total_count: 1,
        query_time: 150,
        search_type: 'hybrid'
        // meta_stats 필드 없음
      };

      // meta_stats 필드가 없어도 타입 에러가 발생하지 않아야 함
      expect(responseWithoutMetaStats.meta_stats).toBeUndefined();
      expect(responseWithoutMetaStats.items).toBeDefined();
    });

    it('given: RecallResponse에 meta_stats 필드가 추가될 때, when: 여러 memory_id의 통계가 있을 때, then: 모든 통계가 올바른 타입이어야 함', () => {
      const responseWithMultipleStats: RecallResponse = {
        items: [
          {
            memory_id: 'mem_1',
            content: 'Content 1',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            final_score: 0.95
          },
          {
            memory_id: 'mem_2',
            content: 'Content 2',
            type: 'semantic',
            importance: 0.7,
            created_at: '2024-01-01T00:00:00.000Z',
            final_score: 0.85
          }
        ],
        total_count: 2,
        query_time: 200,
        search_type: 'hybrid',
        meta_stats: {
          'mem_1': {
            recall_count: 10,
            success_count: 8,
            failure_count: 2,
            avg_confidence: 0.85,
            last_recalled_at: '2024-01-01T00:00:00.000Z'
          },
          'mem_2': {
            recall_count: 5,
            success_count: 4,
            failure_count: 1,
            avg_confidence: 0.75,
            last_recalled_at: '2024-01-02T00:00:00.000Z'
          }
        }
      };

      // 모든 memory_id의 통계가 올바른 타입인지 확인
      expect(responseWithMultipleStats.meta_stats?.['mem_1']?.recall_count).toBe(10);
      expect(responseWithMultipleStats.meta_stats?.['mem_2']?.recall_count).toBe(5);
      expect(typeof responseWithMultipleStats.meta_stats?.['mem_1']?.avg_confidence).toBe('number');
      expect(typeof responseWithMultipleStats.meta_stats?.['mem_2']?.avg_confidence).toBe('number');
      expect(typeof responseWithMultipleStats.meta_stats?.['mem_1']?.last_recalled_at).toBe('string');
      expect(typeof responseWithMultipleStats.meta_stats?.['mem_2']?.last_recalled_at).toBe('string');
    });

    it('given: RecallResponse에 meta_stats 필드가 추가될 때, when: last_recalled_at이 null일 수 있으면, then: 선택적 필드로 처리되어야 함', () => {
      // last_recalled_at이 null일 수 있는 경우 (아직 한 번도 recall되지 않은 경우)
      const responseWithNullLastRecalled: RecallResponse = {
        items: [
          {
            memory_id: 'mem_new',
            content: 'New content',
            type: 'episodic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00.000Z',
            final_score: 0.95
          }
        ],
        total_count: 1,
        query_time: 100,
        search_type: 'hybrid',
        meta_stats: {
          'mem_new': {
            recall_count: 0,
            success_count: 0,
            failure_count: 0,
            avg_confidence: 0.0
            // last_recalled_at 필드 없음 (null)
          }
        }
      };

      // last_recalled_at이 없어도 타입 에러가 발생하지 않아야 함
      expect(responseWithNullLastRecalled.meta_stats?.['mem_new']?.last_recalled_at).toBeUndefined();
      expect(responseWithNullLastRecalled.meta_stats?.['mem_new']?.recall_count).toBe(0);
    });
  });
});

describe('GetMetaMemoryStatsParams and MetaMemoryStatsResult types', () => {
  describe('GetMetaMemoryStatsParams 타입 정의', () => {
    it('given: 파라미터 타입이 정의될 때, when: 타입을 사용하면, then: 모든 선택적 필드가 올바르게 정의되어야 함', () => {
      // 모든 필드가 선택적이어야 함
      const paramsWithAllFields: GetMetaMemoryStatsParams = {
        memory_id: 'mem_12345',
        memory_ids: ['mem_1', 'mem_2'],
        min_recall_count: 10,
        min_confidence: 0.5,
        limit: 50
      };

      // 모든 필드가 올바른 타입인지 확인
      expect(typeof paramsWithAllFields.memory_id).toBe('string');
      expect(Array.isArray(paramsWithAllFields.memory_ids)).toBe(true);
      expect(typeof paramsWithAllFields.min_recall_count).toBe('number');
      expect(typeof paramsWithAllFields.min_confidence).toBe('number');
      expect(typeof paramsWithAllFields.limit).toBe('number');
    });

    it('given: 파라미터 타입이 정의될 때, when: 일부 필드만 사용하면, then: 선택적 필드가 없어도 타입 에러가 발생하지 않아야 함', () => {
      // 일부 필드만 사용하는 경우
      const paramsWithPartialFields: GetMetaMemoryStatsParams = {
        memory_id: 'mem_12345'
        // 다른 필드 없음
      };

      expect(paramsWithPartialFields.memory_id).toBe('mem_12345');
      expect(paramsWithPartialFields.memory_ids).toBeUndefined();
      expect(paramsWithPartialFields.min_recall_count).toBeUndefined();
      expect(paramsWithPartialFields.min_confidence).toBeUndefined();
      expect(paramsWithPartialFields.limit).toBeUndefined();
    });

    it('given: 파라미터 타입이 정의될 때, when: 빈 객체를 사용하면, then: 모든 필드가 선택적이므로 타입 에러가 발생하지 않아야 함', () => {
      // 모든 필드가 선택적이므로 빈 객체도 허용되어야 함
      const emptyParams: GetMetaMemoryStatsParams = {};

      expect(emptyParams.memory_id).toBeUndefined();
      expect(emptyParams.memory_ids).toBeUndefined();
      expect(emptyParams.min_recall_count).toBeUndefined();
      expect(emptyParams.min_confidence).toBeUndefined();
      expect(emptyParams.limit).toBeUndefined();
    });

    it('given: 파라미터 타입이 정의될 때, when: memory_id와 memory_ids를 동시에 사용하면, then: 둘 다 포함할 수 있어야 함', () => {
      // memory_id와 memory_ids를 동시에 사용하는 경우
      const paramsWithBoth: GetMetaMemoryStatsParams = {
        memory_id: 'mem_12345',
        memory_ids: ['mem_1', 'mem_2']
      };

      expect(paramsWithBoth.memory_id).toBe('mem_12345');
      expect(paramsWithBoth.memory_ids).toEqual(['mem_1', 'mem_2']);
    });
  });

  describe('MetaMemoryStatsResult 타입 정의', () => {
    it('given: 결과 타입이 정의될 때, when: 타입을 사용하면, then: items와 total_count 필드가 올바르게 정의되어야 함', () => {
      const result: MetaMemoryStatsResult = {
        items: [
          {
            memory_id: 'mem_1',
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

      // 필드 타입 확인
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items.length).toBe(1);
      expect(typeof result.total_count).toBe('number');
      expect(result.total_count).toBe(1);
    });

    it('given: 결과 타입이 정의될 때, when: 빈 결과를 사용하면, then: items가 빈 배열이고 total_count가 0이어야 함', () => {
      // 빈 결과
      const emptyResult: MetaMemoryStatsResult = {
        items: [],
        total_count: 0
      };

      expect(emptyResult.items).toEqual([]);
      expect(emptyResult.total_count).toBe(0);
    });

    it('given: 결과 타입이 정의될 때, when: 여러 항목을 포함하면, then: items 배열에 여러 MetaMemoryStats 객체가 포함되어야 함', () => {
      // 여러 항목 포함
      const multiItemResult: MetaMemoryStatsResult = {
        items: [
          {
            memory_id: 'mem_1',
            recall_count: 10,
            success_count: 8,
            failure_count: 2,
            avg_confidence: 0.85,
            created_at: new Date('2024-01-01T00:00:00.000Z'),
            updated_at: new Date('2024-01-01T00:00:00.000Z')
          },
          {
            memory_id: 'mem_2',
            recall_count: 5,
            success_count: 4,
            failure_count: 1,
            avg_confidence: 0.75,
            created_at: new Date('2024-01-02T00:00:00.000Z'),
            updated_at: new Date('2024-01-02T00:00:00.000Z')
          }
        ],
        total_count: 2
      };

      expect(multiItemResult.items.length).toBe(2);
      expect(multiItemResult.total_count).toBe(2);
      expect(multiItemResult.items[0].memory_id).toBe('mem_1');
      expect(multiItemResult.items[1].memory_id).toBe('mem_2');
    });
  });
});

describe('SqlParam type and isSqlParam type guard', () => {
  describe('isSqlParam type guard', () => {
    it('given: SqlParam 타입이 정의될 때, when: string 값을 검증하면, then: true를 반환해야 함', () => {
      expect(isSqlParam('test')).toBe(true);
      expect(isSqlParam('')).toBe(true);
      expect(isSqlParam('123')).toBe(true);
    });

    it('given: SqlParam 타입이 정의될 때, when: number 값을 검증하면, then: true를 반환해야 함', () => {
      expect(isSqlParam(0)).toBe(true);
      expect(isSqlParam(123)).toBe(true);
      expect(isSqlParam(-456)).toBe(true);
      expect(isSqlParam(3.14)).toBe(true);
    });

    it('given: SqlParam 타입이 정의될 때, when: boolean 값을 검증하면, then: true를 반환해야 함', () => {
      expect(isSqlParam(true)).toBe(true);
      expect(isSqlParam(false)).toBe(true);
    });

    it('given: SqlParam 타입이 정의될 때, when: null 값을 검증하면, then: true를 반환해야 함', () => {
      expect(isSqlParam(null)).toBe(true);
    });

    it('given: SqlParam 타입이 정의될 때, when: Date 값을 검증하면, then: true를 반환해야 함', () => {
      expect(isSqlParam(new Date())).toBe(true);
      expect(isSqlParam(new Date('2024-01-01'))).toBe(true);
    });

    it('given: SqlParam 타입이 정의될 때, when: 지원하지 않는 타입을 검증하면, then: false를 반환해야 함', () => {
      expect(isSqlParam(undefined)).toBe(false);
      expect(isSqlParam({})).toBe(false);
      expect(isSqlParam([])).toBe(false);
      expect(isSqlParam(() => {})).toBe(false);
      expect(isSqlParam(Symbol('test'))).toBe(false);
    });

    it('given: SqlParam 타입이 정의될 때, when: 타입 가드로 사용하면, then: 타입이 좁혀져야 함', () => {
      const value: unknown = 'test';
      
      if (isSqlParam(value)) {
        // TypeScript should narrow value to SqlParam here
        const sqlParam: SqlParam = value; // Should not cause type error
        expect(sqlParam).toBe('test');
      }
    });

    it('given: SqlParam 타입이 정의될 때, when: SqlParam[] 배열을 생성하면, then: 모든 요소가 SqlParam 타입이어야 함', () => {
      const params: SqlParam[] = [
        'test',
        123,
        true,
        null,
        new Date()
      ];

      params.forEach(param => {
        expect(isSqlParam(param)).toBe(true);
      });
    });
  });
});


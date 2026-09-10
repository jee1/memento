/**
 * NHopLinkedMemoryService / getRelationTypeBoost 계약 고정 (#712)
 *
 * boostMap에 supported_by / extracted_from 을 추가하지 말 것 — #712.
 * 이 스펙은 "맵에 없으면 default 1.0" 경로를 고정한다.
 *
 * 참고(범위 밖, 고치지 않음):
 * - 키는 대문자(CAUSES)인데 DB relation_type은 소문자 스네이크 → causes 등도 default 1.0
 * - `|| 1.0` falsy fallback (0 등록 시 조용히 1.0)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import {
  getRelationTypeBoost,
  NHopLinkedMemoryService
} from './n-hop-linked-memory-service.js';
import type { IAnchorCacheService } from './anchor-interfaces.js';
import type { MemoryRelation } from '../../../../shared/types/relation-graph.js';
import {
  setupTestDatabase,
  createTestMemory,
  cleanupTestDatabase
} from '../../../../test/helpers/test-database.js';

describe('getRelationTypeBoost', () => {
  it('supported_by는 boostMap에 없으므로 default boost 1.0을 받는다', () => {
    // Given/When/Then
    expect(getRelationTypeBoost('supported_by')).toBe(1.0);
  });

  it('extracted_from은 boostMap에 없으므로 default boost 1.0을 받는다', () => {
    expect(getRelationTypeBoost('extracted_from')).toBe(1.0);
  });

  it('supported_by / extracted_from은 미등록 타입과 동일한 default 경로를 탄다', () => {
    const def = getRelationTypeBoost('__unregistered_relation_type__');
    expect(getRelationTypeBoost('supported_by')).toBe(def);
    expect(getRelationTypeBoost('extracted_from')).toBe(def);
  });

  it.each([
    ['CAUSES', 1.2],
    ['DEPENDS_ON', 1.1],
    ['FOLLOWS', 1.0],
    ['CONTRASTS_WITH', 0.9],
    ['REFERENCES', 0.8],
    ['BELONGS_TO', 1.0]
  ] as const)('명시적으로 등록된 관계 타입의 boost는 그대로 유지된다 (%s → %s)', (type, boost) => {
    expect(getRelationTypeBoost(type)).toBe(boost);
  });

  it('알 수 없는 관계 타입과 빈 문자열도 1.0으로 폴백한다', () => {
    expect(getRelationTypeBoost('UNKNOWN_TYPE')).toBe(1.0);
    expect(getRelationTypeBoost('')).toBe(1.0);
  });
});

describe('NHopLinkedMemoryService.getLinkedMemoriesBatch — default boost 전파', () => {
  let db: Database.Database;
  const cacheServiceStub = {
    getAnchorEmbedding: async () => null
  } as unknown as IAnchorCacheService;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  function makeFakeRelationGraph(relation: {
    target_id: string;
    relation_type: MemoryRelation['relation_type'];
    confidence: number;
  }) {
    const memoryRelation = {
      id: 1,
      source_id: 'm1',
      target_id: relation.target_id,
      relation_type: relation.relation_type,
      confidence: relation.confidence,
      created_at: new Date('2024-01-01T00:00:00Z'),
      updated_at: new Date('2024-01-01T00:00:00Z')
    } satisfies MemoryRelation;

    return {
      getRelations: async () => [memoryRelation],
      getRelationsBatch: async (memoryIds: string[]) => {
        const map = new Map<string, MemoryRelation[]>();
        for (const id of memoryIds) {
          map.set(id, id === 'm1' ? [memoryRelation] : []);
        }
        return map;
      }
    };
  }

  it('supported_by 관계의 similarity는 confidence를 그대로 보존한다 (boost 1.0)', async () => {
    // Given
    createTestMemory(db, {
      id: 'm2',
      content: 'semantic evidence',
      type: 'semantic',
      importance: 0.6
    });
    const fakeRelationGraph = makeFakeRelationGraph({
      target_id: 'm2',
      relation_type: 'supported_by',
      confidence: 0.7
    });
    const service = new NHopLinkedMemoryService(
      cacheServiceStub,
      () => db,
      () => fakeRelationGraph
    );

    // When
    const result = await service.getLinkedMemoriesBatch(['m1']);

    // Then: boost 1.0 → similarity === confidence
    expect(result.get('m1')![0].similarity).toBeCloseTo(0.7, 10);
  });

  it('extracted_from 관계의 similarity도 confidence를 그대로 보존한다', async () => {
    // Given
    createTestMemory(db, {
      id: 'm2',
      content: 'episodic source',
      type: 'episodic',
      importance: 0.5
    });
    const fakeRelationGraph = makeFakeRelationGraph({
      target_id: 'm2',
      relation_type: 'extracted_from',
      confidence: 0.85
    });
    const service = new NHopLinkedMemoryService(
      cacheServiceStub,
      () => db,
      () => fakeRelationGraph
    );

    // When
    const result = await service.getLinkedMemoriesBatch(['m1']);

    // Then
    expect(result.get('m1')![0].similarity).toBeCloseTo(0.85, 10);
  });
});

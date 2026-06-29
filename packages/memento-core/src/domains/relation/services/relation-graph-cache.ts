/**
 * 관계 그래프 캐시 (L1/L2 + 키 인덱스)
 */

import type { ICacheService } from '../../../shared/interfaces/cache.interface.js';
import type { GetRelationsOptions, MemoryRelation } from '../../../shared/types/relation-graph.js';
import { CacheKeyGenerator } from '../../../shared/utils/cache-key-generator.js';

export class RelationGraphCache {
  private cacheKeyIndex: Map<string, Set<string>> = new Map();

  constructor(
    private l1Cache: ICacheService<MemoryRelation[]>,
    private l2Cache: ICacheService<MemoryRelation[]>
  ) {}

  /**
   * 캐시 키 생성
   */
  generateCacheKey(memoryId: string, options?: GetRelationsOptions): string {
    return CacheKeyGenerator.generateRelationGraphKey(memoryId, {
      direction: options?.direction,
      relationTypes: options?.relationTypes,
      minConfidence: options?.minConfidence,
      limit: options?.limit,
      offset: options?.offset
    });
  }

  /**
   * 캐시 키를 인덱스에 추가
   */
  addCacheKeyToIndex(memoryId: string, cacheKey: string): void {
    if (!this.cacheKeyIndex.has(memoryId)) {
      this.cacheKeyIndex.set(memoryId, new Set());
    }
    this.cacheKeyIndex.get(memoryId)!.add(cacheKey);
  }

  /**
   * L1 → L2 순으로 캐시 조회 (L2 히트 시 L1에 승격)
   */
  get(cacheKey: string): MemoryRelation[] | undefined {
    const l1Cached = this.l1Cache.get(cacheKey);
    if (l1Cached) {
      return l1Cached;
    }

    const l2Cached = this.l2Cache.get(cacheKey);
    if (l2Cached) {
      this.l1Cache.set(cacheKey, l2Cached);
      return l2Cached;
    }

    return undefined;
  }

  /**
   * L1/L2 캐시에 저장하고 인덱스에 등록
   */
  set(cacheKey: string, memoryId: string, relations: MemoryRelation[]): void {
    this.l1Cache.set(cacheKey, relations);
    this.l2Cache.set(cacheKey, relations);
    this.addCacheKeyToIndex(memoryId, cacheKey);
  }

  /**
   * 특정 메모리 ID와 관련된 캐시 무효화
   */
  invalidate(memoryId: string): void {
    const cacheKeys = this.cacheKeyIndex.get(memoryId);

    if (cacheKeys && cacheKeys.size > 0) {
      for (const cacheKey of cacheKeys) {
        this.l1Cache.delete(cacheKey);
        this.l2Cache.delete(cacheKey);
      }
      this.cacheKeyIndex.delete(memoryId);
      return;
    }

    const cacheKeyPrefix = `relation_graph:${memoryId}:`;
    const allL1Keys = this.l1Cache.keys();
    const allL2Keys = this.l2Cache.keys();

    for (const key of allL1Keys) {
      if (key.startsWith(cacheKeyPrefix)) {
        this.l1Cache.delete(key);
      }
    }

    for (const key of allL2Keys) {
      if (key.startsWith(cacheKeyPrefix)) {
        this.l2Cache.delete(key);
      }
    }
  }
}

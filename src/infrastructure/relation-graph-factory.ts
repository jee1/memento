/**
 * RelationGraph 팩토리 (DIP)
 * 도메인 RelationGraph는 ICacheService만 의존하고, 이 팩토리에서 인프라 CacheService를 주입.
 */

import Database from 'better-sqlite3';
import { RelationGraph } from '../domains/relation/services/relation-graph.js';
import { CacheService } from './cache/cache-service.js';
import { CACHE } from '../shared/constants/relation-constants.js';
import type { MemoryRelation } from '../shared/types/relation-graph.js';

/**
 * RelationGraph 인스턴스 생성 (L1/L2 캐시 주입)
 */
export function createRelationGraph(db: Database.Database): RelationGraph {
  const l1Cache = new CacheService<MemoryRelation[]>(CACHE.L1_SIZE, CACHE.L1_TTL_MS);
  const l2Cache = new CacheService<MemoryRelation[]>(CACHE.L2_SIZE, CACHE.L2_TTL_MS);
  return new RelationGraph(db, l1Cache, l2Cache);
}

/**
 * 관계 그래프 서비스
 * 기억 간의 관계를 저장하고 관리하는 서비스
 *
 * 주요 기능:
 * - 관계 추가/삭제/조회
 * - 순환 참조 감지 (DFS)
 * - N-hop 관계 탐색 (BFS)
 * - 신뢰도 갱신
 * - 캐싱 계층 (L1: MemoryCache 10분, L2: PersistentCache 7일)
 * - 배치 삽입 최적화
 */

import Database from 'better-sqlite3';
import type { ICacheService } from '../../../shared/interfaces/cache.interface.js';
import type {
  AddRelationOptions,
  GetRelatedMemoriesOptions,
  GetRelationsOptions,
  IRelationGraph,
  MemoryRelation,
  RelationMetadata
} from '../../../shared/types/relation-graph.js';
import type { RelationType } from '../../../shared/types/relation.js';
import { RelationGraphCache } from './relation-graph-cache.js';
import { RelationGraphCycleDetector } from './relation-graph-cycle-detector.js';
import { RelationGraphMutations } from './relation-graph-mutations.js';
import { RelationGraphQuery } from './relation-graph-query.js';
import type { RelatedMemoryResult } from './relation-graph-traversal.js';
import { RelationGraphTraversal } from './relation-graph-traversal.js';

export type { RelatedMemoryResult };

/**
 * 관계 그래프 서비스 (composition 오케스트레이터)
 */
export class RelationGraph implements IRelationGraph {
  private cache: RelationGraphCache;
  private cycleDetector: RelationGraphCycleDetector;
  private query: RelationGraphQuery;
  private traversal: RelationGraphTraversal;
  private mutations: RelationGraphMutations;

  constructor(
    db: Database.Database,
    l1Cache: ICacheService<MemoryRelation[]>,
    l2Cache: ICacheService<MemoryRelation[]>
  ) {
    this.cache = new RelationGraphCache(l1Cache, l2Cache);
    this.cycleDetector = new RelationGraphCycleDetector(db);
    this.query = new RelationGraphQuery(db, this.cache);
    this.traversal = new RelationGraphTraversal(db);
    this.mutations = new RelationGraphMutations(db, this.cache, this.cycleDetector);
  }

  async addRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    options?: AddRelationOptions
  ): Promise<number> {
    return this.mutations.addRelation(sourceId, targetId, relationType, options);
  }

  async getRelations(
    memoryId: string,
    options?: GetRelationsOptions
  ): Promise<MemoryRelation[]> {
    return this.query.getRelations(memoryId, options);
  }

  async getRelationsBatch(
    memoryIds: string[],
    options?: GetRelationsOptions
  ): Promise<Map<string, MemoryRelation[]>> {
    return this.query.getRelationsBatch(memoryIds, options);
  }

  async getRelatedMemories(
    memoryId: string,
    options?: GetRelatedMemoriesOptions
  ): Promise<RelatedMemoryResult[]> {
    return this.traversal.getRelatedMemories(memoryId, options);
  }

  async removeRelation(
    sourceId: string,
    targetId: string,
    relationType: RelationType
  ): Promise<boolean> {
    return this.mutations.removeRelation(sourceId, targetId, relationType);
  }

  async updateConfidence(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    newConfidence: number,
    reason?: string
  ): Promise<boolean> {
    return this.mutations.updateConfidence(
      sourceId,
      targetId,
      relationType,
      newConfidence,
      reason
    );
  }

  async detectCycle(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    maxDepth?: number
  ): Promise<boolean> {
    return this.cycleDetector.detectCycle(sourceId, targetId, relationType, maxDepth);
  }

  async addRelationsBatch(
    relations: Array<{
      source_id: string;
      target_id: string;
      relation_type: RelationType;
      confidence?: number;
      metadata?: RelationMetadata;
    }>
  ): Promise<{
    insertedIds: number[];
    failed: Array<{
      source_id: string;
      target_id: string;
      relation_type: RelationType;
      error: string;
    }>;
    total: number;
    success: number;
    failedCount: number;
  }> {
    return this.mutations.addRelationsBatch(relations);
  }
}

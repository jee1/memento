/**
 * N-hop 검색 서비스 인터페이스 및 구현
 * Phase 2.3: anchor-search-service.ts 분리
 */

import type Database from 'better-sqlite3';
import type { VectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';
import type { IAnchorCacheService } from './anchor-interfaces.js';
import type { RelationGraph } from '../../../relation/services/relation-graph.js';
import { isInitializableVectorSearchEngine } from './vector-search-engine-types.js';
import { getRelationTypeBoost, NHopLinkedMemoryService } from './n-hop-linked-memory-service.js';
import type { LinkedMemorySummary } from './n-hop-linked-memory-service.js';
import { logger } from '../../../../shared/utils/logger.js';

/**
 * N-hop 검색 결과
 */
export interface NHopSearchResult {
  memory_id: string;
  content: string;
  type: string;
  similarity: number;
  hop_distance: number;
  importance: number;
  created_at: string;
  tags?: string[];
  hasRelation?: boolean;
  /** 이 메모리를 발견한 실제 경로상의 직전 노드 (hop 1이면 anchor memory id) */
  predecessor_id?: string;
  /** 이 메모리로 이어지는 모든 유효 경로의 직전 노드 목록 (anchor→m1→x, anchor→m2→x처럼
   *  여러 경로가 같은 메모리로 합류할 때, 노드는 dedup되어도 경로 edge는 모두 보존한다, #715) */
  predecessor_ids?: string[];
}

/**
 * 1-hop 검색 결과
 */
export interface OneHopSearchResult {
  memory_id: string;
  content: string;
  type: string;
  similarity: number;
  importance: number;
  created_at: string;
  tags?: string[];
}

/**
 * N-hop 검색 서비스 인터페이스
 */
export interface INHopSearchService {
  /**
   * 1-hop 검색: 앵커와 직접적으로 유사한 메모리 검색
   */
  searchOneHop(
    anchorEmbedding: number[],
    provider: string,
    anchorMemoryId: string,
    threshold: number,
    limit: number
  ): Promise<OneHopSearchResult[]>;

  /**
   * N-hop 검색: 앵커를 기준으로 최대 N-hop까지 확장 검색
   */
  searchNHop(
    anchorEmbedding: number[] | null,
    provider: string,
    anchorMemoryId: string,
    threshold: number,
    maxHops: number,
    limit: number,
    useRelations?: boolean
  ): Promise<NHopSearchResult[]>;
}

/**
 * N-hop 검색 서비스 구현
 */
export class NHopSearchService implements INHopSearchService {
  private db: Database.Database | null = null;
  private vectorSearchEngine: VectorSearchEngine | null = null;
  private relationGraph: RelationGraph | null = null;
  private linkedMemoryService: NHopLinkedMemoryService;

  constructor(cacheService: IAnchorCacheService) {
    this.linkedMemoryService = new NHopLinkedMemoryService(
      cacheService,
      () => this.db,
      () => this.relationGraph
    );
  }

  /**
   * 데이터베이스 설정
   */
  setDatabase(db: Database.Database): void {
    if (!db) {
      throw new Error('Database instance is required');
    }
    this.db = db;
  }

  /**
   * 벡터 검색 엔진 설정
   */
  setVectorSearchEngine(vectorSearchEngine: VectorSearchEngine): void {
    if (!vectorSearchEngine) {
      throw new Error('VectorSearchEngine is required');
    }
    this.vectorSearchEngine = vectorSearchEngine;
    if (this.db) {
      if (isInitializableVectorSearchEngine(this.vectorSearchEngine)) {
        this.vectorSearchEngine.initialize(this.db);
      }
    }
  }

  /**
   * 관계 그래프 설정
   */
  setRelationGraph(relationGraph: RelationGraph): void {
    this.relationGraph = relationGraph;
  }

  private requireVectorContext(): {
    engine: VectorSearchEngine;
    db: Database.Database;
  } {
    if (!this.vectorSearchEngine || !this.db) {
      throw new Error('VectorSearchEngine or Database is not set.');
    }
    const engine = this.vectorSearchEngine;
    const db = this.db;
    if (isInitializableVectorSearchEngine(engine)) {
      engine.initialize(db);
    }
    return { engine, db };
  }

  private compareNHopRankedResults(a: NHopSearchResult, b: NHopSearchResult): number {
    if (a.hasRelation && !b.hasRelation) {
      return -1;
    }
    if (!a.hasRelation && b.hasRelation) {
      return 1;
    }
    if (Math.abs(a.similarity - b.similarity) < 0.001) {
      return a.hop_distance - b.hop_distance;
    }
    return b.similarity - a.similarity;
  }

  private async applyRelationWeightToNHopResult(
    result: NHopSearchResult,
    useRelations: boolean
  ): Promise<NHopSearchResult> {
    let relationWeight = 0;
    let hasRelation = result.hasRelation ?? false;

    if (useRelations && this.relationGraph) {
      try {
        const relations = await this.relationGraph.getRelations(result.memory_id, {
          direction: 'both',
          minConfidence: 0.5
        });

        if (relations.length > 0) {
          hasRelation = true;
          const avgConfidence = relations.reduce((sum, r) => sum + r.confidence, 0) / relations.length;
          const avgBoost =
            relations.reduce((sum, r) => sum + getRelationTypeBoost(r.relation_type), 0) /
            relations.length;
          relationWeight = Math.min(1.0, avgConfidence * avgBoost);
        }
      } catch (error) {
        logger.debug('Relation weight calculation failed', {
          memoryId: result.memory_id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const rankingScore = this.calculateRankingScore(
      result.similarity,
      result.hop_distance,
      result.importance,
      relationWeight,
      hasRelation
    );
    return {
      ...result,
      similarity: rankingScore,
      hasRelation
    };
  }

  private async rankAndTruncateNHopResults(
    allResults: NHopSearchResult[],
    useRelations: boolean,
    limit: number
  ): Promise<NHopSearchResult[]> {
    const rankedResults = await Promise.all(
      allResults.map((r) => this.applyRelationWeightToNHopResult(r, useRelations))
    );
    rankedResults.sort((a, b) => this.compareNHopRankedResults(a, b));
    return rankedResults.slice(0, limit);
  }

  /**
   * 1-hop 검색: 앵커와 직접적으로 유사한 메모리 검색
   */
  async searchOneHop(
    anchorEmbedding: number[],
    provider: string,
    anchorMemoryId: string,
    threshold: number,
    limit: number
  ): Promise<OneHopSearchResult[]> {
    try {
      const { engine } = this.requireVectorContext();

      // 벡터 검색 실행 (임계값은 낮게 설정하고 나중에 필터링)
      const searchResults = await engine.search(
        anchorEmbedding,
        {
          limit: limit + 1, // 자기 자신 제외를 위해 +1
          threshold: 0.0, // 임계값은 나중에 필터링에서 적용
          includeContent: true,
          includeMetadata: true
        },
        provider
      );

      // 결과 필터링: 앵커 메모리 제외, 유사도 임계값 이상만 반환
      const filteredResults = searchResults
        .filter(result => {
          // 앵커 메모리 제외
          if (result.memory_id === anchorMemoryId) {
            return false;
          }
          // 유사도 임계값 이상만 반환
          return result.similarity >= threshold;
        })
        .slice(0, limit); // 최종 limit 적용

      return filteredResults;
    } catch (error) {
      logger.error('1-hop search failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`Failed to perform 1-hop search: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * N-hop 검색: 앵커를 기준으로 최대 N-hop까지 확장 검색
   */
  async searchNHop(
    anchorEmbedding: number[] | null,
    provider: string,
    anchorMemoryId: string,
    threshold: number,
    maxHops: number,
    limit: number,
    useRelations: boolean = true
  ): Promise<NHopSearchResult[]> {
    if (!this.db) {
      throw new Error('Database is not set.');
    }

    const engine = anchorEmbedding
      ? this.requireVectorContext().engine
      : this.vectorSearchEngine;
    if (engine && isInitializableVectorSearchEngine(engine)) {
      engine.initialize(this.db);
    }

    const discoveredMemoryIds = new Set<string>([anchorMemoryId]);
    // memory_id -> 그 메모리로 이어지는 모든 유효 경로의 predecessor id 집합 (#715 MEDIUM#1)
    const predecessorsByMemoryId = new Map<string, Set<string>>();
    const allResults: NHopSearchResult[] = [];
    let currentHopMemories: Array<{ memory_id: string; embedding?: number[]; provider?: string }> = [
      {
        memory_id: anchorMemoryId,
        ...(anchorEmbedding ? { embedding: anchorEmbedding, provider } : {})
      }
    ];

    for (let hop = 1; hop <= maxHops; hop++) {
      const nextHopMemories: Array<{ memory_id: string; embedding?: number[]; provider?: string }> = [];
      const hopResults: NHopSearchResult[] = [];
      const vectorSearchLimit = Math.min(
        100,
        Math.max(1, Math.ceil(limit / maxHops) + 10)
      );

      const memoryIdsThisHop = currentHopMemories.map(m => m.memory_id);
      const linkedByMemory = useRelations
        ? await this.linkedMemoryService.getLinkedMemoriesBatch(memoryIdsThisHop)
        : new Map<string, LinkedMemorySummary[]>();

      const vectorResults = await Promise.all(
        currentHopMemories.map((m) =>
          engine && m.embedding
            ? engine.search(
                m.embedding,
                {
                  limit: vectorSearchLimit,
                  threshold: 0.0,
                  includeContent: true,
                  includeMetadata: true
                },
                m.provider ?? provider
              )
            : Promise.resolve([])
        )
      );

      for (let idx = 0; idx < currentHopMemories.length; idx++) {
        const currentMemory = currentHopMemories[idx];
        if (!currentMemory) continue;
        const linkedMemories = linkedByMemory.get(currentMemory.memory_id) ?? [];
        const vectorSearchResults = vectorResults[idx] ?? [];
        try {
          const merged = this.linkedMemoryService.mergeHopCandidates(
            linkedMemories,
            vectorSearchResults,
            discoveredMemoryIds,
            threshold
          );
          const { hopResults: batchHop, nextHopSeeds } = await this.linkedMemoryService.materializeHopDiscoveries(
            hop,
            maxHops,
            merged,
            discoveredMemoryIds,
            threshold,
            currentMemory.memory_id,
            predecessorsByMemoryId
          );
          hopResults.push(...batchHop);
          nextHopMemories.push(...nextHopSeeds);
        } catch (error) {
          logger.error('Hop search failed', {
            hop,
            memoryId: currentMemory.memory_id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      allResults.push(...hopResults);

      if (allResults.length >= limit) {
        break;
      }
      if (nextHopMemories.length === 0) {
        break;
      }
      currentHopMemories = nextHopMemories;
    }

    // 여러 경로가 같은 메모리로 합류한 경우, 모든 predecessor를 결과에 반영한다 (#715 MEDIUM#1)
    for (const result of allResults) {
      const predecessors = predecessorsByMemoryId.get(result.memory_id);
      if (predecessors && predecessors.size > 0) {
        result.predecessor_ids = Array.from(predecessors);
      }
    }

    return this.rankAndTruncateNHopResults(allResults, useRelations, limit);
  }

  /**
   * 검색 결과 랭킹 점수 계산
   */
  private calculateRankingScore(
    similarity: number,
    hopDistance: number,
    importance: number = 0.5,
    relationWeight: number = 0,
    hasRelation: boolean = false
  ): number {
    const hopDecayFactor = 1.0 / (1.0 + (hopDistance - 1) * 0.3);
    const anchorProximityBoost = hopDistance === 1 ? 1.2 : 1.0;
    const importanceWeight = 0.1;
    const importanceBoost = 1.0 + (importance - 0.5) * importanceWeight;
    
    // 관계 가중치가 있으면 벡터 유사도와 결합
    let combinedSimilarity = similarity;
    if (relationWeight > 0) {
      // 관계 가중치와 벡터 유사도를 가중 평균으로 결합
      // 관계 가중치: 30%, 벡터 유사도: 70%
      combinedSimilarity = similarity * 0.7 + relationWeight * 0.3;
    }
    
    // 관계가 있는 기억에 우선순위 부스트 적용
    const relationPriorityBoost = hasRelation ? 1.15 : 1.0; // 15% 부스트
    
    const rankingScore = Math.min(
      1.0,
      combinedSimilarity * hopDecayFactor * anchorProximityBoost * importanceBoost * relationPriorityBoost
    );
    
    return rankingScore;
  }
}

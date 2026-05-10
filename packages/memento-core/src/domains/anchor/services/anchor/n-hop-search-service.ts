/**
 * N-hop 검색 서비스 인터페이스 및 구현
 * Phase 2.3: anchor-search-service.ts 분리
 */

import type Database from 'better-sqlite3';
import type {
  VectorSearchEngine,
  VectorSearchResult
} from '../../../search/algorithms/vector-search-engine.js';
import type { IAnchorCacheService } from './anchor-interfaces.js';
import type { RelationGraph } from '../../../relation/services/relation-graph.js';
import { isInitializableVectorSearchEngine } from './vector-search-engine-types.js';
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

/** memory_link / relation 그래프에서 수집한 1차 연결 메모리 요약 */
type LinkedMemorySummary = {
  memory_id: string;
  content: string;
  type: string;
  similarity: number;
  importance: number;
  created_at: string;
  tags?: string[];
};

type HopCandidate = LinkedMemorySummary & { isLinked: boolean };

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
    anchorEmbedding: number[],
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
  private cacheService: IAnchorCacheService;
  private vectorSearchEngine: VectorSearchEngine | null = null;
  private relationGraph: RelationGraph | null = null;

  constructor(cacheService: IAnchorCacheService) {
    this.cacheService = cacheService;
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

  private mergeHopCandidates(
    linkedMemories: LinkedMemorySummary[],
    vectorSearchResults: VectorSearchResult[],
    discoveredMemoryIds: Set<string>,
    threshold: number
  ): Map<string, HopCandidate> {
    const allCandidates = new Map<string, HopCandidate>();
    const relaxedThreshold = threshold * 0.5;

    for (const linked of linkedMemories) {
      if (!discoveredMemoryIds.has(linked.memory_id)) {
        allCandidates.set(linked.memory_id, {
          ...linked,
          isLinked: true
        });
      }
    }

    for (const result of vectorSearchResults) {
      if (!allCandidates.has(result.memory_id) && !discoveredMemoryIds.has(result.memory_id)) {
        if (result.similarity >= relaxedThreshold) {
          allCandidates.set(result.memory_id, {
            memory_id: result.memory_id,
            content: result.content,
            type: result.type,
            similarity: result.similarity,
            importance: result.importance,
            created_at: result.created_at,
            tags: result.tags,
            isLinked: false
          });
        }
      } else if (allCandidates.has(result.memory_id)) {
        const existing = allCandidates.get(result.memory_id)!;
        existing.similarity = Math.max(existing.similarity, result.similarity);
      }
    }

    return allCandidates;
  }

  private async tryGetNextHopSeed(
    memoryId: string
  ): Promise<{ memory_id: string; embedding: number[] } | null> {
    try {
      const nextEmbedding = await this.cacheService.getAnchorEmbedding(memoryId);
      if (nextEmbedding?.embedding) {
        return { memory_id: memoryId, embedding: nextEmbedding.embedding };
      }
    } catch (error) {
      logger.debug('Skipping memory for next hop (no embedding)', {
        memoryId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return null;
  }

  private async materializeHopDiscoveries(
    hop: number,
    maxHops: number,
    allCandidates: Map<string, HopCandidate>,
    discoveredMemoryIds: Set<string>,
    threshold: number
  ): Promise<{
    hopResults: NHopSearchResult[];
    nextHopSeeds: Array<{ memory_id: string; embedding: number[] }>;
  }> {
    const hopResults: NHopSearchResult[] = [];
    const nextHopSeeds: Array<{ memory_id: string; embedding: number[] }> = [];

    for (const [memoryId, candidate] of allCandidates.entries()) {
      if (discoveredMemoryIds.has(memoryId)) {
        continue;
      }

      const effectiveThreshold = candidate.isLinked ? threshold * 0.8 : threshold;
      if (candidate.similarity < effectiveThreshold) {
        continue;
      }

      discoveredMemoryIds.add(memoryId);
      hopResults.push({
        memory_id: candidate.memory_id,
        content: candidate.content,
        type: candidate.type,
        similarity: candidate.similarity,
        hop_distance: hop,
        importance: candidate.importance,
        created_at: candidate.created_at,
        tags: candidate.tags,
        hasRelation: candidate.isLinked
      });

      if (hop < maxHops) {
        const seed = await this.tryGetNextHopSeed(candidate.memory_id);
        if (seed) {
          nextHopSeeds.push(seed);
        }
      }
    }

    return { hopResults, nextHopSeeds };
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
            relations.reduce((sum, r) => sum + this.getRelationTypeBoost(r.relation_type), 0) /
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
    anchorEmbedding: number[],
    provider: string,
    anchorMemoryId: string,
    threshold: number,
    maxHops: number,
    limit: number,
    useRelations: boolean = true
  ): Promise<NHopSearchResult[]> {
    const { engine } = this.requireVectorContext();

    const discoveredMemoryIds = new Set<string>([anchorMemoryId]);
    const allResults: NHopSearchResult[] = [];
    let currentHopMemories: Array<{ memory_id: string; embedding: number[] }> = [
      { memory_id: anchorMemoryId, embedding: anchorEmbedding }
    ];

    for (let hop = 1; hop <= maxHops; hop++) {
      const nextHopMemories: Array<{ memory_id: string; embedding: number[] }> = [];
      const hopResults: NHopSearchResult[] = [];
      const vectorSearchLimit = Math.min(
        100,
        Math.max(1, Math.ceil(limit / maxHops) + 10)
      );

      const memoryIdsThisHop = currentHopMemories.map(m => m.memory_id);
      const linkedByMemory = useRelations
        ? await this.getLinkedMemoriesBatch(memoryIdsThisHop)
        : new Map<string, LinkedMemorySummary[]>();

      const vectorResults = await Promise.all(
        currentHopMemories.map((m) =>
          engine.search(
            m.embedding,
            {
              limit: vectorSearchLimit,
              threshold: 0.0,
              includeContent: true,
              includeMetadata: true
            },
            provider
          )
        )
      );

      for (let idx = 0; idx < currentHopMemories.length; idx++) {
        const currentMemory = currentHopMemories[idx];
        if (!currentMemory) continue;
        const linkedMemories = linkedByMemory.get(currentMemory.memory_id) ?? [];
        const vectorSearchResults = vectorResults[idx] ?? [];
        try {
          const merged = this.mergeHopCandidates(
            linkedMemories,
            vectorSearchResults,
            discoveredMemoryIds,
            threshold
          );
          const { hopResults: batchHop, nextHopSeeds } = await this.materializeHopDiscoveries(
            hop,
            maxHops,
            merged,
            discoveredMemoryIds,
            threshold
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

    return this.rankAndTruncateNHopResults(allResults, useRelations, limit);
  }

  /**
   * 여러 메모리에 대한 연결 메모리 일괄 조회 (N+1 완화)
   */
  private async getLinkedMemoriesBatch(memoryIds: string[]): Promise<Map<string, LinkedMemorySummary[]>> {
    const result = new Map<string, LinkedMemorySummary[]>();
    memoryIds.forEach(id => result.set(id, []));
    if (memoryIds.length === 0 || !this.db) return result;

    if (this.relationGraph) {
      const relationsByMemory = await this.relationGraph.getRelationsBatch(memoryIds, {
        direction: 'outgoing',
        minConfidence: 0.5
      });
      const allTargetIds = new Set<string>();
      relationsByMemory.forEach((rels) => {
        rels.forEach((r) => allTargetIds.add(r.target_id));
      });
      if (allTargetIds.size === 0) return result;
      const placeholders = Array.from(allTargetIds).map(() => '?').join(',');
      const memoryRecords = this.db.prepare(
        `SELECT id, content, type, importance, created_at, tags FROM memory_item WHERE id IN (${placeholders})`
      ).all(...Array.from(allTargetIds)) as Array<{ id: string; content: string; type: string; importance: number; created_at: string; tags?: string }>;
      const memoryMap = new Map(memoryRecords.map(m => [m.id, m]));

      relationsByMemory.forEach((rels, sourceId) => {
        const items = rels.map((relation) => {
          const memory = memoryMap.get(relation.target_id);
          if (!memory) return null;
          const typeBoost = this.getRelationTypeBoost(relation.relation_type);
          const similarity = Math.min(1.0, relation.confidence * typeBoost);
          return {
            memory_id: memory.id,
            content: memory.content,
            type: memory.type,
            similarity,
            importance: memory.importance,
            created_at: memory.created_at,
            tags: memory.tags ? (typeof memory.tags === 'string' ? JSON.parse(memory.tags) : memory.tags) : undefined
          };
        }).filter((item): item is NonNullable<typeof item> => item !== null);
        result.set(sourceId, items);
      });
      return result;
    }

    const batchResults = await Promise.all(memoryIds.map((id) => this.getLinkedMemories(id)));
    memoryIds.forEach((id, i) => result.set(id, batchResults[i] ?? []));
    return result;
  }

  /**
   * 연결된 메모리 조회 (관계 그래프 또는 memory_link 사용)
   */
  private async getLinkedMemories(memoryId: string): Promise<LinkedMemorySummary[]> {
    if (!this.db) {
      return [];
    }

    try {
      // 관계 그래프가 있으면 우선 사용
      if (this.relationGraph) {
        const relations = await this.relationGraph.getRelations(memoryId, {
          direction: 'outgoing',
          minConfidence: 0.5
        });

        if (relations.length > 0) {
          // 관계를 메모리 정보와 결합
          // SQL Injection 방지: placeholders는 이미 ? 플레이스홀더로 구성되어 있어 안전함
          const memoryIds = relations.map(r => r.target_id);
          const placeholders = memoryIds.map(() => '?').join(',');
          const memoryRecords = this.db.prepare(
            `SELECT id, content, type, importance, created_at, tags ` +
            `FROM memory_item ` +
            `WHERE id IN (${placeholders})`
          ).all(...memoryIds) as Array<{
            id: string;
            content: string;
            type: string;
            importance: number;
            created_at: string;
            tags?: string;
          }>;

          // 관계 정보와 메모리 정보 결합
          const memoryMap = new Map(memoryRecords.map(m => [m.id, m]));
          
          return relations.map(relation => {
            const memory = memoryMap.get(relation.target_id);
            if (!memory) {
              return null;
            }

            // 관계 confidence를 similarity로 사용 (관계가 있으면 높은 유사도)
            // 관계 유형별 부스트 적용
            const typeBoost = this.getRelationTypeBoost(relation.relation_type);
            const similarity = Math.min(1.0, relation.confidence * typeBoost);

            return {
              memory_id: memory.id,
              content: memory.content,
              type: memory.type,
              similarity,
              importance: memory.importance,
              created_at: memory.created_at,
              tags: memory.tags ? JSON.parse(memory.tags) : undefined
            };
          }).filter((item): item is NonNullable<typeof item> => item !== null);
        }
      }

      // 관계 그래프가 없거나 관계가 없으면 memory_link 사용 (하위 호환성)
      const linkedRecords = this.db.prepare(`
        SELECT 
          ml.target_id as memory_id,
          mi.content,
          mi.type,
          mi.importance,
          mi.created_at,
          mi.tags,
          ml.relation_type
        FROM memory_link ml
        JOIN memory_item mi ON mi.id = ml.target_id
        WHERE ml.source_id = ?
        ORDER BY ml.created_at DESC
      `).all(memoryId) as Array<{
        memory_id: string;
        content: string;
        type: string;
        importance: number;
        created_at: string;
        tags?: string;
        relation_type: string;
      }>;

      return linkedRecords.map(record => ({
        memory_id: record.memory_id,
        content: record.content,
        type: record.type,
        similarity: 0.9, // memory_link는 기본 유사도 0.9
        importance: record.importance,
        created_at: record.created_at,
        tags: record.tags ? (typeof record.tags === 'string' ? JSON.parse(record.tags) : record.tags) : undefined
      }));
    } catch (error) {
      logger.error('memory_link retrieval failed', {
        memoryId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * 관계 유형별 부스트 가중치 반환
   */
  private getRelationTypeBoost(relationType: string): number {
    const boostMap: Record<string, number> = {
      'CAUSES': 1.2,
      'DEPENDS_ON': 1.1,
      'FOLLOWS': 1.0,
      'CONTRASTS_WITH': 0.9,
      'REFERENCES': 0.8,
      'BELONGS_TO': 1.0
    };
    return boostMap[relationType] || 1.0;
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

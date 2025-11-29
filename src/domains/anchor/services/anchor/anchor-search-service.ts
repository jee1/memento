/**
 * Anchor Search Service
 * 검색 관련 로직 담당
 * Phase 1.1: anchor-manager.ts 리팩토링
 */

import type Database from 'better-sqlite3';
import type { HybridSearchEngine } from '../../domains/search/algorithms/hybrid-search-engine.js';
import type { VectorSearchEngine } from '../../algorithms/vector-search-engine.js';
import { UnifiedEmbeddingService } from '../unified-embedding-service.js';
import type { IAnchorCacheService, IAnchorSearchService, IAnchorManager, SearchOptions, SearchResult, AnchorSlot } from './anchor-interfaces.js';
import { logger } from '../../shared/utils/logger.js';
import { RelationGraph } from '../relation-graph.js';

/**
 * Anchor Search Service 구현
 */
export class AnchorSearchService implements IAnchorSearchService {
  private db: Database.Database | null = null;
  private cacheService: IAnchorCacheService;
  private hybridSearchEngine: HybridSearchEngine | null = null;
  private vectorSearchEngine: VectorSearchEngine | null = null;
  private queryEmbeddingService: UnifiedEmbeddingService = new UnifiedEmbeddingService();
  private relationGraph: RelationGraph | null = null;

  /**
   * 생성자
   */
  constructor(cacheService: IAnchorCacheService) {
    this.cacheService = cacheService;
    logger.info('AnchorSearchService 초기화 완료');
  }

  /**
   * RelationGraph 설정 (선택적)
   */
  setRelationGraph(relationGraph: RelationGraph): void {
    this.relationGraph = relationGraph;
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
   * 하이브리드 검색 엔진 설정
   */
  setHybridSearchEngine(hybridSearchEngine: HybridSearchEngine): void {
    if (!hybridSearchEngine) {
      throw new Error('HybridSearchEngine is required');
    }
    this.hybridSearchEngine = hybridSearchEngine;
  }

  /**
   * 벡터 검색 엔진 설정
   */
  setVectorSearchEngine(vectorSearchEngine: VectorSearchEngine): void {
    if (!vectorSearchEngine) {
      throw new Error('VectorSearchEngine is required');
    }
    this.vectorSearchEngine = vectorSearchEngine;
    // 데이터베이스가 이미 설정되어 있으면 초기화
    if (this.db) {
      this.vectorSearchEngine.initialize(this.db);
    }
  }

  /**
   * 국소 검색
   * 앵커 메모리를 기준으로 N-hop 제한 검색 수행
   */
  async searchLocal(
    agentId: string,
    slot: AnchorSlot,
    query: string | undefined,
    hopLimit: number | undefined,
    options: SearchOptions | undefined,
    anchorMemoryId: string,
    anchorEmbedding: { embedding: number[]; provider: string },
    startTime: number
  ): Promise<SearchResult> {
    if (!this.db) {
      throw new Error('Database is not set. Call setDatabase() first.');
    }

    // 슬롯별 설정 가져오기
    const slotConfig = this.getSlotConfig(slot);
    const finalHopLimit = hopLimit ?? slotConfig.hop_limit;
    const vectorThreshold = slotConfig.vector_threshold;

    // 검색 옵션 기본값
    const limit = options?.limit ?? 10;
    const minResults = options?.min_results ?? 3;
    const useRelations = options?.use_relations ?? true; // 기본값: true

    // VectorSearchEngine이 없으면 에러
    if (!this.vectorSearchEngine) {
      throw new Error('VectorSearchEngine is not set. Call setVectorSearchEngine() first.');
    }

    // N-hop 검색 구현 (use_relations 옵션에 따라 관계 그래프 사용 여부 결정)
    const allHopResults = await this.searchNHop(
      anchorEmbedding.embedding,
      anchorEmbedding.provider,
      anchorMemoryId,
      vectorThreshold,
      finalHopLimit,
      limit * 2, // 더 많이 가져와서 필터링 후 최종 limit 적용
      useRelations // 관계 그래프 사용 여부 전달
    );

    // 쿼리가 있는 경우 쿼리 기반 필터링
    let filteredResults = allHopResults;
    let queryEmbeddingForReanchor: number[] | undefined;
    if (query && query.trim().length > 0) {
      filteredResults = await this.filterByQuery(query, allHopResults, anchorEmbedding.provider);
      
      // 자동 앵커 이동을 위한 쿼리 임베딩 생성 (선택적, 비동기)
      try {
        const queryEmbeddingResult = await this.queryEmbeddingService.generateEmbedding(query);
        if (queryEmbeddingResult && queryEmbeddingResult.embedding) {
          queryEmbeddingForReanchor = queryEmbeddingResult.embedding;
        }
      } catch (error) {
        // 쿼리 임베딩 생성 실패는 무시 (자동 이동은 선택적)
        logger.debug('Query embedding generation failed (for auto anchor move)', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // 결과 포맷팅
    const formattedResults = filteredResults.map(result => ({
      id: result.memory_id,
      content: result.content,
      type: result.type,
      similarity: result.similarity,
      hop_distance: result.hop_distance,
      importance: result.importance,
      created_at: result.created_at,
      tags: result.tags
    }));

    // 최종 limit 적용
    const localResults = formattedResults.slice(0, limit);
    const localCount = localResults.length;

    // Fallback 체크 (query가 있을 때만, min_results 미만 시)
    let fallbackUsed = false;
    let finalResults = localResults;
    let totalCount = localCount;

    if (query && query.trim().length > 0 && localCount < minResults) {
      try {
        logger.info('Fallback to global search', {
          localCount,
          minResults
        });
        
        // Fallback 수행
        const fallbackResult = await this.fallbackToGlobalSearch(
          query,
          { ...options, limit: limit - localCount }, // 부족한 만큼만 가져오기
          startTime
        );

        fallbackUsed = true;

        // Local 결과와 Fallback 결과 병합
        // Local 결과를 우선하고, 중복 제거 (memory_id 기준)
        const localMemoryIds = new Set(localResults.map(r => r.id));
        const fallbackItems: Array<{
          id: string;
          content: string;
          type: string;
          similarity: number;
          hop_distance: number;
          importance: number;
          created_at: string;
          tags: string[] | undefined;
        }> = fallbackResult.items
          .filter(item => !localMemoryIds.has(item.id))
          .map(item => ({
            id: item.id,
            content: item.content,
            type: item.type,
            similarity: item.similarity ?? 0,
            hop_distance: item.hop_distance ?? 999, // fallback 결과는 hop_distance가 없으므로 큰 값으로 설정
            importance: item.importance ?? 0.5,
            created_at: item.created_at ?? new Date().toISOString(),
            tags: item.tags ?? undefined
          }));

        // Local 결과 + Fallback 결과 (중복 제거된 것만)
        finalResults = [...localResults, ...fallbackItems].slice(0, limit);
        totalCount = finalResults.length;

        logger.info('Fallback completed', {
          localCount,
          fallbackCount: fallbackItems.length,
          totalCount
        });
      } catch (error) {
        logger.error('Fallback failed', {
          error: error instanceof Error ? error.message : String(error)
        });
        // Fallback 실패 시 local 결과만 반환
        fallbackUsed = false;
      }
    }

    const queryTime = Date.now() - startTime;
    return {
      items: finalResults,
      total_count: totalCount,
      local_results_count: localCount,
      fallback_used: fallbackUsed,
      query_time: queryTime,
      anchor_info: {
        agent_id: agentId,
        slot: slot,
        memory_id: anchorMemoryId
      }
    };
  }

  /**
   * 1-hop 검색: 앵커와 직접적으로 유사한 메모리 검색
   */
  private async searchOneHop(
    anchorEmbedding: number[],
    provider: string,
    anchorMemoryId: string,
    threshold: number,
    limit: number
  ): Promise<Array<{
    memory_id: string;
    content: string;
    type: string;
    similarity: number;
    importance: number;
    created_at: string;
    tags?: string[];
  }>> {
    if (!this.vectorSearchEngine || !this.db) {
      throw new Error('VectorSearchEngine or Database is not set.');
    }

    try {
      // VectorSearchEngine 초기화 확인
      if (typeof (this.vectorSearchEngine as any).initialize === 'function') {
        (this.vectorSearchEngine as any).initialize(this.db);
      }

      // 벡터 검색 실행 (임계값은 낮게 설정하고 나중에 필터링)
      const searchResults = await this.vectorSearchEngine.search(
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
  private async searchNHop(
    anchorEmbedding: number[],
    provider: string,
    anchorMemoryId: string,
    threshold: number,
    maxHops: number,
    limit: number,
    useRelations: boolean = true
  ): Promise<Array<{
    memory_id: string;
    content: string;
    type: string;
    similarity: number;
    hop_distance: number;
    importance: number;
    created_at: string;
    tags?: string[];
  }>> {
    if (!this.vectorSearchEngine || !this.db) {
      throw new Error('VectorSearchEngine or Database is not set.');
    }

    // VectorSearchEngine 초기화 확인
    if (typeof (this.vectorSearchEngine as any).initialize === 'function') {
      (this.vectorSearchEngine as any).initialize(this.db);
    }

    // 이미 발견된 메모리 ID 추적 (중복 방지)
    const discoveredMemoryIds = new Set<string>([anchorMemoryId]);
    
    // 각 hop 레벨의 결과를 저장
    const allResults: Array<{
      memory_id: string;
      content: string;
      type: string;
      similarity: number;
      hop_distance: number;
      importance: number;
      created_at: string;
      tags?: string[];
      hasRelation?: boolean; // 관계가 있는 기억 표시
    }> = [];

    // 현재 hop 레벨의 메모리들 (임베딩 포함)
    // 1-hop: 앵커 임베딩을 사용
    let currentHopMemories: Array<{ memory_id: string; embedding: number[] }> = [
      { memory_id: anchorMemoryId, embedding: anchorEmbedding }
    ];

    // 각 hop 레벨별로 검색 수행
    for (let hop = 1; hop <= maxHops; hop++) {
      const nextHopMemories: Array<{ memory_id: string; embedding: number[] }> = [];
      const hopResults: Array<{
        memory_id: string;
        content: string;
        type: string;
        similarity: number;
        importance: number;
        created_at: string;
        tags?: string[];
        hasRelation?: boolean;
      }> = [];

      // 현재 hop의 각 메모리에 대해 검색 수행
      for (const currentMemory of currentHopMemories) {
        try {
          // 관계 그래프 또는 memory_link를 활용한 직접 연결된 메모리 조회
          // use_relations가 false이면 관계 그래프를 사용하지 않음
          const linkedMemories = useRelations 
            ? await this.getLinkedMemories(currentMemory.memory_id)
            : [];
          
          // 벡터 검색 실행
          const vectorSearchResults = await this.vectorSearchEngine.search(
            currentMemory.embedding,
            {
              limit: Math.ceil(limit / maxHops) + 10, // 각 hop당 충분한 결과 가져오기
              threshold: 0.0, // 임계값은 나중에 필터링에서 적용
              includeContent: true,
              includeMetadata: true
            },
            provider
          );

          // memory_link 결과와 벡터 검색 결과를 병합
          const allCandidates = new Map<string, {
            memory_id: string;
            content: string;
            type: string;
            similarity: number;
            importance: number;
            created_at: string;
            tags?: string[];
            isLinked: boolean;
          }>();

          // memory_link 결과 추가 (우선순위 높음)
          for (const linked of linkedMemories) {
            if (!discoveredMemoryIds.has(linked.memory_id)) {
              allCandidates.set(linked.memory_id, {
                ...linked,
                isLinked: true
              });
            }
          }

          // 벡터 검색 결과 추가
          const relaxedThreshold = threshold * 0.5;
          for (const result of vectorSearchResults) {
            if (!allCandidates.has(result.memory_id) && !discoveredMemoryIds.has(result.memory_id)) {
              if (result.similarity >= relaxedThreshold) {
                allCandidates.set(result.memory_id, {
                  ...result,
                  isLinked: false
                });
              }
            } else if (allCandidates.has(result.memory_id)) {
              // memory_link로 이미 추가된 경우, 유사도 정보 업데이트
              const existing = allCandidates.get(result.memory_id)!;
              existing.similarity = Math.max(existing.similarity, result.similarity);
            }
          }

          // 결과 필터링 및 추가
          for (const [memoryId, candidate] of allCandidates.entries()) {
            if (discoveredMemoryIds.has(memoryId)) {
              continue;
            }

            const effectiveThreshold = candidate.isLinked 
              ? threshold * 0.8
              : threshold;
            
            if (candidate.similarity < effectiveThreshold) {
              continue;
            }

            discoveredMemoryIds.add(memoryId);
            hopResults.push({
              memory_id: candidate.memory_id,
              content: candidate.content,
              type: candidate.type,
              similarity: candidate.similarity,
              importance: candidate.importance,
              created_at: candidate.created_at,
              tags: candidate.tags,
              hasRelation: candidate.isLinked // 관계가 있는 기억 표시
            });

            // 다음 hop을 위한 임베딩 조회
            if (hop < maxHops) {
              try {
                const nextEmbedding = await this.cacheService.getAnchorEmbedding(candidate.memory_id);
                if (nextEmbedding && nextEmbedding.embedding) {
                  nextHopMemories.push({
                    memory_id: candidate.memory_id,
                    embedding: nextEmbedding.embedding
                  });
                }
              } catch (error) {
                // 임베딩 조회 실패 시 다음 hop에서 제외
                logger.debug('Skipping memory for next hop (no embedding)', {
                  memoryId: candidate.memory_id,
                  error: error instanceof Error ? error.message : String(error)
                });
              }
            }
          }
        } catch (error) {
          logger.error('Hop search failed', {
            hop,
            memoryId: currentMemory.memory_id,
            error: error instanceof Error ? error.message : String(error)
          });
          continue;
        }
      }

      // 현재 hop의 결과를 전체 결과에 추가
      for (const result of hopResults) {
        allResults.push({
          ...result,
          hop_distance: hop,
          hasRelation: result.hasRelation ?? false
        });
      }

      // limit에 도달했으면 중단
      if (allResults.length >= limit) {
        break;
      }

      // 다음 hop을 위한 메모리가 없으면 중단
      if (nextHopMemories.length === 0) {
        break;
      }

      // 다음 hop을 위한 메모리로 업데이트
      currentHopMemories = nextHopMemories;
    }

    // 랭킹 점수 계산 및 적용 (관계 그래프 가중치 포함)
    const rankedResults = await Promise.all(
      allResults.map(async (result) => {
        // 관계 가중치 계산 (관계 그래프가 있고 use_relations가 true인 경우)
        let relationWeight = 0;
        let hasRelation = result.hasRelation ?? false;
        
        if (useRelations && this.relationGraph) {
          try {
            const relations = await this.relationGraph.getRelations(result.memory_id, {
              direction: 'both',
              minConfidence: 0.5
            });
            
            if (relations.length > 0) {
              hasRelation = true; // 관계가 있음을 표시
              // 관계 가중치 계산 (간단한 평균)
              const avgConfidence = relations.reduce((sum, r) => sum + r.confidence, 0) / relations.length;
              const avgBoost = relations.reduce((sum, r) => sum + this.getRelationTypeBoost(r.relation_type), 0) / relations.length;
              relationWeight = Math.min(1.0, avgConfidence * avgBoost);
            }
          } catch (error) {
            // 관계 조회 실패는 무시
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
          hasRelation // 관계가 있는 기억에 우선순위 부여
        );
        return {
          ...result,
          similarity: rankingScore,
          hasRelation
        };
      })
    );

    // 랭킹 점수 기준으로 정렬 (관계가 있는 기억 우선)
    rankedResults.sort((a, b) => {
      // 관계가 있는 기억에 우선순위 부여
      if (a.hasRelation && !b.hasRelation) {
        return -1; // a가 우선
      }
      if (!a.hasRelation && b.hasRelation) {
        return 1; // b가 우선
      }
      
      // 둘 다 관계가 있거나 둘 다 없는 경우, similarity 기준 정렬
      if (Math.abs(a.similarity - b.similarity) < 0.001) {
        return a.hop_distance - b.hop_distance;
      }
      return b.similarity - a.similarity;
    });

    // 최종 limit 적용
    return rankedResults.slice(0, limit);
  }

  /**
   * 쿼리 기반 필터링
   */
  private async filterByQuery(
    query: string,
    results: Array<{
      memory_id: string;
      content: string;
      type: string;
      similarity: number;
      hop_distance: number;
      importance: number;
      created_at: string;
      tags?: string[];
    }>,
    provider: string
  ): Promise<Array<{
    memory_id: string;
    content: string;
    type: string;
    similarity: number;
    hop_distance: number;
    importance: number;
    created_at: string;
    tags?: string[];
  }>> {
    if (results.length === 0) {
      return results;
    }

    try {
      // 쿼리 임베딩 생성
      const queryEmbeddingResult = await this.queryEmbeddingService.generateEmbedding(query);
      if (!queryEmbeddingResult || !queryEmbeddingResult.embedding) {
        logger.warn('Query embedding generation failed, skipping filter');
        return results;
      }

      const queryEmbedding = queryEmbeddingResult.embedding;

      // 각 결과 메모리의 임베딩 조회 및 쿼리 유사도 계산
      const resultsWithQuerySimilarity = await Promise.all(
        results.map(async (result) => {
          try {
            const memoryEmbedding = await this.cacheService.getAnchorEmbedding(result.memory_id);
            if (!memoryEmbedding || !memoryEmbedding.embedding) {
              return {
                ...result,
                query_similarity: 0,
                combined_similarity: result.similarity * 0.5
              };
            }

            // 쿼리 임베딩과 메모리 임베딩 간 유사도 계산
            let querySim = 0;
            if (queryEmbedding.length === memoryEmbedding.embedding.length) {
              querySim = this.cosineSimilarity(queryEmbedding, memoryEmbedding.embedding);
            } else {
              // 차원이 다르면 텍스트 기반 간단한 매칭
              const queryLower = query.toLowerCase();
              const contentLower = result.content.toLowerCase();
              const queryWords = queryLower.split(/\s+/);
              const matchCount = queryWords.filter(word => contentLower.includes(word)).length;
              querySim = matchCount / Math.max(queryWords.length, 1);
            }

            const baseRankingScore = this.calculateRankingScore(
              result.similarity,
              result.hop_distance,
              result.importance,
              0 // query filtering에서는 관계 가중치 미사용 (이미 searchNHop에서 적용됨)
            );
            
            const combinedSimilarity = baseRankingScore * 0.6 + querySim * 0.4;

            return {
              ...result,
              query_similarity: querySim,
              combined_similarity: combinedSimilarity
            };
          } catch (error) {
            logger.error('Query filtering failed for memory', {
              memoryId: result.memory_id,
              error: error instanceof Error ? error.message : String(error)
            });
            return {
              ...result,
              query_similarity: 0,
              combined_similarity: result.similarity * 0.5
            };
          }
        })
      );

      // 쿼리 유사도 임계값 적용
      const queryThreshold = 0.3;
      const filtered = resultsWithQuerySimilarity.filter(
        r => r.query_similarity >= queryThreshold || r.combined_similarity >= 0.5
      );

      // 결합 유사도 기준으로 재정렬
      filtered.sort((a, b) => {
        if (Math.abs(a.combined_similarity - b.combined_similarity) < 0.001) {
          return a.hop_distance - b.hop_distance;
        }
        return b.combined_similarity - a.combined_similarity;
      });

      // 원본 similarity를 combined_similarity로 업데이트하여 반환
      return filtered.map(r => ({
        ...r,
        similarity: r.combined_similarity
      }));
    } catch (error) {
      logger.error('Query-based filtering failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return results;
    }
  }

  /**
   * 전역 검색으로 Fallback
   */
  async fallbackToGlobalSearch(
    query: string,
    options: SearchOptions | undefined,
    startTime: number | undefined
  ): Promise<SearchResult> {
    if (!this.hybridSearchEngine) {
      throw new Error('HybridSearchEngine is not set. Call setHybridSearchEngine() first.');
    }

    if (!this.db) {
      throw new Error('Database is not set.');
    }

    const limit = options?.limit ?? 10;
    const fallbackStartTime = Date.now();

    try {
      // HybridSearchEngine을 사용한 전역 검색
      const globalSearchResult = await this.hybridSearchEngine.search(this.db, {
        query: query,
        limit: limit,
        vectorWeight: options?.vector_weight,
        textWeight: options?.text_weight
      });

      // HybridSearchResult를 SearchResult 형식으로 변환
      const convertedItems = globalSearchResult.items.map(item => ({
        id: item.id,
        content: item.content,
        type: item.type,
        similarity: item.finalScore,
        importance: item.importance,
        created_at: item.created_at,
        tags: item.tags,
        hop_distance: undefined
      }));

      const queryTime = startTime ? Date.now() - startTime : Date.now() - fallbackStartTime;

      return {
        items: convertedItems,
        total_count: convertedItems.length,
        local_results_count: 0,
        fallback_used: true,
        query_time: queryTime
      };
    } catch (error) {
      logger.error('Global search fallback failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      const queryTime = startTime ? Date.now() - startTime : 0;
      
      return {
        items: [],
        total_count: 0,
        local_results_count: 0,
        fallback_used: true,
        query_time: queryTime
      };
    }
  }

  /**
   * memory_link 테이블을 활용한 직접 연결된 메모리 조회
   */
  /**
   * 연결된 메모리 조회
   * 관계 그래프가 있으면 우선 사용, 없으면 memory_link 사용
   */
  private async getLinkedMemories(memoryId: string): Promise<Array<{
    memory_id: string;
    content: string;
    type: string;
    similarity: number;
    importance: number;
    created_at: string;
    tags?: string[];
  }>> {
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
          const memoryIds = relations.map(r => r.target_id);
          const placeholders = memoryIds.map(() => '?').join(',');
          const memoryRecords = this.db.prepare(`
            SELECT id, content, type, importance, created_at, tags
            FROM memory_item
            WHERE id IN (${placeholders})
          `).all(...memoryIds) as Array<{
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
   * 관계 그래프와 벡터 유사도를 결합한 하이브리드 hop 점수 계산
   * 관계가 있는 기억에 우선순위 부여
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

  /**
   * 코사인 유사도 계산
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('벡터 차원이 일치하지 않습니다');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * 슬롯별 설정 조회
   */
  private getSlotConfig(slot: AnchorSlot): { hop_limit: number; vector_threshold: number } {
    const slotConfig = {
      A: { hop_limit: 1, vector_threshold: 0.8 },
      B: { hop_limit: 2, vector_threshold: 0.6 },
      C: { hop_limit: 3, vector_threshold: 0.4 }
    } as const;
    return slotConfig[slot];
  }

  /**
   * 자동 앵커 이동 점수 계산
   */
  async calculateReanchorScore(
    memoryId: string,
    queryEmbedding?: number[],
    anchorEmbedding?: number[]
  ): Promise<number> {
    if (!this.db) {
      return 0;
    }

    try {
      const memory = this.db.prepare(`
        SELECT 
          view_count,
          cite_count,
          edit_count,
          last_accessed,
          created_at,
          importance
        FROM memory_item
        WHERE id = ?
      `).get(memoryId) as {
        view_count: number;
        cite_count: number;
        edit_count: number;
        last_accessed: string | null;
        created_at: string;
        importance: number;
      } | undefined;

      if (!memory) {
        return 0;
      }

      const usageScore = Math.min(
        1.0,
        (Math.log(1 + memory.view_count) +
         2 * Math.log(1 + memory.cite_count) +
         0.5 * Math.log(1 + memory.edit_count)) / 10
      );

      let recencyScore = 0.5;
      if (memory.last_accessed) {
        const lastAccessed = new Date(memory.last_accessed);
        const now = new Date();
        const daysSinceAccess = (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
        recencyScore = Math.max(0, 1.0 - daysSinceAccess / 30);
      }

      const importanceScore = memory.importance || 0.5;

      let semanticScore = 0.5;
      if (queryEmbedding) {
        const memoryEmbedding = await this.cacheService.getAnchorEmbedding(memoryId);
        if (memoryEmbedding && memoryEmbedding.embedding) {
          const similarity = this.cosineSimilarity(queryEmbedding, memoryEmbedding.embedding);
          semanticScore = similarity;
        }
      }

      let anchorComparisonScore = 0.5;
      if (anchorEmbedding) {
        const memoryEmbedding = await this.cacheService.getAnchorEmbedding(memoryId);
        if (memoryEmbedding && memoryEmbedding.embedding) {
          const similarity = this.cosineSimilarity(anchorEmbedding, memoryEmbedding.embedding);
          anchorComparisonScore = 1.0 - similarity;
        }
      }

      const finalScore =
        usageScore * 0.3 +
        recencyScore * 0.2 +
        importanceScore * 0.2 +
        semanticScore * 0.2 +
        anchorComparisonScore * 0.1;

      return Math.min(1.0, Math.max(0.0, finalScore));
    } catch (error) {
      logger.error('Reanchor score calculation failed', {
        memoryId,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * 앵커 주변 메모리 사용 패턴 분석
   */
  async analyzeAnchorUsage(
    agentId: string,
    slot: AnchorSlot,
    anchorMemoryId: string,
    anchorEmbedding: { embedding: number[]; provider: string },
    queryEmbedding?: number[]
  ): Promise<Array<{ memory_id: string; score: number; reason: string }>> {
    if (!this.db) {
      throw new Error('Database is not set.');
    }

    try {
      const slotConfig = this.getSlotConfig(slot);
      const nearbyMemories = await this.searchNHop(
        anchorEmbedding.embedding,
        anchorEmbedding.provider,
        anchorMemoryId,
        slotConfig.vector_threshold * 0.8,
        slotConfig.hop_limit,
        20
      );

      const candidates: Array<{ memory_id: string; score: number; reason: string }> = [];

      for (const memory of nearbyMemories) {
        const score = await this.calculateReanchorScore(
          memory.memory_id,
          queryEmbedding,
          anchorEmbedding.embedding
        );

        if (score > 0.5) {
          const reason = this.generateReanchorReason(memory, score);
          candidates.push({
            memory_id: memory.memory_id,
            score,
            reason
          });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      return candidates;
    } catch (error) {
      logger.error('Anchor usage analysis failed', {
        agentId,
        slot,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * 앵커 이동 이유 생성
   */
  private generateReanchorReason(
    memory: { memory_id: string; content: string; similarity?: number; hop_distance?: number },
    score: number
  ): string {
    const reasons: string[] = [];

    if (score > 0.7) {
      reasons.push('높은 사용 빈도');
    }
    if (memory.similarity && memory.similarity > 0.8) {
      reasons.push('쿼리와 높은 유사도');
    }
    if (memory.hop_distance === 1) {
      reasons.push('앵커와 직접 연결');
    }

    return reasons.length > 0 ? reasons.join(', ') : '종합 점수 우수';
  }

  /**
   * 자동 앵커 이동 실행
   */
  async autoReanchor(
    agentId: string,
    slot: AnchorSlot,
    anchorManager: IAnchorManager,
    queryEmbedding?: number[],
    threshold: number = 0.7,
    strategy: 'gradual' | 'immediate' = 'gradual'
  ): Promise<{
    moved: boolean;
    old_anchor: string | null;
    new_anchor: string | null;
    score: number;
    reason: string;
  }> {
    if (!this.db) {
      throw new Error('Database is not set.');
    }

    try {
      const currentAnchor = await anchorManager.getAnchor(agentId, slot);
      if (!currentAnchor || Array.isArray(currentAnchor) || !currentAnchor.memory_id) {
        return {
          moved: false,
          old_anchor: null,
          new_anchor: null,
          score: 0,
          reason: '앵커가 설정되지 않았습니다'
        };
      }

      const anchorEmbedding = await this.cacheService.getAnchorEmbedding(currentAnchor.memory_id);
      if (!anchorEmbedding) {
        return {
          moved: false,
          old_anchor: currentAnchor.memory_id,
          new_anchor: null,
          score: 0,
          reason: '앵커 임베딩을 찾을 수 없습니다'
        };
      }

      const candidates = await this.analyzeAnchorUsage(
        agentId,
        slot,
        currentAnchor.memory_id,
        anchorEmbedding,
        queryEmbedding
      );

      if (candidates.length === 0 || !candidates[0] || candidates[0].score < threshold) {
        return {
          moved: false,
          old_anchor: currentAnchor.memory_id,
          new_anchor: null,
          score: candidates[0]?.score || 0,
          reason: `임계값(${threshold}) 미만 또는 후보 없음`
        };
      }

      const bestCandidate = candidates[0];
      if (!bestCandidate) {
        return {
          moved: false,
          old_anchor: currentAnchor.memory_id,
          new_anchor: null,
          score: 0,
          reason: '후보 없음'
        };
      }

      if (strategy === 'gradual') {
        if (slot === 'A') {
          const bAnchor = await anchorManager.getAnchor(agentId, 'B');
          if (bAnchor && !Array.isArray(bAnchor) && bAnchor.memory_id) {
            await anchorManager.setAnchor(agentId, bAnchor.memory_id, 'C');
          }
          await anchorManager.setAnchor(agentId, currentAnchor.memory_id, 'B');
        } else if (slot === 'B') {
          await anchorManager.setAnchor(agentId, currentAnchor.memory_id, 'C');
        }
        await anchorManager.setAnchor(agentId, bestCandidate.memory_id, slot);
      } else {
        await anchorManager.setAnchor(agentId, bestCandidate.memory_id, slot);
      }

      logger.info('Auto reanchor completed', {
        agentId,
        slot,
        oldAnchor: currentAnchor.memory_id,
        newAnchor: bestCandidate.memory_id,
        score: bestCandidate.score,
        reason: bestCandidate.reason
      });

      return {
        moved: true,
        old_anchor: currentAnchor.memory_id,
        new_anchor: bestCandidate.memory_id,
        score: bestCandidate.score,
        reason: bestCandidate.reason
      };
    } catch (error) {
      logger.error('Auto reanchor failed', {
        agentId,
        slot,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * 검색 후 자동 앵커 이동 체크
   */
  async checkAndAutoReanchor(
    agentId: string,
    slot: AnchorSlot,
    anchorManager: IAnchorManager,
    queryEmbedding?: number[],
    autoMoveEnabled: boolean = false
  ): Promise<{
    moved: boolean;
    old_anchor: string | null;
    new_anchor: string | null;
    score: number;
    reason: string;
  } | null> {
    if (!autoMoveEnabled) {
      return null;
    }

    try {
      return await this.autoReanchor(agentId, slot, anchorManager, queryEmbedding, 0.7, 'gradual');
    } catch (error) {
      logger.debug('Auto reanchor check failed (ignored)', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
}


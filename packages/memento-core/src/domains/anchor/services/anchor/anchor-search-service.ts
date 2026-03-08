/**
 * Anchor Search Service
 * 검색 관련 로직 담당
 * Phase 1.1: anchor-manager.ts 리팩토링
 */

import type Database from 'better-sqlite3';
import type { HybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import type { VectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';
import { UnifiedEmbeddingService } from '../../../embedding/services/unified-embedding-service.js';
import type { IAnchorCacheService, IAnchorSearchService, IAnchorManager, SearchOptions, SearchResult, AnchorSlot } from './anchor-interfaces.js';
import { DatabaseValidationError, ServiceNotInitializedError, VectorDimensionMismatchError } from './anchor-interfaces.js';
import { logger } from '../../../../shared/utils/logger.js';
import { RelationGraph } from '../../../relation/services/relation-graph.js';
import { NHopSearchService } from './n-hop-search-service.js';
import { QueryFilterService } from './query-filter-service.js';
import { FallbackSearchService } from './fallback-search-service.js';
import { LocalSearchService } from './local-search-service.js';
import { NHopSearchStrategy } from './n-hop-search-strategy.js';
import { QueryFilterStrategy } from './query-filter-strategy.js';
import { FallbackStrategy } from './fallback-strategy.js';
import { ErrorLoggingService, ErrorSeverity, ErrorCategory } from '../../../../domains/monitoring/services/error-logging-service.js';

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
  private errorLoggingService: ErrorLoggingService | null = null;
  
  // Phase 2.3-2.5: 분리된 서비스들
  private nHopSearchService: NHopSearchService;
  private queryFilterService: QueryFilterService;
  private fallbackSearchService: FallbackSearchService;
  
  // Phase 3.6: LocalSearchService
  private localSearchService: LocalSearchService | null = null;

  /**
   * 생성자 (옵션으로 db·검색 엔진 주입 시 일괄 설정, 미전달 시 setDatabase/setHybridSearchEngine/setVectorSearchEngine 호출 필요)
   */
  constructor(
    cacheService: IAnchorCacheService,
    options?: {
      db?: Database.Database;
      hybridSearchEngine?: HybridSearchEngine;
      vectorSearchEngine?: VectorSearchEngine;
    }
  ) {
    this.cacheService = cacheService;

    // Phase 2.3-2.5: 분리된 서비스들 초기화
    this.nHopSearchService = new NHopSearchService(cacheService);
    this.queryFilterService = new QueryFilterService(cacheService);
    this.fallbackSearchService = new FallbackSearchService();

    if (options?.db) this.setDatabase(options.db);
    if (options?.hybridSearchEngine) this.setHybridSearchEngine(options.hybridSearchEngine);
    if (options?.vectorSearchEngine) this.setVectorSearchEngine(options.vectorSearchEngine);

    logger.info('AnchorSearchService 초기화 완료');
  }

  /**
   * ErrorLoggingService 설정 (Phase 8.3)
   * 에러 로깅 서비스를 주입하여 구조화된 에러 로깅 활성화
   */
  setErrorLoggingService(errorLoggingService: ErrorLoggingService): void {
    this.errorLoggingService = errorLoggingService;
  }

  /**
   * RelationGraph 설정 (선택적)
   */
  setRelationGraph(relationGraph: RelationGraph): void {
    this.relationGraph = relationGraph;
    // Phase 2.3: N-hop 검색 서비스에도 관계 그래프 설정
    this.nHopSearchService.setRelationGraph(relationGraph);
  }

  /**
   * 데이터베이스 설정
   */
  setDatabase(db: Database.Database): void {
    if (!db) {
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new DatabaseValidationError('Database instance is required');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorSearchService',
            operation: 'setDatabase'
          }
        );
      }
      throw error;
    }
    this.db = db;
    // Phase 2.3-2.5: 분리된 서비스들에도 데이터베이스 설정
    this.nHopSearchService.setDatabase(db);
    this.fallbackSearchService.setDatabase(db);
    
    // Phase 3.6: LocalSearchService 초기화
    if (!this.localSearchService) {
      const nHopSearchStrategy = new NHopSearchStrategy(this.nHopSearchService);
      const queryFilterStrategy = new QueryFilterStrategy(this.queryFilterService);
      const fallbackStrategy = new FallbackStrategy(this.fallbackSearchService);
      this.localSearchService = new LocalSearchService(
        this.cacheService,
        nHopSearchStrategy,
        queryFilterStrategy,
        fallbackStrategy
      );
    }
    this.localSearchService.setDatabase(db);
  }

  /**
   * 하이브리드 검색 엔진 설정
   */
  setHybridSearchEngine(hybridSearchEngine: HybridSearchEngine): void {
    if (!hybridSearchEngine) {
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new DatabaseValidationError('HybridSearchEngine is required');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorSearchService',
            operation: 'setHybridSearchEngine'
          }
        );
      }
      throw error;
    }
    this.hybridSearchEngine = hybridSearchEngine;
    // Phase 2.5: Fallback 검색 서비스에도 하이브리드 검색 엔진 설정
    this.fallbackSearchService.setHybridSearchEngine(hybridSearchEngine);
  }

  /**
   * 벡터 검색 엔진 설정
   */
  setVectorSearchEngine(vectorSearchEngine: VectorSearchEngine): void {
    if (!vectorSearchEngine) {
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new DatabaseValidationError('VectorSearchEngine is required');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorSearchService',
            operation: 'setVectorSearchEngine'
          }
        );
      }
      throw error;
    }
    this.vectorSearchEngine = vectorSearchEngine;
    // 데이터베이스가 이미 설정되어 있으면 초기화
    if (this.db) {
      this.vectorSearchEngine.initialize(this.db);
    }
    // Phase 2.3: N-hop 검색 서비스에도 벡터 검색 엔진 설정
    this.nHopSearchService.setVectorSearchEngine(vectorSearchEngine);
  }

  /**
   * 국소 검색
   * 앵커 메모리를 기준으로 N-hop 제한 검색 수행
   * Phase 3.7: LocalSearchService를 사용하도록 리팩토링
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
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new DatabaseValidationError('Database is not set. Call setDatabase() first.');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorSearchService',
            operation: 'searchLocal',
            agentId,
            slot
          }
        );
      }
      throw error;
    }

    if (!this.localSearchService) {
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new ServiceNotInitializedError('LocalSearchService', 'setDatabase()');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorSearchService',
            operation: 'searchLocal',
            agentId,
            slot
          }
        );
      }
      throw error;
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
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new ServiceNotInitializedError('VectorSearchEngine', 'setVectorSearchEngine()');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorSearchService',
            operation: 'searchLocal',
            agentId,
            slot
          }
        );
      }
      throw error;
    }

    // Phase 3.6: LocalSearchService를 사용하여 파이프라인 실행
    // 1. N-hop 검색 수행
    const allHopResults = await this.localSearchService.performNHopSearch(
      anchorEmbedding.embedding,
      anchorEmbedding.provider,
      anchorMemoryId,
      vectorThreshold,
      finalHopLimit,
      limit * 2, // 더 많이 가져와서 필터링 후 최종 limit 적용
      useRelations
    );

    // 2. 쿼리 필터링 적용
    const filteredResults = await this.localSearchService.applyQueryFilter(
      query,
      allHopResults,
      anchorEmbedding.provider
    );


    // 3. 결과 포맷팅
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

    // 4. Fallback 처리
    const fallbackResult = await this.localSearchService.handleFallback(
      query,
      localResults,
      minResults,
      options,
      startTime
    );

    const queryTime = Date.now() - startTime;
    return {
      items: fallbackResult.items,
      total_count: fallbackResult.totalCount,
      local_results_count: localCount,
      fallback_used: fallbackResult.fallbackUsed,
      query_time: queryTime,
      anchor_info: {
        agent_id: agentId,
        slot: slot,
        memory_id: anchorMemoryId
      }
    };
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
   * 코사인 유사도 계산
   * Phase 2.7.3: calculateReanchorScore에서 사용하므로 유지
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new VectorDimensionMismatchError(a.length, b.length);
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorSearchService',
            operation: 'cosineSimilarity',
            vectorA_length: a.length,
            vectorB_length: b.length
          }
        );
      }
      throw error;
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
   * 전역 검색으로 Fallback
   * Phase 2.5: FallbackSearchService 위임
   */
  async fallbackToGlobalSearch(
    query: string,
    options: SearchOptions | undefined,
    startTime: number | undefined
  ): Promise<SearchResult> {
    return this.fallbackSearchService.fallbackToGlobalSearch(query, options, startTime);
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
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new DatabaseValidationError('Database is not set.');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorSearchService',
            operation: 'getAnchorWithEmbedding',
            agentId,
            slot
          }
        );
      }
      throw error;
    }

    try {
      const slotConfig = this.getSlotConfig(slot);
      // Phase 2.3: N-hop 검색 서비스 사용
      const nearbyMemories = await this.nHopSearchService.searchNHop(
        anchorEmbedding.embedding,
        anchorEmbedding.provider,
        anchorMemoryId,
        slotConfig.vector_threshold * 0.8,
        slotConfig.hop_limit,
        20,
        true // useRelations 기본값
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
      const error = new Error('Database is not set.');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorSearchService',
            operation: 'getAnchorWithEmbedding',
            agentId,
            slot
          }
        );
      }
      throw error;
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


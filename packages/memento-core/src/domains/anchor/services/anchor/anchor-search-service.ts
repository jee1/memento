/**
 * Anchor Search Service
 * 검색 관련 로직 담당
 * Phase 1.1: anchor-manager.ts 리팩토링
 */

import type Database from 'better-sqlite3';
import type { HybridSearchEngine, VectorSearchEngine } from '../../../search/index.js';
import type { IAnchorCacheService, IAnchorSearchService, IAnchorManager, SearchOptions, SearchResult, AnchorSlot } from './anchor-interfaces.js';
import { DatabaseValidationError, AnchorNotFoundError, ServiceNotInitializedError } from './anchor-interfaces.js';
import { logger } from '../../../../shared/utils/logger.js';
import { selectCurrentIdsInScope, type CallerMemoryScope } from '../../../../shared/utils/owned-ids.js';
import type { RelationGraph } from '../../../relation/index.js';
import { NHopSearchService, type NHopSearchResult } from './n-hop-search-service.js';
import { QueryFilterService } from './query-filter-service.js';
import { FallbackSearchService } from './fallback-search-service.js';
import { LocalSearchService } from './local-search-service.js';
import { ErrorLoggingService, ErrorSeverity, ErrorCategory } from '../../../monitoring/index.js';
import { AnchorReanchorService } from './anchor-reanchor-service.js';
import type { AutoReanchorResult } from './anchor-reanchor-service.js';

/**
 * Anchor Search Service 구현
 */
export class AnchorSearchService implements IAnchorSearchService {
  private db: Database.Database | null = null;
  private cacheService: IAnchorCacheService;
  private vectorSearchEngine: VectorSearchEngine | null = null;
  private errorLoggingService: ErrorLoggingService | null = null;
  
  // Phase 2.3-2.5: 분리된 서비스들
  private nHopSearchService: NHopSearchService;
  private queryFilterService: QueryFilterService;
  private fallbackSearchService: FallbackSearchService;
  private reanchorService: AnchorReanchorService;
  
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
    this.reanchorService = new AnchorReanchorService(
      cacheService,
      this.nHopSearchService,
      () => this.db,
      () => this.errorLoggingService,
      (slot) => this.getSlotConfig(slot)
    );

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
      this.localSearchService = new LocalSearchService(
        this.cacheService,
        this.nHopSearchService,
        this.queryFilterService,
        this.fallbackSearchService
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
    anchorEmbedding: { embedding: number[]; provider: string } | null,
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

    const scope: CallerMemoryScope = {
      ...(options?.owner_id ? { owner_id: options.owner_id } : {}),
      ...(options?.project_id ? { project_id: options.project_id } : {}),
    };
    const currentSeed = selectCurrentIdsInScope(this.db, scope, [anchorMemoryId]).has(anchorMemoryId);
    if (!currentSeed) throw new AnchorNotFoundError(agentId, slot);

    // 슬롯별 설정 가져오기
    const slotConfig = this.getSlotConfig(slot);
    const finalHopLimit = hopLimit ?? slotConfig.hop_limit;
    const vectorThreshold = options?.vector_threshold ?? slotConfig.vector_threshold;

    // 검색 옵션 기본값
    const limit = options?.limit ?? 10;
    const minResults = options?.min_results ?? 3;
    const useRelations = options?.use_relations ?? true; // 기본값: true

    // 임베딩이 있으면 vector augmentation도 사용할 수 있어야 한다.
    if (anchorEmbedding && !this.vectorSearchEngine) {
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
    // 1. N-hop 검색 수행 (호출자 범위 전달)
    const allHopResults = await this.localSearchService.performNHopSearch(
      anchorEmbedding?.embedding ?? null,
      anchorEmbedding?.provider ?? '',
      anchorMemoryId,
      vectorThreshold,
      finalHopLimit,
      limit * 2, // 더 많이 가져와서 필터링 후 최종 limit 적용
      useRelations,
      scope
    );

    // 2. 쿼리 필터링 적용
    const filteredResults = await this.localSearchService.applyQueryFilter(
      query,
      allHopResults,
      anchorEmbedding?.provider ?? ''
    );


    // 3. 현재 상태와 호출자 범위를 최종 limit 전에 적용한다.
    const visibleIds = selectCurrentIdsInScope(this.db, scope, filteredResults.map(r => r.memory_id));
    const scopedResults = filteredResults.filter(r => visibleIds.has(r.memory_id));

    // 4. 결과 포맷팅 (중첩 predecessor도 현재성과 범위 검증)
    const formattedResults = this.formatLocalResults(scopedResults, scope);

    // 최종 limit 적용
    const localResults = formattedResults.slice(0, limit);
    const localCount = localResults.length;

    // 국소 검색이 어느 단계에서 줄어드는지 재현 없이 확인하기 위한 단계별 계측 (#873).
    // 맵 렌더링이 슬롯마다 호출하므로 debug 레벨로 둔다 (LOG_LEVEL=debug 로 켠다).
    logger.debug('searchLocal stages', {
      slot,
      hopLimit: finalHopLimit,
      vectorThreshold,
      hasQuery: Boolean(query && query.trim().length > 0),
      hopResults: allHopResults.length,
      afterQueryFilter: filteredResults.length,
      afterOwnerScope: scopedResults.length,
      afterLimit: localCount,
      minResults
    });

    // 5. Fallback 처리
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
        memory_id: anchorMemoryId,
        embedding_missing: !anchorEmbedding
      }
    };
  }

  private formatLocalResults(
    scopedResults: NHopSearchResult[],
    scope: CallerMemoryScope
  ): Array<{
    id: string;
    content: string;
    type: string;
    similarity: number;
    hop_distance: number;
    importance: number;
    created_at: string;
    tags?: string[];
    predecessor_id?: string;
    predecessor_ids?: string[];
  }> {
    const allPredecessorCandidateIds: string[] = [];
    for (const r of scopedResults) {
      if (r.predecessor_id) allPredecessorCandidateIds.push(r.predecessor_id);
      if (r.predecessor_ids) allPredecessorCandidateIds.push(...r.predecessor_ids);
    }
    const visiblePredecessors = this.db
      ? selectCurrentIdsInScope(this.db, scope, allPredecessorCandidateIds)
      : new Set<string>(allPredecessorCandidateIds);

    return scopedResults.map(result => {
      let predecessor_ids = result.predecessor_ids;
      let predecessor_id = result.predecessor_id;
      if (predecessor_ids) {
        predecessor_ids = predecessor_ids.filter((id: string) => visiblePredecessors.has(id));
        if (predecessor_ids.length === 0) {
          predecessor_ids = undefined;
        }
      }
      if (predecessor_id && !visiblePredecessors.has(predecessor_id)) {
        predecessor_id = undefined;
      }
      return {
        id: result.memory_id,
        content: result.content,
        type: result.type,
        similarity: result.similarity,
        hop_distance: result.hop_distance,
        importance: result.importance,
        created_at: result.created_at,
        tags: result.tags,
        predecessor_id,
        predecessor_ids
      };
    });
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
    return this.reanchorService.calculateReanchorScore(memoryId, queryEmbedding, anchorEmbedding);
  }

  /**
   * 앵커 주변 메모리 사용 패턴 분석
   */
  async analyzeAnchorUsage(
    agentId: string,
    slot: AnchorSlot,
    anchorMemoryId: string,
    anchorEmbedding: { embedding: number[]; provider: string },
    scope: CallerMemoryScope,
    queryEmbedding?: number[]
  ): Promise<Array<{ memory_id: string; score: number; reason: string }>> {
    return this.reanchorService.analyzeAnchorUsage(
      agentId,
      slot,
      anchorMemoryId,
      anchorEmbedding,
      scope,
      queryEmbedding
    );
  }

  /**
   * 자동 앵커 이동 실행
   */
  async autoReanchor(
    agentId: string,
    slot: AnchorSlot,
    anchorManager: IAnchorManager,
    scope: CallerMemoryScope,
    queryEmbedding?: number[],
    threshold: number = 0.7,
    strategy: 'gradual' | 'immediate' = 'gradual'
  ): Promise<AutoReanchorResult> {
    return this.reanchorService.autoReanchor(
      agentId,
      slot,
      anchorManager,
      scope,
      queryEmbedding,
      threshold,
      strategy
    );
  }

  /**
   * 검색 후 자동 앵커 이동 체크
   */
  async checkAndAutoReanchor(
    agentId: string,
    slot: AnchorSlot,
    anchorManager: IAnchorManager,
    scope: CallerMemoryScope,
    queryEmbedding?: number[],
    autoMoveEnabled: boolean = false
  ): Promise<AutoReanchorResult | null> {
    return this.reanchorService.checkAndAutoReanchor(
      agentId,
      slot,
      anchorManager,
      scope,
      queryEmbedding,
      autoMoveEnabled
    );
  }
}

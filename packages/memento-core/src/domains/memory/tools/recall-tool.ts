/**
 * Recall Tool - 기억 검색 도구
 * 하이브리드 검색을 통한 고성능 기억 검색
 */

import type Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { mementoConfig } from '../../../shared/config/index.js';
import { INTROSPECTION_HINT_SUFFIX } from '../../../shared/constants/introspection-constants.js';
import type { IConsolidationScoreService } from '../../../shared/interfaces/consolidation-score.interface.js';
import {
  isMemoryItemType,
  type EmbeddingProvider,
  type MemorySearchFilters,
  type MemoryType,
  type MemoryTypeRequest,
} from '../../../shared/types/index.js';
import type { VersionFilterType } from '../../../shared/types/procedural-versioning.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { emitTfidfFallbackWarningIfNeeded } from '../../../shared/utils/embedding-provider-diagnostics.js';
import { validateTypeParam } from '../../../shared/utils/type-param-validator.js';
import type { WriteCoalescingManager } from '../../../shared/utils/write-coalescing.js';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext,ToolResult } from '../../../tools/types.js';
import { getVectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';
import { KnowledgeVaultRepository } from '../repositories/knowledge-vault-repository.js';
import { CoreMemoryService } from '../services/core-memory-service.js';
import { KnowledgeVaultService } from '../services/knowledge-vault-service.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import type { NeighborMemory } from '../services/memory-neighbor-service.js';
import { MemoryNeighborService } from '../services/memory-neighbor-service.js';
import type { MetaMemoryService } from '../services/meta-memory-service.js';
import { computeProceduralDiff } from '../services/procedural-memory-diff.js';
import { getVersionChain } from '../services/procedural-versioning.js';
import {
buildQueryEmbeddingMetadataFields,
recallQueryCorrelationExtra,
recallSearchRequestedExtra,
recallTelemetryRetrievalStrategy
} from './recall-tool-telemetry.js';

import { filterRecallItemsByTriggerConditions, getAppliedRecallFilters } from './recall-tool-filters.js';
import {
  normalizeProviderFilter,
  RecallSchema,
  type RecallHybridOrTextSearchResult,
  type RecallTelemetryRetrievalStrategy
} from './recall-tool-schema.js';
import { mapRecallSearchItemsToResultItems } from './recall-tool-results.js';
import type {
  AnchorSetMetadata,
  MetaStatsItem,
  NeighborMemoryItem,
  RecallResponseMetadata,
  RecallResultItem,
  RecallSearchItem
} from './recall-tool-types.js';
import type { RecallParams } from './recall-tool-schema.js';

export type {
  AnchorSetMetadata,
  NeighborMemoryItem,
  RecallResultItem,
  RecallResponseMetadata,
  RecallResponse
} from './recall-tool-types.js';
export type { RecallParams };

export class RecallTool extends BaseTool {
  constructor() {
    super(
      'recall',
      '관련 기억을 검색합니다',
      {
        type: 'object',
        properties: {
          query: { 
            type: 'string', 
            description: '검색할 내용을 자연어 문장으로 입력하세요 (예: \'지난번에 JWT 토큰 만료 처리한 방법이 뭐였지?\', e.g. "How did we handle JWT expiry last time?"). 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다. type이 core 또는 vault가 아닌 경우 필수이며, memory_types만 제공된 경우에도 query는 필수입니다.' 
          },
          type: { 
            type: 'string', 
            enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'],
            description: '단일 메모리 타입 지정 (선택사항). 가능하면 항상 명시하는 것을 권장합니다.'
          },
          key: { 
            type: 'string', 
            description: 'Core/Vault 조회 시 특정 키 지정 (선택사항)' 
          },
          agent_id: { 
            type: 'string', 
            description: '에이전트 ID (Core/Vault 조회 시 사용, 기본값: "default")' 
          },
          memory_types: { 
            type: 'array', 
            items: { type: 'string', enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'] },
            description: '복수 타입 필터 (선택사항, type 파라미터와 동시 사용 시 type 우선). core/vault는 자동으로 제거됩니다. type을 생략해도 이 배열이 비어 있지 않으면 missing-type 경고가 생략될 수 있습니다.'
          },
          tags: { 
            type: 'array', 
            items: { type: 'string' },
            description: '태그 필터 (선택사항)'
          },
          privacy_scope: { 
            type: 'array', 
            items: { type: 'string', enum: ['private', 'team', 'public'] },
            description: '프라이버시 범위 필터 (선택사항)'
          },
          time_from: { 
            type: 'string', 
            description: '시작 시간 (ISO 8601 형식, 선택사항)'
          },
          time_to: { 
            type: 'string', 
            description: '종료 시간 (ISO 8601 형식, 선택사항)'
          },
          pinned: { 
            type: 'boolean',
            description: '핀된 기억만 검색 (선택사항)'
          },
          importance_min: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '최소 중요도 (선택사항)'
          },
          importance_max: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '최대 중요도 (0-1, 선택사항)'
          },
          has_reflection_notes: {
            type: 'boolean',
            description: 'reflection_notes가 있는 메모리만 조회 (true: IS NOT NULL, false: IS NULL, 선택사항)'
          },
          // Procedural Memory Enhancement (v7.0) 필드
          workflow_name: {
            type: 'string',
            description: '프로세스 이름으로 필터링 (선택사항)'
          },
          skill_name: {
            type: 'string',
            description: '기술/능력 이름으로 필터링 (선택사항)'
          },
          match_trigger_conditions: {
            type: 'boolean',
            default: false,
            description: 'trigger_conditions 매칭 여부 (기본값: false)'
          },
          return_format: {
            type: 'string',
            enum: ['full', 'steps_only'],
            default: 'full',
            description: '반환 형식 선택: full (모든 필드), steps_only (steps만 반환)'
          },
          limit: { 
            type: 'number', 
            minimum: 1, 
            maximum: 100, 
            default: 10,
            description: '최대 결과 수'
          },
          vector_weight: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            default: 0.6,
            description: '벡터 검색 가중치 (선택사항)'
          },
          text_weight: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            default: 0.4,
            description: '텍스트 검색 가중치 (선택사항)'
          },
          enable_hybrid: {
            type: 'boolean',
            default: true,
            description: '하이브리드 검색 사용 여부 (선택사항)'
          },
          include_metadata: {
            type: 'boolean',
            default: true,
            description:
              '메타데이터 포함 여부 (선택사항). false면 응답에서 메타데이터 블록을 생략하며, score_breakdown도 포함하지 않음(include_score_breakdown=true여도).'
          },
          include_score_breakdown: {
            type: 'boolean',
            default: false,
            description:
              'true일 때 각 결과에 score_breakdown 포함. include_metadata=false이면 적용되지 않음(메타·세부 점수 모두 생략). relevance.score/pct는 α·relevance(블렌딩)뿐 아니라 관계·절차·process_fit 기여를 동일 슬롯에 합산(FR-008·contracts §1).'
          },
          provider_filter: {
            type: 'array',
            items: { type: 'string', enum: ['tfidf', 'lightweight', 'minilm', 'openai', 'gemini'] },
            description: '검색할 임베딩 provider 필터 (선택사항, 미지정 시 모든 provider 검색)'
          },
          auto_set_anchor: {
            type: 'boolean',
            default: false,
            description: '가장 관련성 높은 기억(첫 번째 결과)을 슬롯 A에 자동으로 앵커로 설정 (기본값: false)'
          },
          include_neighbors: {
            type: 'boolean',
            default: false,
            description: '검색 결과의 상위 항목에 대해 이웃 기억을 자동으로 포함 (기본값: false)'
          },
          neighbors_limit: {
            type: 'number',
            minimum: 1,
            maximum: 10,
            default: 3,
            description: '이웃 기억을 포함할 상위 결과의 개수 (각 결과당 이웃 개수는 neighbors_per_item으로 제어, 기본값: 3)'
          },
          neighbors_per_item: {
            type: 'number',
            minimum: 1,
            maximum: 50,
            default: 5,
            description: '각 검색 결과 항목당 조회할 이웃 기억의 최대 개수 (기본값: 5)'
          },
          neighbors_similarity_threshold: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            default: 0.8,
            description: '이웃 기억 조회 시 유사도 임계값 (이 값 이상인 기억만 반환, 기본값: 0.8)'
          },
          // Procedural Version Management (Issue #57 Phase 2)
          version_filter: {
            type: 'string',
            enum: ['latest_only', 'all_versions', 'specific_version'],
            description: 'procedural 기억 버전 필터: latest_only(시리즈당 최신만), all_versions(전체), specific_version(version_series_id+version_number로 지정)'
          },
          version_series_id: {
            type: 'string',
            description: '버전 시리즈 ID (specific_version일 때 또는 특정 시리즈만 볼 때 사용)'
          },
          version_number: {
            type: 'number',
            minimum: 1,
            description: '특정 버전 번호 (specific_version일 때 version_series_id와 함께 사용)'
          },
          include_version_chain: {
            type: 'boolean',
            description: 'true이면 procedural 결과에 version_chain(버전 이력 배열) 포함'
          },
          include_diff_with: {
            type: 'string',
            description: "'previous'면 직전 버전과의 diff, 메모리 id면 해당 id와의 diff를 diff_with_previous 또는 diff_with 필드로 반환"
          },
          owner_id: {
            type: 'string',
            description: '다중 에이전트: 소유자 ID로 결과 필터 (단일 문자열 또는 문자열 배열). 미설정 시 전체 조회'
          },
          process_id: {
            type: 'string',
            description: 'Memori Attribution: 프로세스 ID로 결과 필터 (Issue #87)'
          },
          session_id: {
            type: 'string',
            description: 'Memori Attribution: 세션 ID로 결과 필터 (Issue #87)'
          },
          project_id: {
            type: 'string',
            description: 'Project-scoped Memory: 프로젝트 ID로 결과 필터 (Issue #81). 미지정 시 전체 검색'
          }
        },
        required: [] // 조건부 필수는 런타임 검증 (RecallSchema.refine()에서 처리)
      }
    );
  }

  private async recallCoreMemoryDirect(
    agentId: string,
    key: string | undefined,
    query: string | undefined,
    memory_types: RecallParams['memory_types'],
    searchStartTime: number,
    startTime: number,
    context: ToolContext
  ): Promise<ToolResult> {
    if (query) {
      this.logWarning('type="core"일 때 query 파라미터는 무시됩니다', { query });
    }
    if (memory_types && memory_types.length > 0) {
      this.logWarning('type="core"일 때 memory_types 파라미터는 무시됩니다', { memory_types });
    }

    const { createCoreMemoryRepository } = await import('../../../infrastructure/database/factories/core-memory-repository.factory.js');
    const coreMemoryRepository = createCoreMemoryRepository(context.db!);
    const { getCoreMemoryCache } = await import('../services/core-memory-cache-service.js');
    const coreMemoryCache = getCoreMemoryCache();
    const coreMemoryService = new CoreMemoryService(coreMemoryRepository, coreMemoryCache);

    let records;
    if (key) {
      const record = await coreMemoryService.findByKey(agentId, key);
      records = record ? [record] : [];
    } else {
      records = await coreMemoryService.findByAgentId(agentId);
    }

    const executionTime = Date.now() - searchStartTime;
    const processedResults = records.map(record => ({
      memory_id: record.core_id,
      type: 'core',
      key: record.key,
      value: record.value,
      always_load: record.always_load,
      origin_source: record.origin_source ? JSON.parse(record.origin_source) : null,
      created_at: record.created_at,
      updated_at: record.updated_at
    }));

    if (mementoConfig.recallProfileEnabled) {
      this.logInfo('recall_profile', { total_ms: Date.now() - startTime });
    }
    return this.createSuccessResult({
      items: processedResults,
      total_count: processedResults.length,
      query_time: executionTime,
      search_type: 'direct'
    });
  }

  private async recallVaultMemoryDirect(
    agentId: string,
    key: string | undefined,
    query: string | undefined,
    memory_types: RecallParams['memory_types'],
    searchStartTime: number,
    startTime: number,
    context: ToolContext
  ): Promise<ToolResult> {
    if (query) {
      this.logWarning('type="vault"일 때 query 파라미터는 무시됩니다', { query });
    }
    if (memory_types && memory_types.length > 0) {
      this.logWarning('type="vault"일 때 memory_types 파라미터는 무시됩니다', { memory_types });
    }

    const knowledgeVaultRepository = new KnowledgeVaultRepository(context.db!);
    const knowledgeVaultService = new KnowledgeVaultService(knowledgeVaultRepository);

    let records;
    if (key) {
      const record = await knowledgeVaultService.findActiveByKey(agentId, key);
      records = record ? [record] : [];
    } else {
      records = await knowledgeVaultService.findActiveByAgentId(agentId);
    }

    const executionTime = Date.now() - searchStartTime;
    const processedResults = records.map(record => ({
      memory_id: record.vault_id,
      type: 'vault',
      key: record.key,
      value: record.value,
      immutable: record.immutable,
      version: record.version,
      origin_source: record.origin_source ? JSON.parse(record.origin_source) : null,
      created_at: record.created_at,
      updated_at: record.updated_at
    }));

    if (mementoConfig.recallProfileEnabled) {
      this.logInfo('recall_profile', { total_ms: Date.now() - startTime });
    }
    return this.createSuccessResult({
      items: processedResults,
      total_count: processedResults.length,
      query_time: executionTime,
      search_type: 'direct'
    });
  }

  private async executeHybridOrTextSearchForMemoryItem(
    context: ToolContext,
    input: {
      query: string;
      filters: MemorySearchFilters;
      limit: number;
      normalizedVectorWeight: number;
      normalizedTextWeight: number;
      provider_filter: RecallParams['provider_filter'];
      match_trigger_conditions: boolean;
      actualTriggerContext: Record<string, unknown> | undefined;
      wantScoreBreakdown: boolean;
      useHybridRecall: boolean;
      enableHybrid: boolean;
      searchStartTime: number;
      retrievalStrategy: RecallTelemetryRetrievalStrategy;
      queryHash: string;
    }
  ): Promise<{ searchResult: RecallHybridOrTextSearchResult; executionTime: number }> {
    const tel = context.services?.telemetryService;
    const {
      query,
      filters,
      limit,
      normalizedVectorWeight,
      normalizedTextWeight,
      provider_filter,
      match_trigger_conditions,
      actualTriggerContext,
      wantScoreBreakdown,
      useHybridRecall,
      enableHybrid,
      searchStartTime,
      retrievalStrategy,
      queryHash
    } = input;

    tel?.record({
      eventType: 'memory.search.requested',
      outcome: 'success',
      extraData: recallSearchRequestedExtra(queryHash, query, retrievalStrategy)
    });

    let searchResult: RecallHybridOrTextSearchResult;

    try {
      if (useHybridRecall) {
        this.validateService(context.services.hybridSearchEngine, '하이브리드 검색 엔진');

        this.logInfo('하이브리드 검색 실행', {
          query,
          vectorWeight: normalizedVectorWeight,
          textWeight: normalizedTextWeight
        });

        const providerFilter = normalizeProviderFilter(provider_filter);

        searchResult = await context.services.hybridSearchEngine.search(context.db, {
          query,
          filters,
          limit,
          vectorWeight: normalizedVectorWeight,
          textWeight: normalizedTextWeight,
          provider_filter: providerFilter,
          match_trigger_conditions: match_trigger_conditions,
          context: actualTriggerContext,
          include_score_breakdown: wantScoreBreakdown
        });
      } else {
        if (!context.services.searchEngine) {
          throw new Error('텍스트 검색 엔진을 사용할 수 없습니다');
        }

        this.logInfo('텍스트 검색 실행', { query });

        searchResult = await context.services.searchEngine.search(context.db, {
          query,
          filters,
          limit,
          include_score_breakdown: wantScoreBreakdown
        });
      }
    } catch (searchError) {
      this.logError(searchError as Error, '검색 실행 중 오류', { query, enableHybrid });
      const msg = (searchError as Error).message;
      tel?.record({
        eventType: 'memory.search.failed',
        outcome: 'failure',
        errorCode: 'search_execution_error',
        latencyMs: Date.now() - searchStartTime,
        extraData: {
          ...recallQueryCorrelationExtra(queryHash, query),
          retrieval_strategy: retrievalStrategy,
          message: msg
        }
      });
      throw new Error(`검색 실행 실패: ${msg}`);
    }

    const candCount = searchResult?.items?.length ?? 0;
    tel?.record({
      eventType: 'memory.search.candidates_retrieved',
      outcome: 'success',
      extraData: { candidate_count: candCount }
    });
    tel?.record({
      eventType: 'memory.search.reranked',
      outcome: 'success',
      extraData: { candidate_count: candCount }
    });

    const executionTime = Date.now() - searchStartTime;
    return { searchResult, executionTime };
  }

  private async runMemoryItemPostSearchPipeline(
    context: ToolContext,
    searchResult: RecallHybridOrTextSearchResult | undefined,
    input: {
      query: string;
      version_filter: RecallParams['version_filter'];
      version_series_id: RecallParams['version_series_id'];
      version_number: RecallParams['version_number'];
      include_version_chain: RecallParams['include_version_chain'];
      include_diff_with: RecallParams['include_diff_with'];
      owner_id_filter: RecallParams['owner_id'];
      process_id_filter: RecallParams['process_id'];
      session_id_filter: RecallParams['session_id'];
      project_id_filter: RecallParams['project_id'];
      match_trigger_conditions: boolean;
      actualTriggerContext: Record<string, unknown> | undefined;
      includeMetadata: boolean;
      return_format: 'full' | 'steps_only';
    }
  ): Promise<{ searchItems: RecallSearchItem[]; processedResults: RecallResultItem[] }> {
    const {
      query,
      version_filter,
      version_series_id,
      version_number,
      include_version_chain,
      include_diff_with,
      owner_id_filter,
      process_id_filter,
      session_id_filter,
      project_id_filter,
      match_trigger_conditions,
      actualTriggerContext,
      includeMetadata,
      return_format
    } = input;

    let searchItems: RecallSearchItem[] = (searchResult?.items ?? []) as RecallSearchItem[];

    if (version_filter && searchItems.length > 0) {
      searchItems = this.applyVersionFilter(searchItems, version_filter, version_series_id, version_number);
    }

    if (owner_id_filter && owner_id_filter.length > 0 && searchItems.length > 0) {
      const ownerIds = Array.isArray(owner_id_filter) ? owner_id_filter : [owner_id_filter];
      searchItems = searchItems.filter(
        (i: RecallSearchItem) => i.owner_id != null && ownerIds.includes(i.owner_id)
      );
    }

    if (process_id_filter && process_id_filter.length > 0 && searchItems.length > 0) {
      const processIds = Array.isArray(process_id_filter) ? process_id_filter : [process_id_filter];
      searchItems = searchItems.filter(
        (i: RecallSearchItem) => i.process_id != null && processIds.includes(i.process_id)
      );
    }
    if (session_id_filter && session_id_filter.length > 0 && searchItems.length > 0) {
      const sessionIds = Array.isArray(session_id_filter) ? session_id_filter : [session_id_filter];
      searchItems = searchItems.filter(
        (i: RecallSearchItem) => i.session_id != null && sessionIds.includes(i.session_id)
      );
    }
    if (project_id_filter && searchItems.length > 0) {
      searchItems = searchItems.filter(
        (i: RecallSearchItem) => i.project_id != null && i.project_id === project_id_filter
      );
    }

    if ((include_version_chain || include_diff_with) && context.db && searchItems.length > 0) {
      searchItems = await this.enrichProceduralVersionInfo(
        context.db,
        searchItems,
        include_version_chain === true,
        include_diff_with
      );
    }

    if (match_trigger_conditions && searchItems.length > 0) {
      searchItems = filterRecallItemsByTriggerConditions(searchItems, query, actualTriggerContext);
    }

    if (mementoConfig.consolidationScoreEnabled && context.services.consolidationScoreService && searchItems.length > 0) {
      await this.updateConsolidationScoreMetadata(
        context.db!,
        context.services.consolidationScoreService,
        context.services.writeCoalescingManager,
        searchItems
      );
    }

    if (context.services.metaMemoryService && searchItems.length > 0) {
      try {
        await this.collectMetaMemoryStats(
          searchItems,
          context.services.metaMemoryService
        );
      } catch (error) {
        this.logError(error as Error, '메타 통계 수집 실패', {});
      }
    }

    const processedResults = mapRecallSearchItemsToResultItems(searchItems, includeMetadata, return_format);
    return { searchItems, processedResults };
  }

  private async finalizeMemoryItemRecallEnvelope(
    context: ToolContext,
    input: {
      agentId: string;
      query: string;
      searchItems: RecallSearchItem[];
      processedResults: RecallResultItem[];
      searchResult: RecallHybridOrTextSearchResult | undefined;
      executionTime: number;
      startTime: number;
      searchStartTime: number;
      enableHybrid: boolean;
      includeMetadata: boolean;
      auto_set_anchor: boolean;
      include_neighbors: boolean;
      neighbors_limit: number;
      neighbors_per_item: number;
      neighbors_similarity_threshold: number;
      filters: MemorySearchFilters;
      normalizedVectorWeight: number;
      normalizedTextWeight: number;
      retrievalStrategy: RecallTelemetryRetrievalStrategy;
      queryHash: string;
    }
  ): Promise<ToolResult> {
    const {
      agentId,
      query,
      searchItems,
      processedResults,
      searchResult,
      executionTime,
      startTime,
      searchStartTime,
      enableHybrid,
      includeMetadata,
      auto_set_anchor,
      include_neighbors,
      neighbors_limit,
      neighbors_per_item,
      neighbors_similarity_threshold,
      filters,
      normalizedVectorWeight,
      normalizedTextWeight,
      retrievalStrategy,
      queryHash
    } = input;

    const tel = context.services?.telemetryService;

    let anchorSetResult: {
      success: boolean;
      anchor_set: AnchorSetMetadata | null;
      error?: boolean;
      skipped?: boolean;
      skipped_reason?: string;
    } | null = null;

    if (auto_set_anchor && searchItems.length > 0) {
      anchorSetResult = await this.handleAutoSetAnchor(searchItems, agentId, context);
    }

    let neighborsResults: NeighborMemory[][] = [];

    if (include_neighbors && searchItems.length > 0) {
      neighborsResults = await this.handleIncludeNeighbors(
        searchItems,
        neighbors_limit,
        neighbors_per_item,
        neighbors_similarity_threshold,
        context
      );

      for (let i = 0; i < Math.min(neighborsResults.length, processedResults.length); i++) {
        const row = processedResults[i];
        const neighbors = neighborsResults[i];
        if (row && neighbors) row.neighbors = neighbors as unknown as NeighborMemoryItem[];
      }
    }

    this.logInfo('검색 완료', {
      resultCount: processedResults.length,
      executionTime,
      searchType: enableHybrid ? 'hybrid' : 'text'
    });

    const sr = searchResult as unknown as {
      text_count?: number;
      vector_count?: number;
      fallback_used?: boolean;
      query_embedding_providers?: string[];
      tfidf_query_embedding_fallback?: boolean;
      tfidf_query_embedding_fallback_providers?: string[];
    };

    let metadata: RecallResponseMetadata | undefined;
    let metaStats: Record<string, MetaStatsItem> | undefined;

    if (includeMetadata) {
      metadata = {
        anchor_set: anchorSetResult?.anchor_set || null
      };

      if (anchorSetResult && anchorSetResult.error) {
        metadata.anchor_set_error = true;
      }

      if (anchorSetResult && anchorSetResult.skipped) {
        metadata.anchor_set_skipped = true;
        metadata.anchor_set_skipped_reason = anchorSetResult.skipped_reason;
      }

      if (searchResult && typeof sr.text_count === 'number' && typeof sr.vector_count === 'number') {
        metadata.text_result_count = sr.text_count;
        metadata.vector_result_count = sr.vector_count;
        if (typeof sr.fallback_used === 'boolean') metadata.fallback_used = sr.fallback_used;
      }

      const hybridRan = enableHybrid && context.services.hybridSearchEngine?.isEmbeddingAvailable();
      if (
        hybridRan &&
        sr.query_embedding_providers &&
        sr.query_embedding_providers.length > 0
      ) {
        const qe = buildQueryEmbeddingMetadataFields(
          sr.query_embedding_providers as EmbeddingProvider[]
        );
        metadata.embedding_provider = qe.embedding_provider;
        metadata.query_embedding_providers = qe.query_embedding_providers;
      }

      if (context.services.metaMemoryService && processedResults.length > 0) {
        metaStats = await this.getMetaStatsForResults(processedResults, context.services.metaMemoryService);
      }
    }

    const hybridRan = enableHybrid && context.services.hybridSearchEngine?.isEmbeddingAvailable();
    if (hybridRan && searchResult) {
      emitTfidfFallbackWarningIfNeeded(
        sr.fallback_used,
        sr.query_embedding_providers as EmbeddingProvider[] | undefined,
        sr.tfidf_query_embedding_fallback,
        sr.tfidf_query_embedding_fallback_providers as EmbeddingProvider[] | undefined
      );
    }

    if (mementoConfig.recallProfileEnabled) {
      this.logInfo('recall_profile', { total_ms: Date.now() - startTime });
    }
    const resultObj: Record<string, unknown> = {
      items: processedResults,
      total_count: searchResult?.total_count || processedResults.length,
      query_time: executionTime,
      search_type: enableHybrid ? 'hybrid' : 'text',
      vector_search_available: context.services.hybridSearchEngine?.isEmbeddingAvailable() || false,
      filters_applied: getAppliedRecallFilters(filters),
      search_options: {
        vector_weight: normalizedVectorWeight,
        text_weight: normalizedTextWeight,
        enable_hybrid: enableHybrid
      }
    };
    if (includeMetadata && metadata !== undefined) {
      resultObj.metadata = metadata;
    }
    if (includeMetadata && metaStats !== undefined) {
      resultObj.meta_stats = metaStats;
    }
    const cachedScan = context.services?.introspectionScanCache?.get();
    if (cachedScan && (cachedScan.result.lowConfidenceMemoryIds.length > 0 || cachedScan.result.highFailureMemoryIds.length > 0)) {
      resultObj.introspection_hint = {
        summary: `${cachedScan.result.summary}${INTROSPECTION_HINT_SUFFIX}`,
        low_confidence_count: cachedScan.result.lowConfidenceMemoryIds.length,
        high_failure_count: cachedScan.result.highFailureMemoryIds.length,
        scanned_at: cachedScan.scanned_at
      };
    }
    const recallTelemetryLatency = Date.now() - searchStartTime;
    if (processedResults.length === 0) {
      tel?.record({
        eventType: 'memory.search.empty',
        outcome: 'empty',
        latencyMs: recallTelemetryLatency,
        extraData: {
          ...recallQueryCorrelationExtra(queryHash, query),
          retrieval_strategy: retrievalStrategy
        }
      });
    } else {
      tel?.record({
        eventType: 'memory.search.selected',
        outcome: 'success',
        latencyMs: recallTelemetryLatency,
        extraData: {
          ...recallQueryCorrelationExtra(queryHash, query),
          retrieval_strategy: retrievalStrategy,
          selected_count: processedResults.length
        }
      });
    }
    return this.createSuccessResult(resultObj);
  }

  async handle(params: RecallParams, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();
    this.logInfo('Recall 도구 호출됨', { params });
    
    try {
      // 파라미터 검증 및 파싱
      const { 
        query, 
        type,
        key,
        agent_id,
        memory_types, 
        tags, 
        privacy_scope, 
        time_from, 
        time_to, 
        pinned, 
        importance_min: _importance_min, 
        importance_max: _importance_max,
        workflow_name,
        skill_name,
        match_trigger_conditions,
        context: triggerContext,
        trigger_context,
        return_format,
        limit, 
        vector_weight, 
        text_weight, 
        enable_hybrid, 
        include_metadata,
        provider_filter,
        auto_set_anchor,
        include_neighbors,
        neighbors_limit,
        neighbors_per_item,
        neighbors_similarity_threshold,
        version_filter,
        version_series_id,
        version_number,
        include_version_chain,
        include_diff_with,
        owner_id: owner_id_filter,
        process_id: process_id_filter,
        session_id: session_id_filter,
        project_id: project_id_filter,
        include_score_breakdown
      } = RecallSchema.parse(params);
      
      // trigger_context가 제공되면 context로 사용 (하위 호환성)
      const actualTriggerContext = triggerContext || trigger_context;
      
      // type 파라미터 롤아웃 모드 검증 (issue #290)
      // memory_types가 비어 있지 않으면 타입 필터 의도가 이미 드러나므로 missing-type 경고(validateTypeParam)를 생략한다.
      const typeParamMode = mementoConfig.typeParamMode;
      const originalTypeProvided = !!type; // 원래 type 파라미터가 제공되었는지 추적
      let validatedType = type;
      const hasMemoryTypesFilter = Array.isArray(memory_types) && memory_types.length > 0;

      if (!type) {
        if (hasMemoryTypesFilter) {
          validatedType = 'episodic' as MemoryTypeRequest;
        } else {
          const typeValidation = validateTypeParam(undefined, typeParamMode, 'recall');

          if (!typeValidation.isValid) {
            throw new Error(typeValidation.message || "type 파라미터는 필수입니다.");
          }

          if (typeValidation.message && (typeParamMode === 'warn' || typeParamMode === 'deprecate')) {
            this.logWarning(typeValidation.message);
          }

          if (typeValidation.defaultType) {
            validatedType = typeValidation.defaultType as MemoryTypeRequest;
          }
        }
      }
      
      this.logInfo('파라미터 파싱 완료', { 
        query, 
        type: validatedType,
        key,
        agent_id,
        memory_types, 
        tags, 
        privacy_scope, 
        limit, 
        vector_weight, 
        text_weight, 
        enable_hybrid,
        provider_filter
      });
      
      // 데이터베이스 연결 확인
      this.validateDatabase(context);
      
      const searchStartTime = Date.now();
      const agentId = agent_id || 'default';
      
      // type 파라미터에 따른 분기 처리
      if (validatedType === 'core') {
        return await this.recallCoreMemoryDirect(agentId, key, query, memory_types, searchStartTime, startTime, context);
      }
      if (validatedType === 'vault') {
        return await this.recallVaultMemoryDirect(agentId, key, query, memory_types, searchStartTime, startTime, context);
      }
      {
        // 기존 memory_item 검색 로직
        // query 필수 검증
        if (!query) {
          throw new Error("query 파라미터는 필수입니다 (type='core' 또는 'vault'가 아닌 경우)");
        }
        
        // 입력 검증
        this.validateString(query, '검색 쿼리', 1000);
        this.validateNumber(limit, '결과 제한', 1, 100);
        
        // 하이브리드 검색 엔진 확인
        this.validateService(context.services.hybridSearchEngine, '하이브리드 검색 엔진');
        
        // type과 memory_types 동시 사용 시 경고
        // 원래 type 파라미터가 제공되었는지 확인 (기본값이 아닌 경우)
        if (originalTypeProvided && memory_types && memory_types.length > 0) {
          this.logWarning('type 파라미터와 memory_types를 동시에 사용했습니다. type 파라미터를 우선 적용하고 memory_types는 무시합니다.', {
            type: validatedType,
            memory_types
          });
        }
        
        // memory_types 배열 전처리 ('core'/'vault' 제거)
        // validatedType이 존재하면 항상 [validatedType]로 시작 (기본값 포함)
        // originalTypeProvided가 false이고 memory_types가 제공되면 둘 다 고려하되, validatedType 우선
        let filteredMemoryTypes: MemoryTypeRequest[] | undefined;
        if (validatedType) {
          // validatedType이 있으면 항상 사용 (기본값이든 명시적 값이든)
          filteredMemoryTypes = [validatedType];
          // originalTypeProvided가 false이고 memory_types도 제공되면 경고
          if (!originalTypeProvided && memory_types && memory_types.length > 0) {
            this.logWarning('type 파라미터가 미지정되어 기본값이 적용되었지만, memory_types도 제공되었습니다. 기본 타입을 우선 적용하고 memory_types는 무시합니다.', {
              default_type: validatedType,
              memory_types
            });
          }
        } else {
          // validatedType이 없으면 memory_types 사용
          filteredMemoryTypes = memory_types;
        }
        if (filteredMemoryTypes && filteredMemoryTypes.length > 0) {
          const invalidTypes = filteredMemoryTypes.filter(t => t === 'core' || t === 'vault');
          if (invalidTypes.length > 0) {
            this.logWarning('memory_types 배열에서 core/vault는 memory_item 검색에 사용할 수 없습니다. 자동으로 제거합니다.', {
              invalid_types: invalidTypes,
              original_memory_types: filteredMemoryTypes,
              suggestion: 'Core/Vault 조회는 단일 type 파라미터를 사용하세요.'
            });
            filteredMemoryTypes = filteredMemoryTypes.filter(t => t !== 'core' && t !== 'vault') as MemoryTypeRequest[];
            if (filteredMemoryTypes.length === 0) {
              throw new Error("memory_types 배열에 유효한 타입이 없습니다. 'core'와 'vault'는 memory_types에서 사용할 수 없습니다. 단일 type 파라미터를 사용하여 Core/Vault를 조회하세요.");
            }
          }
          
          // 타입 가드 적용: MemoryTypeRequest[] -> MemoryType[]
          const validMemoryTypes = filteredMemoryTypes.filter((t): t is MemoryType => isMemoryItemType(t));
          if (validMemoryTypes.length === 0) {
            throw new Error("memory_types 배열에 유효한 타입이 없습니다.");
          }
          filteredMemoryTypes = validMemoryTypes;
        }
        
        // memory_item 검색에서는 agent_id를 계속 지원하지 않지만, 호출 레이어의 공통 파라미터로
        // 자주 전달되므로 운영 warn은 남기지 않고 조용히 무시한다.
        
        // 필터 객체 재구성
        // filteredMemoryTypes는 이미 validMemoryTypes로 변환되어 MemoryType[] 타입이거나 undefined
        // 타입 단언을 사용하여 TypeScript가 올바른 타입으로 인식하도록 함
        const finalMemoryTypes: MemoryType[] | undefined = filteredMemoryTypes && filteredMemoryTypes.length > 0 
          ? (filteredMemoryTypes as MemoryType[])
          : undefined;
        const filters: MemorySearchFilters = {
          type: finalMemoryTypes,
          tags,
          privacy_scope,
          time_from,
          time_to,
          pinned,
          has_reflection_notes: params.has_reflection_notes,
          // Procedural Memory Enhancement (v7.0) 필터
          workflow_name,
          skill_name,
          // Procedural Version Management (Issue #57 Phase 2)
          version_filter: version_filter as VersionFilterType | undefined,
          version_series_id,
          version_number,
          include_version_chain,
          include_diff_with,
          owner_id: owner_id_filter,
          process_id: process_id_filter,
          session_id: session_id_filter
        };
        
        // 검색 옵션 설정
        const vectorWeight = vector_weight ?? 0.6;
        const textWeight = text_weight ?? 0.4;
        const enableHybrid = enable_hybrid ?? true;
        const includeMetadata = include_metadata ?? true;
        /** 계약: score_breakdown은 include_metadata∧include_score_breakdown일 때만(검색 엔진 부하 절감) */
        const wantScoreBreakdown = includeMetadata && include_score_breakdown === true;
        
        // 가중치 정규화
        const totalWeight = vectorWeight + textWeight;
        const normalizedVectorWeight = totalWeight > 0 ? vectorWeight / totalWeight : 0.6;
        const normalizedTextWeight = totalWeight > 0 ? textWeight / totalWeight : 0.4;

        const queryHash = createHash('sha256').update(query).digest('hex').slice(0, 16);
        const useHybridRecall = Boolean(
          enableHybrid && context.services.hybridSearchEngine?.isEmbeddingAvailable()
        );
        const retrievalStrategy = recallTelemetryRetrievalStrategy(
          useHybridRecall,
          normalizedVectorWeight,
          normalizedTextWeight
        );
        const { searchResult, executionTime } = await this.executeHybridOrTextSearchForMemoryItem(context, {
          query,
          filters,
          limit,
          normalizedVectorWeight,
          normalizedTextWeight,
          provider_filter,
          match_trigger_conditions,
          actualTriggerContext,
          wantScoreBreakdown,
          useHybridRecall,
          enableHybrid,
          searchStartTime,
          retrievalStrategy,
          queryHash
        });

        const { searchItems, processedResults } = await this.runMemoryItemPostSearchPipeline(context, searchResult, {
          query,
          version_filter,
          version_series_id,
          version_number,
          include_version_chain,
          include_diff_with,
          owner_id_filter,
          process_id_filter,
          session_id_filter,
          project_id_filter,
          match_trigger_conditions,
          actualTriggerContext,
          includeMetadata,
          return_format
        });

        return await this.finalizeMemoryItemRecallEnvelope(context, {
          agentId,
          query,
          searchItems,
          processedResults,
          searchResult,
          executionTime,
          startTime,
          searchStartTime,
          enableHybrid,
          includeMetadata,
          auto_set_anchor,
          include_neighbors,
          neighbors_limit,
          neighbors_per_item,
          neighbors_similarity_threshold,
          filters,
          normalizedVectorWeight,
          normalizedTextWeight,
          retrievalStrategy,
          queryHash
        });
      }
      
    } catch (error) {
      this.logError(error as Error, 'Recall 도구 실행 실패', { params });
      
      // 실패 감지 훅 호출
      const executionTime = Date.now() - startTime;
      await this.handleFailure(
        error instanceof Error ? error : new Error(String(error)),
        params,
        context,
        executionTime
      );
      
      // 사용자 친화적인 에러 메시지 반환
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          throw new Error(`입력 검증 실패: ${error.message}`);
        } else if (error.message.includes('database')) {
          throw new Error(`데이터베이스 오류: ${error.message}`);
        } else if (error.message.includes('search')) {
          throw new Error(`검색 오류: ${error.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * version_filter에 따라 검색 결과를 필터링합니다.
   * latest_only: version_series_id별 최신(version 최대) 1건만 유지.
   * specific_version: version_series_id + version_number 일치 항목만 유지.
   */
  private applyVersionFilter(
    items: RecallSearchItem[],
    versionFilter: VersionFilterType,
    versionSeriesId?: string,
    versionNumber?: number
  ): RecallSearchItem[] {
    const procedural = items.filter((i: RecallSearchItem) => i.type === 'procedural');
    const nonProcedural = items.filter((i: RecallSearchItem) => i.type !== 'procedural');
    if (procedural.length === 0) return items;

    if (versionFilter === 'latest_only') {
      const bySeries = new Map<string, RecallSearchItem>();
      for (const item of procedural) {
        const sid = item.version_series_id ?? item.id ?? '';
        if (!sid) continue;
        const cur = bySeries.get(sid);
        const v = item.version ?? 0;
        if (!cur || (cur.version ?? 0) < v) bySeries.set(sid, item);
      }
      return [...nonProcedural, ...Array.from(bySeries.values())];
    }
    if (versionFilter === 'specific_version') {
      const filtered = procedural.filter((i: RecallSearchItem) => {
        if (versionSeriesId && i.version_series_id !== versionSeriesId) return false;
        if (versionNumber !== undefined && (i.version ?? 0) !== versionNumber) return false;
        return true;
      });
      return [...nonProcedural, ...filtered];
    }
    return items;
  }

  /**
   * procedural 항목에 version_chain 및 diff_with_previous/diff_with를 채웁니다.
   */
  private async enrichProceduralVersionInfo(
    db: Database.Database,
    items: RecallSearchItem[],
    includeVersionChain: boolean,
    includeDiffWith?: string
  ): Promise<RecallSearchItem[]> {
    return Promise.all(items.map(async (item: RecallSearchItem) => {
      if (item.type !== 'procedural') return item;
      const out = { ...item };
      const itemId = item.id;
      if (includeVersionChain && itemId) {
        try {
          out.version_chain = getVersionChain(db, itemId);
        } catch {
          out.version_chain = [];
        }
      }
      if (includeDiffWith && itemId) {
        try {
          if (includeDiffWith === 'previous') {
            const chain = getVersionChain(db, itemId);
            const prev = chain.filter((c: { version?: number; id: string }) => (c.version ?? 0) < (item.version ?? 0)).sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
            if (prev) {
              out.diff_with_previous = computeProceduralDiff(db, prev.id, itemId);
            } else {
              out.diff_with_previous = null;
            }
          } else {
            out.diff_with = computeProceduralDiff(db, itemId, includeDiffWith);
          }
        } catch {
          if (includeDiffWith === 'previous') out.diff_with_previous = null;
          else out.diff_with = null;
        }
      }
      return out;
    }));
  }

  /**
   * 자동 앵커 설정 처리
   * 가장 관련성 높은 기억(첫 번째 결과)을 슬롯 A에 앵커로 설정
   * 
   * @param searchItems - 검색 결과 항목 배열
   * @param agentId - 에이전트 ID
   * @param context - 도구 컨텍스트
   * @returns 앵커 설정 결과 (성공/실패/건너뜀 상태 포함)
   */
  private async handleAutoSetAnchor(
    searchItems: RecallSearchItem[],
    agentId: string,
    context: ToolContext
  ): Promise<{
    success: boolean;
    anchor_set: AnchorSetMetadata | null;
    error?: boolean;
    skipped?: boolean;
    skipped_reason?: string;
  }> {
    // 검색 결과가 없으면 앵커 설정 불가
    if (!searchItems || searchItems.length === 0) {
      return {
        success: false,
        anchor_set: null
      };
    }

    // 첫 번째 결과의 memory_id 가져오기 (length > 0 확인됨)
    const topMemory = searchItems[0]!;
    const memoryId = topMemory.id ?? topMemory.memory_id;
    
    if (!memoryId) {
      this.logWarning('검색 결과에 memory_id가 없어 앵커 설정을 건너뜁니다', { topMemory });
      return {
        success: false,
        anchor_set: null,
        error: true
      };
    }

    // AnchorManager 서비스 확인
    if (!context.services.anchorManager) {
      this.logWarning('AnchorManager 서비스가 없어 앵커 설정을 건너뜁니다');
      return {
        success: false,
        anchor_set: null,
        error: true
      };
    }

    try {
      // 슬롯 A의 앵커 조회 및 pinned 상태 확인 (memory_item 테이블과 조인)
      const slotAAnchor = await context.services.anchorManager.getAnchor(agentId, 'A');
      
      if (slotAAnchor && typeof slotAAnchor === 'object' && 'memory_id' in slotAAnchor) {
        // pinned 상태 확인 (memory_item 테이블과 조인)
        const anchorMemory = context.db!.prepare(`
          SELECT pinned FROM memory_item WHERE id = ?
        `).get(slotAAnchor.memory_id) as { pinned: number | boolean } | undefined;

        const isPinned = anchorMemory && (anchorMemory.pinned === 1 || anchorMemory.pinned === true);

        // 슬롯 A에 pinned 앵커가 있으면 건너뛰기 (보호 정책)
        if (isPinned) {
          this.logInfo('슬롯 A에 pinned 앵커가 있어 앵커 설정을 건너뜁니다', {
            agent_id: agentId,
            existing_memory_id: slotAAnchor.memory_id
          });
          return {
            success: false,
            anchor_set: null,
            skipped: true,
            skipped_reason: 'pinned_anchor_protected'
          };
        }

        // 슬롯 A에 일반 앵커가 있으면 슬롯 B로 이동
        const slotBAnchor = await context.services.anchorManager.getAnchor(agentId, 'B');
        
        if (slotBAnchor && typeof slotBAnchor === 'object' && 'memory_id' in slotBAnchor) {
          // 슬롯 B의 pinned 상태 확인
          const slotBMemory = context.db!.prepare(`
            SELECT pinned FROM memory_item WHERE id = ?
          `).get(slotBAnchor.memory_id) as { pinned: number | boolean } | undefined;

          const slotBIsPinned = slotBMemory && (slotBMemory.pinned === 1 || slotBMemory.pinned === true);

          if (slotBIsPinned) {
            this.logWarning('슬롯 B의 pinned 앵커가 덮어써집니다', {
              agent_id: agentId,
              old_memory_id: slotBAnchor.memory_id,
              new_memory_id: slotAAnchor.memory_id
            });
          }

          // 슬롯 B에 앵커가 있으면 슬롯 C로 이동
          const slotCAnchor = await context.services.anchorManager.getAnchor(agentId, 'C');
          
          if (slotCAnchor && typeof slotCAnchor === 'object' && 'memory_id' in slotCAnchor) {
            // 슬롯 C의 pinned 상태 확인
            const slotCMemory = context.db!.prepare(`
              SELECT pinned FROM memory_item WHERE id = ?
            `).get(slotCAnchor.memory_id) as { pinned: number | boolean } | undefined;

            const slotCIsPinned = slotCMemory && (slotCMemory.pinned === 1 || slotCMemory.pinned === true);

            if (slotCIsPinned) {
              this.logWarning('슬롯 C의 pinned 앵커가 제거됩니다', {
                agent_id: agentId,
                old_memory_id: slotCAnchor.memory_id
              });
            }

            // 슬롯 C에 앵커가 있으면 제거 (pinned 여부와 관계없이 회전 규칙에 따라 제거)
            await context.services.anchorManager.clearAnchor(agentId, 'C');
          }

          // 슬롯 B의 기존 앵커를 슬롯 C로 이동 (슬롯 B를 비우기 위해)
          // PRD: 슬롯 B/C의 pinned 앵커도 덮어쓰고 A→B→C→제거 순으로 회전
          // 먼저 슬롯 B를 제거한 후 슬롯 C에 설정
          const slotBMemoryId = slotBAnchor.memory_id;
          if (slotBMemoryId) {
            await context.services.anchorManager.clearAnchor(agentId, 'B');
            await context.services.anchorManager.setAnchor(agentId, slotBMemoryId, 'C');
          }
        }

        // 슬롯 A의 앵커를 슬롯 B로 이동
        // 먼저 슬롯 A를 제거한 후 슬롯 B에 설정
        const slotAMemoryId = slotAAnchor.memory_id;
        if (slotAMemoryId) {
          await context.services.anchorManager.clearAnchor(agentId, 'A');
          await context.services.anchorManager.setAnchor(agentId, slotAMemoryId, 'B');
        }
      }

      // 새로운 기억을 슬롯 A에 설정
      await context.services.anchorManager.setAnchor(agentId, memoryId, 'A');

      this.logInfo('앵커가 자동으로 설정되었습니다', {
        agent_id: agentId,
        memory_id: memoryId,
        slot: 'A'
      });

      return {
        success: true,
        anchor_set: {
          memory_id: memoryId,
          slot: 'A',
          agent_id: agentId
        }
      };
    } catch (error) {
      // 앵커 설정 실패 시 경고만 로그하고 검색 결과는 정상 반환
      this.logError(error as Error, '앵커 자동 설정 실패', {
        agent_id: agentId,
        memory_id: memoryId
      });
      
      return {
        success: false,
        anchor_set: null,
        error: true
      };
    }
  }

  /**
   * 자동 이웃 기억 포함 처리
   * 검색 결과의 상위 항목에 대해 이웃 기억을 자동으로 포함
   * 
   * @param searchItems - 검색 결과 항목 배열
   * @param neighborsLimit - 이웃 기억을 포함할 상위 결과의 개수
   * @param neighborsPerItem - 각 검색 결과 항목당 조회할 이웃 기억의 최대 개수
   * @param neighborsSimilarityThreshold - 이웃 기억 조회 시 유사도 임계값
   * @param context - 도구 컨텍스트
   * @returns 각 검색 결과 항목에 대한 이웃 기억 배열 (순서 보존)
   */
  private async handleIncludeNeighbors(
    searchItems: RecallSearchItem[],
    neighborsLimit: number,
    neighborsPerItem: number,
    neighborsSimilarityThreshold: number,
    context: ToolContext
  ): Promise<NeighborMemory[][]> {
    // 검색 결과가 없으면 빈 배열 반환
    if (!searchItems || searchItems.length === 0) {
      return [];
    }

    // 상위 neighbors_limit개 결과 추출 (검색 결과 개수보다 작으면 검색 결과 개수로 제한)
    const topResults = searchItems.slice(0, Math.min(neighborsLimit, searchItems.length));

    // MemoryNeighborService 인스턴스 생성
    let neighborService: MemoryNeighborService;
    try {
      const vectorSearchEngine = context.services?.vectorSearchEngine ?? getVectorSearchEngine();
      const embeddingService = context.services.embeddingService || new MemoryEmbeddingService();
      neighborService = new MemoryNeighborService(vectorSearchEngine, embeddingService, context.db!);
    } catch (error) {
      this.logError(error as Error, 'MemoryNeighborService 초기화 실패', {});
      // 서비스 초기화 실패 시 빈 배열 반환 (각 요소가 독립적인 배열 인스턴스)
      return Array.from({ length: topResults.length }, () => []);
    }

    // 각 상위 결과에 대해 이웃 기억 조회를 병렬 처리
    const neighborPromises = topResults.map(async (item, index) => {
      const memoryId = item.id || item.memory_id;
      
      if (!memoryId) {
        this.logWarning('검색 결과에 memory_id가 없어 이웃 기억 조회를 건너뜁니다', { item });
        return { index, neighbors: [] };
      }

      try {
        // 개별 이웃 기억 조회에 타임아웃 적용 (각 조회당 최대 2초)
        const timeoutPromise = new Promise<{ index: number; neighbors: NeighborMemory[] }>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 2000);
        });

        const neighborPromise = neighborService.getNeighbors(memoryId, {
          limit: neighborsPerItem,
          similarity_threshold: neighborsSimilarityThreshold
        }).then(result => ({
          index,
          neighbors: result.neighbors
        }));

        const result = await Promise.race([neighborPromise, timeoutPromise]);
        return result;
      } catch (error) {
        // 타임아웃 또는 에러 발생 시 빈 배열 반환
        if (error instanceof Error && error.message === 'Timeout') {
          this.logWarning('이웃 기억 조회 타임아웃', { memoryId, index });
        } else {
          this.logError(error as Error, '이웃 기억 조회 실패', { memoryId, index });
        }
        return { index, neighbors: [] };
      }
    });

    // 전체 요청 타임아웃 적용 (2.5초, 부분 성공 결과 반환)
    // 각 promise의 완료 상태를 추적하여 타임아웃 시 즉시 완료된 것만 반환
    const completedResults = new Map<number, { index: number; neighbors: NeighborMemory[] }>();
    
    // 각 promise에 대해 완료 시 결과를 저장
    neighborPromises.forEach((promise, idx) => {
      promise
        .then(result => {
          completedResults.set(idx, result);
        })
        .catch(() => {
          // 에러는 무시하고 빈 배열로 처리
          completedResults.set(idx, { index: idx, neighbors: [] });
        });
    });
    
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<Array<{ index: number; neighbors: NeighborMemory[] }>>((resolve) => {
      timeoutId = setTimeout(() => {
        // 타임아웃 시 현재까지 완료된 결과만 즉시 반환 (Promise.allSettled를 기다리지 않음)
        const partialResults: Array<{ index: number; neighbors: NeighborMemory[] }> = [];
        
        // 완료된 결과 수집
        for (let i = 0; i < topResults.length; i++) {
          if (completedResults.has(i)) {
            partialResults.push(completedResults.get(i)!);
          } else {
            // 완료되지 않은 항목은 빈 배열로 채움
            partialResults.push({ index: i, neighbors: [] });
          }
        }
        
        // 인덱스 순서로 정렬하여 반환
        resolve(partialResults.sort((a, b) => a.index - b.index));
      }, 2500); // 전체 타임아웃: 2.5초
    });

    try {
      const allNeighbors = await Promise.race([
        Promise.all(neighborPromises),
        timeoutPromise
      ]);

      // 타임아웃 취소
      if (timeoutId) clearTimeout(timeoutId);

      // 결과를 원래 순서로 정렬 (인덱스 기준)
      const sortedNeighbors = allNeighbors
        .sort((a, b) => a.index - b.index)
        .map(r => r.neighbors);

      return sortedNeighbors;
    } catch (error) {
      // 타임아웃 취소
      if (timeoutId) clearTimeout(timeoutId);
      
      // 타임아웃 시에도 부분 완료 결과는 반환됨 (timeoutPromise에서 처리)
      // 완료된 결과만 반환
      const settledResults = await Promise.allSettled(neighborPromises);
      return settledResults.map((r, _idx) => 
        r.status === 'fulfilled' 
          ? r.value.neighbors 
          : [] // 실패한 항목은 빈 배열
      );
    }
  }

  /**
   * Meta Memory Statistics 수집
   * 
   * 검색 결과를 기반으로 각 메모리 항목의 통계를 수집합니다.
   * 
   * @param searchItems 검색 결과 항목 배열
   * @param metaMemoryService MetaMemoryService 인스턴스
   */
  private async collectMetaMemoryStats(
    searchItems: RecallSearchItem[],
    metaMemoryService: MetaMemoryService
  ): Promise<void> {
    if (!searchItems || searchItems.length === 0) {
      return;
    }

    try {
      // MetaMemoryService.recordRecall 호출
      // searchItems를 RecallResultItem[] 형식으로 변환 (memory_id 필수, 확장 필드는 인덱스 시그니처로)
      const recallItems = searchItems.map((item): RecallResultItem => {
        const memoryId = item.id ?? item.memory_id ?? '';
        const createdAt = item.created_at instanceof Date ? item.created_at.toISOString() : String(item.created_at ?? '');
        const finalScore = item.final_score ?? item.finalScore ?? item.score ?? 0;
        return {
          memory_id: memoryId,
          id: item.id ?? item.memory_id,
          content: item.content,
          type: item.type,
          importance: item.importance,
          created_at: createdAt,
          final_score: finalScore
        } as RecallResultItem;
      });

      await metaMemoryService.recordRecall(recallItems);
    } catch (error) {
      // 에러는 상위로 전파하지 않음 (통계 수집 실패가 recall 성공 여부에 영향 없도록)
      this.logError(error as Error, 'Meta Memory Statistics 수집 실패', {
        items_count: searchItems.length
      });
    }
  }

  /**
   * Meta Memory Statistics 조회
   * 
   * 검색 결과에 포함된 메모리 항목의 통계를 조회합니다.
   * include_metadata=true일 때만 호출됩니다.
   * 
   * @param processedResults 처리된 검색 결과 항목 배열
   * @param metaMemoryService MetaMemoryService 인스턴스
   * @returns meta_stats 객체 (memory_id를 키로 하는 객체) 또는 undefined
   */
  private async getMetaStatsForResults(
    processedResults: RecallResultItem[],
    metaMemoryService: MetaMemoryService
  ): Promise<Record<string, MetaStatsItem> | undefined> {
    try {
      // 통계 업데이트를 위해 debounce 시간 대기 (100ms)
      // 실제로는 flush가 완료될 때까지 대기하는 것이 더 정확하지만,
      // 성능을 위해 최소 대기 시간만 적용
      await new Promise(resolve => setTimeout(resolve, 150));

      // 검색 결과에 포함된 메모리 ID 목록 추출 (중복 제거)
      const memoryIds = Array.from(
        new Set(
          processedResults
            .map(item => item.memory_id || item.id)
            .filter((id): id is string => !!id)
        )
      );

      if (memoryIds.length === 0) {
        return undefined;
      }

      // MetaMemoryService.getStats 호출하여 통계 조회
      const statsResult = await metaMemoryService.getStats({
        memory_ids: memoryIds
      });

      // meta_stats 객체 생성 (memory_id를 키로 하는 객체)
      const metaStats: Record<string, MetaStatsItem> = {};
      for (const stat of statsResult.items) {
        metaStats[stat.memory_id] = {
          recall_count: stat.recall_count,
          success_count: stat.success_count,
          failure_count: stat.failure_count,
          avg_confidence: stat.avg_confidence,
          last_recalled_at: stat.last_recalled_at?.toISOString()
        };
      }

      return metaStats;
    } catch (error) {
      // 통계 조회 실패는 로깅만 수행하고 recall 성공 여부에 영향 없음
      this.logError(error as Error, '메타 통계 조회 실패', {
        items_count: processedResults.length
      });
      return undefined;
    }
  }

  /**
   * Consolidation Score 메타데이터 업데이트
   * 검색 결과로 반환된 메모리들의 recall_count, last_accessed_at, g_value 업데이트
   * Write Coalescing을 사용하여 I/O 부하를 줄입니다.
   * 
   * @param db 데이터베이스 연결
   * @param consolidationScoreService Consolidation Score 서비스
   * @param writeCoalescingManager Write Coalescing Manager (선택적)
   * @param searchItems 검색 결과 아이템 배열
   */
  private async updateConsolidationScoreMetadata(
    db: Database.Database,
    consolidationScoreService: IConsolidationScoreService,
    writeCoalescingManager: WriteCoalescingManager | undefined,
    searchItems: RecallSearchItem[]
  ): Promise<void> {
    if (!searchItems || searchItems.length === 0) {
      return;
    }

    try {
      const now = new Date();
      const nowISO = now.toISOString();

      // 각 검색 결과에 대해 업데이트
      for (const item of searchItems) {
        const memoryId = item.id || item.memory_id;
        if (!memoryId) {
          continue; // ID가 없으면 스킵
        }

        try {
          // 기존 메모리 정보 조회 (recall_count, last_accessed_at, g_value, created_at, type, pinned)
          const memory = DatabaseUtils.get(
            db,
            `SELECT 
              recall_count, 
              last_accessed_at, 
              g_value, 
              created_at, 
              type, 
              pinned 
            FROM memory_item 
            WHERE id = ?`,
            [memoryId]
          ) as {
            recall_count: number;
            last_accessed_at: string | null;
            g_value: number | null;
            created_at: string;
            type: MemoryType;
            pinned: boolean | number;
          } | undefined;

          if (!memory) {
            this.logWarning(`메모리를 찾을 수 없습니다: ${memoryId}`);
            continue;
          }

          // recall_count 증가
          const newRecallCount = (memory.recall_count || 0) + 1;

          // 경과 시간 계산 (last_accessed_at이 있으면 사용, 없으면 created_at 사용)
          const lastAccessedAt = memory.last_accessed_at 
            ? new Date(memory.last_accessed_at) 
            : new Date(memory.created_at);
          const timeElapsed = consolidationScoreService.calculateTimeElapsed(
            lastAccessedAt,
            new Date(memory.created_at),
            now
          );

          // g_value 업데이트
          const newGValue = consolidationScoreService.updateGValueForRecall({
            previousGValue: memory.g_value,
            timeElapsed
          });

          // consolidation_score 계산
          const scoreResult = consolidationScoreService.calculateScore({
            recallCount: newRecallCount,
            lastAccessedAt: now,
            createdAt: new Date(memory.created_at),
            gValue: newGValue,
            type: memory.type,
            pinned: memory.pinned === 1 || memory.pinned === true
          });

          // Write Coalescing 사용 여부 확인
          if (writeCoalescingManager) {
            // 버퍼에 추가 (주기적으로 flush됨)
            writeCoalescingManager.addWrite({
              memoryId,
              fields: {
                recall_count: newRecallCount,
                last_accessed_at: nowISO,
                g_value: newGValue,
                consolidation_score: scoreResult.score
              }
            });
          } else {
            // Write Coalescing이 없으면 즉시 업데이트
            DatabaseUtils.run(
              db,
              `UPDATE memory_item 
               SET 
                 recall_count = ?,
                 last_accessed_at = ?,
                 g_value = ?,
                 consolidation_score = ?
               WHERE id = ?`,
              [newRecallCount, nowISO, newGValue, scoreResult.score, memoryId]
            );
          }

        } catch (error) {
          // 개별 메모리 업데이트 실패해도 다른 메모리는 계속 업데이트
          this.logWarning(`메모리 업데이트 실패 (${memoryId})`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } catch (error) {
      // 전체 업데이트 실패해도 검색 결과는 정상 반환
      this.logError(error as Error, 'Consolidation Score 메타데이터 업데이트 실패', {
        itemCount: searchItems.length
      });
    }
  }
}

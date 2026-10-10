/**
 * Recall 응답 봉투·앵커·이웃·메타 통계 (recall-tool.ts에서 분리, #445).
 */

import { mementoConfig } from '../../../shared/config/index.js';
import { buildIntrospectionHint } from '../../../shared/constants/introspection-constants.js';
import type { EmbeddingProvider } from '../../../shared/types/embedding.types.js';
import type { MemorySearchFilters } from '../../../shared/types/search.types.js';
import { emitTfidfFallbackWarningIfNeeded } from '../../../shared/utils/embedding-provider-diagnostics.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import type { NeighborMemory } from '../services/memory-neighbor-service.js';
import type { MetaMemoryService } from '../introspection/meta-memory-service.js';
import { getAppliedRecallFilters } from './recall-tool-filters.js';
import { handleAutoSetAnchor, type AnchorSetResult } from './recall-tool-anchor-rotation.js';
import type { RecallToolHost } from './recall-tool-host.js';
import { handleIncludeNeighbors } from './recall-tool-neighbors-fetch.js';
import {
  buildQueryEmbeddingMetadataFields,
  recallQueryCorrelationExtra
} from './recall-tool-telemetry.js';
import type { RecallHybridOrTextSearchResult, RecallTelemetryRetrievalStrategy } from './recall-tool-schema.js';
import type { RelevanceGateOutcome } from '../../search/ports/relevance-gate-port.js';
import type {
  MetaStatsItem,
  NeighborMemoryItem,
  RecallResponseMetadata,
  RecallResultItem,
  RecallSearchItem
} from './recall-tool-types.js';

/**
 * Meta Memory Statistics 조회
 */
async function getMetaStatsForResults(
  host: RecallToolHost,
  processedResults: RecallResultItem[],
  metaMemoryService: MetaMemoryService
): Promise<Record<string, MetaStatsItem> | undefined> {
  try {
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

    const statsResult = await metaMemoryService.getStats({
      memory_ids: memoryIds
    });

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
    host.logError(error as Error, '메타 통계 조회 실패', {
      items_count: processedResults.length
    });
    return undefined;
  }
}

type RecallEnvelopeInput = {
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
};

/** 검색 엔진 결과의 선택 필드 (하이브리드·텍스트 결과 공통으로 읽는다) */
type SearchResultExtras = {
  text_count?: number;
  vector_count?: number;
  fallback_used?: boolean;
  rejection_gate?: RelevanceGateOutcome;
  query_embedding_providers?: string[];
  tfidf_query_embedding_fallback?: boolean;
  tfidf_query_embedding_fallback_providers?: string[];
};

function didHybridRun(enableHybrid: boolean, context: ToolContext): boolean | undefined {
  return enableHybrid && context.services.hybridSearchEngine?.isEmbeddingAvailable();
}

async function attachNeighbors(host: RecallToolHost, context: ToolContext, input: RecallEnvelopeInput): Promise<void> {
  const { searchItems, processedResults } = input;
  const neighborsResults: NeighborMemory[][] = await handleIncludeNeighbors(
    host,
    searchItems,
    input.neighbors_limit,
    input.neighbors_per_item,
    input.neighbors_similarity_threshold,
    context
  );

  for (let i = 0; i < Math.min(neighborsResults.length, processedResults.length); i++) {
    const row = processedResults[i];
    const neighbors = neighborsResults[i];
    if (row && neighbors) row.neighbors = neighbors as unknown as NeighborMemoryItem[];
  }
}

function applyAnchorMetadata(metadata: RecallResponseMetadata, anchorSetResult: AnchorSetResult | null): void {
  if (anchorSetResult?.error) {
    metadata.anchor_set_error = true;
  }
  if (anchorSetResult?.skipped) {
    metadata.anchor_set_skipped = true;
    metadata.anchor_set_skipped_reason = anchorSetResult.skipped_reason;
  }
}

function applySearchResultMetadata(
  metadata: RecallResponseMetadata,
  context: ToolContext,
  input: RecallEnvelopeInput,
  sr: SearchResultExtras
): void {
  if (input.searchResult && typeof sr.text_count === 'number' && typeof sr.vector_count === 'number') {
    metadata.text_result_count = sr.text_count;
    metadata.vector_result_count = sr.vector_count;
    if (typeof sr.fallback_used === 'boolean') metadata.fallback_used = sr.fallback_used;
  }

  if (sr?.rejection_gate) {
    metadata.rejection_gate = sr.rejection_gate;
  }

  if (didHybridRun(input.enableHybrid, context) && sr.query_embedding_providers && sr.query_embedding_providers.length > 0) {
    const qe = buildQueryEmbeddingMetadataFields(sr.query_embedding_providers as EmbeddingProvider[]);
    metadata.embedding_provider = qe.embedding_provider;
    metadata.query_embedding_providers = qe.query_embedding_providers;
  }
}

async function buildRecallMetadata(
  host: RecallToolHost,
  context: ToolContext,
  input: RecallEnvelopeInput,
  anchorSetResult: AnchorSetResult | null,
  sr: SearchResultExtras
): Promise<{ metadata: RecallResponseMetadata; metaStats: Record<string, MetaStatsItem> | undefined }> {
  const metadata: RecallResponseMetadata = {
    anchor_set: anchorSetResult?.anchor_set || null
  };
  applyAnchorMetadata(metadata, anchorSetResult);
  applySearchResultMetadata(metadata, context, input, sr);

  let metaStats: Record<string, MetaStatsItem> | undefined;
  if (context.services.metaMemoryService && input.processedResults.length > 0) {
    metaStats = await getMetaStatsForResults(host, input.processedResults, context.services.metaMemoryService);
  }
  return { metadata, metaStats };
}

function hasExplicitScopeFilter(filters: MemorySearchFilters): boolean {
  return [
    filters.project_id,
    filters.owner_id,
    filters.process_id,
    filters.session_id,
  ].some(value => Array.isArray(value) ? value.length > 0 : Boolean(value));
}

function recordRecallOutcome(context: ToolContext, input: RecallEnvelopeInput): void {
  const selectedCount = input.processedResults.length;
  const extraData = {
    ...recallQueryCorrelationExtra(input.queryHash, input.query),
    retrieval_strategy: input.retrievalStrategy
  };
  context.services?.telemetryService?.record({
    eventType: selectedCount === 0 ? 'memory.search.empty' : 'memory.search.selected',
    outcome: selectedCount === 0 ? 'empty' : 'success',
    latencyMs: Date.now() - input.searchStartTime,
    extraData: selectedCount === 0 ? extraData : { ...extraData, selected_count: selectedCount }
  });
}

export async function finalizeMemoryItemRecallEnvelope(
  host: RecallToolHost,
  context: ToolContext,
  input: RecallEnvelopeInput
): Promise<ToolResult> {
  const { searchItems, processedResults, searchResult, executionTime, enableHybrid, includeMetadata, filters } = input;

  let anchorSetResult: AnchorSetResult | null = null;
  if (input.auto_set_anchor && searchItems.length > 0) {
    anchorSetResult = await handleAutoSetAnchor(host, searchItems, input.agentId, context);
  }

  if (input.include_neighbors && searchItems.length > 0) {
    await attachNeighbors(host, context, input);
  }

  host.logInfo('검색 완료', {
    resultCount: processedResults.length,
    executionTime,
    searchType: enableHybrid ? 'hybrid' : 'text'
  });

  const sr = searchResult as unknown as SearchResultExtras;
  const recallMetadata = includeMetadata
    ? await buildRecallMetadata(host, context, input, anchorSetResult, sr)
    : undefined;

  if (didHybridRun(enableHybrid, context) && searchResult) {
    emitTfidfFallbackWarningIfNeeded(
      sr.fallback_used,
      sr.query_embedding_providers as EmbeddingProvider[] | undefined,
      sr.tfidf_query_embedding_fallback,
      sr.tfidf_query_embedding_fallback_providers as EmbeddingProvider[] | undefined
    );
  }

  if (mementoConfig.recallProfileEnabled) {
    host.logInfo('recall_profile', { total_ms: Date.now() - input.startTime });
  }
  const resultObj: Record<string, unknown> = {
    items: processedResults,
    total_count: hasExplicitScopeFilter(filters)
      ? processedResults.length
      : (searchResult?.total_count || processedResults.length),
    query_time: executionTime,
    search_type: enableHybrid ? 'hybrid' : 'text',
    vector_search_available: context.services.hybridSearchEngine?.isEmbeddingAvailable() || false,
    filters_applied: getAppliedRecallFilters(filters),
    search_options: {
      vector_weight: input.normalizedVectorWeight,
      text_weight: input.normalizedTextWeight,
      enable_hybrid: enableHybrid
    }
  };
  if (recallMetadata) {
    resultObj.metadata = recallMetadata.metadata;
    if (recallMetadata.metaStats !== undefined) resultObj.meta_stats = recallMetadata.metaStats;
  }
  const introspectionHint = buildIntrospectionHint(context.services?.introspectionScanCache?.get());
  if (introspectionHint) {
    resultObj.introspection_hint = introspectionHint;
  }
  recordRecallOutcome(context, input);
  return host.createSuccessResult(resultObj);
}

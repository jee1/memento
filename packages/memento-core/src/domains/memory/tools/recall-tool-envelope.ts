/**
 * Recall 응답 봉투·앵커·이웃·메타 통계 (recall-tool.ts에서 분리, #445).
 */

import { mementoConfig } from '../../../shared/config/index.js';
import { INTROSPECTION_HINT_SUFFIX } from '../../../shared/constants/introspection-constants.js';
import type { EmbeddingProvider, MemorySearchFilters } from '../../../shared/types/index.js';
import { emitTfidfFallbackWarningIfNeeded } from '../../../shared/utils/embedding-provider-diagnostics.js';
import { formatMementoResourceUri, memoryItemResourceKind } from '../../../shared/utils/memento-resource-uri.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import type { NeighborMemory } from '../services/memory-neighbor-service.js';
import type { MetaMemoryService } from '../services/meta-memory-service.js';
import { EventOutboxService } from '../../telemetry/services/event-outbox-service.js';
import { getAppliedRecallFilters } from './recall-tool-filters.js';
import { handleAutoSetAnchor } from './recall-tool-anchor-rotation.js';
import type { RecallToolHost } from './recall-tool-host.js';
import { handleIncludeNeighbors } from './recall-tool-neighbors-fetch.js';
import {
  buildQueryEmbeddingMetadataFields,
  recallQueryCorrelationExtra
} from './recall-tool-telemetry.js';
import type { RecallHybridOrTextSearchResult, RecallTelemetryRetrievalStrategy } from './recall-tool-schema.js';
import type {
  AnchorSetMetadata,
  MetaStatsItem,
  NeighborMemoryItem,
  RecallResponseMetadata,
  RecallResultItem,
  RecallSearchItem
} from './recall-tool-types.js';

/**
 * Meta Memory Statistics 조회
 */
export async function getMetaStatsForResults(
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

export async function finalizeMemoryItemRecallEnvelope(
  host: RecallToolHost,
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
    anchorSetResult = await handleAutoSetAnchor(host, searchItems, agentId, context);
  }

  let neighborsResults: NeighborMemory[][] = [];

  if (include_neighbors && searchItems.length > 0) {
    neighborsResults = await handleIncludeNeighbors(
      host,
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

  host.logInfo('검색 완료', {
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
      metaStats = await getMetaStatsForResults(host, processedResults, context.services.metaMemoryService);
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
    host.logInfo('recall_profile', { total_ms: Date.now() - startTime });
  }
  const hasExplicitScopeFilter = [
    filters.project_id,
    filters.owner_id,
    filters.process_id,
    filters.session_id,
  ].some(value => Array.isArray(value) ? value.length > 0 : Boolean(value));
  const resultObj: Record<string, unknown> = {
    items: processedResults,
    total_count: hasExplicitScopeFilter
      ? processedResults.length
      : (searchResult?.total_count || processedResults.length),
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
  try {
    const outbox = new EventOutboxService(context.db);
    for (const item of processedResults) {
      const targetUri = item.uri ?? formatMementoResourceUri({
        ownerId: input.agentId,
        kind: memoryItemResourceKind(item.type),
        id: item.memory_id,
      });
      outbox.enqueue({
        eventType: 'memory.recalled',
        targetUri,
        ownerId: input.agentId,
        payload: { memory_id: item.memory_id, query_hash: input.queryHash },
        idempotencyKey: `memory.recalled:${targetUri}:${input.startTime}`,
      });
    }
  } catch (error) {
    host.logWarning('Outbox event enqueue failed after memory recall', {
      error: error instanceof Error ? error.message : String(error), selected_count: processedResults.length,
    });
  }
  return host.createSuccessResult(resultObj);
}

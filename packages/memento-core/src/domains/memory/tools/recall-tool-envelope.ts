/**
 * Recall 응답 봉투·앵커·이웃·메타 통계 (recall-tool.ts에서 분리, #445).
 */

import { mementoConfig } from '../../../shared/config/index.js';
import { INTROSPECTION_HINT_SUFFIX } from '../../../shared/constants/introspection-constants.js';
import type { EmbeddingProvider, MemorySearchFilters } from '../../../shared/types/index.js';
import { emitTfidfFallbackWarningIfNeeded } from '../../../shared/utils/embedding-provider-diagnostics.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { getVectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';
import type { NeighborMemory } from '../services/memory-neighbor-service.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { MemoryNeighborService } from '../services/memory-neighbor-service.js';
import type { MetaMemoryService } from '../services/meta-memory-service.js';
import { getAppliedRecallFilters } from './recall-tool-filters.js';
import type { RecallToolHost } from './recall-tool-host.js';
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
    await new Promise(resolve => setTimeout(resolve, 150));

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

/**
 * 자동 앵커 설정 처리
 */
export async function handleAutoSetAnchor(
  host: RecallToolHost,
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
  if (!searchItems || searchItems.length === 0) {
    return {
      success: false,
      anchor_set: null
    };
  }

  const topMemory = searchItems[0]!;
  const memoryId = topMemory.id ?? topMemory.memory_id;

  if (!memoryId) {
    host.logWarning('검색 결과에 memory_id가 없어 앵커 설정을 건너뜁니다', { topMemory });
    return {
      success: false,
      anchor_set: null,
      error: true
    };
  }

  if (!context.services.anchorManager) {
    host.logWarning('AnchorManager 서비스가 없어 앵커 설정을 건너뜁니다');
    return {
      success: false,
      anchor_set: null,
      error: true
    };
  }

  try {
    const slotAAnchor = await context.services.anchorManager.getAnchor(agentId, 'A');

    if (slotAAnchor && typeof slotAAnchor === 'object' && 'memory_id' in slotAAnchor) {
      const anchorMemory = context.db!.prepare(`
          SELECT pinned FROM memory_item WHERE id = ?
        `).get(slotAAnchor.memory_id) as { pinned: number | boolean } | undefined;

      const isPinned = anchorMemory && (anchorMemory.pinned === 1 || anchorMemory.pinned === true);

      if (isPinned) {
        host.logInfo('슬롯 A에 pinned 앵커가 있어 앵커 설정을 건너뜁니다', {
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

      const slotBAnchor = await context.services.anchorManager.getAnchor(agentId, 'B');

      if (slotBAnchor && typeof slotBAnchor === 'object' && 'memory_id' in slotBAnchor) {
        const slotBMemory = context.db!.prepare(`
            SELECT pinned FROM memory_item WHERE id = ?
          `).get(slotBAnchor.memory_id) as { pinned: number | boolean } | undefined;

        const slotBIsPinned = slotBMemory && (slotBMemory.pinned === 1 || slotBMemory.pinned === true);

        if (slotBIsPinned) {
          host.logWarning('슬롯 B의 pinned 앵커가 덮어써집니다', {
            agent_id: agentId,
            old_memory_id: slotBAnchor.memory_id,
            new_memory_id: slotAAnchor.memory_id
          });
        }

        const slotCAnchor = await context.services.anchorManager.getAnchor(agentId, 'C');

        if (slotCAnchor && typeof slotCAnchor === 'object' && 'memory_id' in slotCAnchor) {
          const slotCMemory = context.db!.prepare(`
              SELECT pinned FROM memory_item WHERE id = ?
            `).get(slotCAnchor.memory_id) as { pinned: number | boolean } | undefined;

          const slotCIsPinned = slotCMemory && (slotCMemory.pinned === 1 || slotCMemory.pinned === true);

          if (slotCIsPinned) {
            host.logWarning('슬롯 C의 pinned 앵커가 제거됩니다', {
              agent_id: agentId,
              old_memory_id: slotCAnchor.memory_id
            });
          }

          await context.services.anchorManager.clearAnchor(agentId, 'C');
        }

        const slotBMemoryId = slotBAnchor.memory_id;
        if (slotBMemoryId) {
          await context.services.anchorManager.clearAnchor(agentId, 'B');
          await context.services.anchorManager.setAnchor(agentId, slotBMemoryId, 'C');
        }
      }

      const slotAMemoryId = slotAAnchor.memory_id;
      if (slotAMemoryId) {
        await context.services.anchorManager.clearAnchor(agentId, 'A');
        await context.services.anchorManager.setAnchor(agentId, slotAMemoryId, 'B');
      }
    }

    await context.services.anchorManager.setAnchor(agentId, memoryId, 'A');

    host.logInfo('앵커가 자동으로 설정되었습니다', {
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
    host.logError(error as Error, '앵커 자동 설정 실패', {
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
 */
export async function handleIncludeNeighbors(
  host: RecallToolHost,
  searchItems: RecallSearchItem[],
  neighborsLimit: number,
  neighborsPerItem: number,
  neighborsSimilarityThreshold: number,
  context: ToolContext
): Promise<NeighborMemory[][]> {
  if (!searchItems || searchItems.length === 0) {
    return [];
  }

  const topResults = searchItems.slice(0, Math.min(neighborsLimit, searchItems.length));

  let neighborService: MemoryNeighborService;
  try {
    const vectorSearchEngine = context.services?.vectorSearchEngine ?? getVectorSearchEngine();
    const embeddingService = context.services.embeddingService || new MemoryEmbeddingService();
    neighborService = new MemoryNeighborService(vectorSearchEngine, embeddingService, context.db!);
  } catch (error) {
    host.logError(error as Error, 'MemoryNeighborService 초기화 실패', {});
    return Array.from({ length: topResults.length }, () => []);
  }

  const neighborPromises = topResults.map(async (item, index) => {
    const memoryId = item.id || item.memory_id;

    if (!memoryId) {
      host.logWarning('검색 결과에 memory_id가 없어 이웃 기억 조회를 건너뜁니다', { item });
      return { index, neighbors: [] };
    }

    try {
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
      if (error instanceof Error && error.message === 'Timeout') {
        host.logWarning('이웃 기억 조회 타임아웃', { memoryId, index });
      } else {
        host.logError(error as Error, '이웃 기억 조회 실패', { memoryId, index });
      }
      return { index, neighbors: [] };
    }
  });

  const completedResults = new Map<number, { index: number; neighbors: NeighborMemory[] }>();

  neighborPromises.forEach((promise, idx) => {
    promise
      .then(result => {
        completedResults.set(idx, result);
      })
      .catch(() => {
        completedResults.set(idx, { index: idx, neighbors: [] });
      });
  });

  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<Array<{ index: number; neighbors: NeighborMemory[] }>>((resolve) => {
    timeoutId = setTimeout(() => {
      const partialResults: Array<{ index: number; neighbors: NeighborMemory[] }> = [];

      for (let i = 0; i < topResults.length; i++) {
        if (completedResults.has(i)) {
          partialResults.push(completedResults.get(i)!);
        } else {
          partialResults.push({ index: i, neighbors: [] });
        }
      }

      resolve(partialResults.sort((a, b) => a.index - b.index));
    }, 2500);
  });

  try {
    const allNeighbors = await Promise.race([
      Promise.all(neighborPromises),
      timeoutPromise
    ]);

    if (timeoutId) clearTimeout(timeoutId);

    const sortedNeighbors = allNeighbors
      .sort((a, b) => a.index - b.index)
      .map(r => r.neighbors);

    return sortedNeighbors;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);

    const settledResults = await Promise.allSettled(neighborPromises);
    return settledResults.map((r, _idx) =>
      r.status === 'fulfilled'
        ? r.value.neighbors
        : []
    );
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
  return host.createSuccessResult(resultObj);
}

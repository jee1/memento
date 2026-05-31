/**
 * Recall 하이브리드/텍스트 검색 실행 (recall-tool.ts에서 분리, #445).
 */

import type { MemorySearchFilters } from '../../../shared/types/index.js';
import type { ToolContext } from '../../../tools/types.js';
import {
  recallQueryCorrelationExtra,
  recallSearchRequestedExtra
} from './recall-tool-telemetry.js';
import type { RecallToolHost } from './recall-tool-host.js';
import {
  normalizeProviderFilter,
  type RecallHybridOrTextSearchResult,
  type RecallParams,
  type RecallTelemetryRetrievalStrategy
} from './recall-tool-schema.js';

export async function executeHybridOrTextSearchForMemoryItem(
  host: RecallToolHost,
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
      host.validateService(context.services.hybridSearchEngine, '하이브리드 검색 엔진');

      host.logInfo('하이브리드 검색 실행', {
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

      host.logInfo('텍스트 검색 실행', { query });

      searchResult = await context.services.searchEngine.search(context.db, {
        query,
        filters,
        limit,
        include_score_breakdown: wantScoreBreakdown
      });
    }
  } catch (searchError) {
    host.logError(searchError as Error, '검색 실행 중 오류', { query, enableHybrid });
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

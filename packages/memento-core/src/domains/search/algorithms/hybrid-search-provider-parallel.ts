/**
 * Multi-provider VEC search: per-provider tasks, overall timeout, Promise.allSettled aggregation, diagnostics.
 * Extracted from HybridSearchEngine (Issues #315, #349).
 */

import { HYBRID_SEARCH } from '../../../shared/config/constants.js';
import type { EmbeddingProvider } from '../../../shared/types/embedding.types.js';
import type { MemoryType } from '../../../shared/types/memory.types.js';
import type { VectorSearchResult } from '../../memory/services/memory-embedding-service.js';

export type VectorResultWithProvider = VectorSearchResult & { provider: string };

/** Single provider race outcome (matches Promise shape from createProviderSearchTask). */
export type ProviderVectorRaceResult = {
  provider: string;
  results: VectorResultWithProvider[];
  success: boolean;
  timeMs: number;
  error: string | null;
  queryEmbeddingProvider?: EmbeddingProvider;
  tfidfQueryEmbeddingFallback?: boolean;
};

export type ProviderSearchExecutionSummary = {
  allResults: VectorResultWithProvider[];
  providerStats: Array<{
    provider: string;
    resultCount: number;
    success: boolean;
    timeMs: number;
    error?: string;
  }>;
  overallTimeoutOccurred: boolean;
  queryEmbeddingProviders?: EmbeddingProvider[];
  tfidfQueryEmbeddingFallback: boolean;
  tfidfQueryEmbeddingFallbackProviders?: EmbeddingProvider[];
};

export type SearchStepLogger = (searchId: string, step: string, data: unknown) => void;

export type ProviderVectorSearchOptions = {
  limit: number;
  threshold: number;
  types?: MemoryType[];
  includeContent: boolean;
  project_id?: string;
  owner_id?: string | string[];
};

type VectorSearchRow = {
  memory_id: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  similarity: number;
  project_id?: string | null;
  owner_id?: string | null;
  process_id?: string | null;
  session_id?: string | null;
};

/** Injected from HybridSearchEngine so this module stays free of SearchError / engine imports. */
export type ProviderVectorSearchDeps = {
  generateQueryVector: (
    query: string,
    searchId: string,
    preferredProvider: EmbeddingProvider
  ) => Promise<{ embedding: number[]; actualProvider: EmbeddingProvider }>;
  vectorSearch: (
    vector: number[],
    options: ProviderVectorSearchOptions,
    provider?: string
  ) => Promise<VectorSearchRow[]>;
  logSearchStep: SearchStepLogger;
};

export async function runSingleProviderVectorSearch(
  deps: ProviderVectorSearchDeps,
  provider: EmbeddingProvider,
  query: string,
  searchOptions: ProviderVectorSearchOptions,
  searchId: string,
  providerStartTime: bigint,
  timeoutMeta: { queryEmbeddingProvider?: EmbeddingProvider; tfidfQueryEmbeddingFallback?: boolean }
): Promise<ProviderVectorRaceResult> {
  try {
    const { embedding, actualProvider } = await deps.generateQueryVector(query, searchId, provider);
    timeoutMeta.queryEmbeddingProvider = actualProvider;
    timeoutMeta.tfidfQueryEmbeddingFallback = actualProvider === 'tfidf' && provider !== 'tfidf';
    if (actualProvider !== provider) {
      deps.logSearchStep(searchId, `VEC 검색 스킵 (provider 불일치: 요청=${provider}, 실제=${actualProvider})`, {
        provider,
        actualProvider
      });
      const providerTime = Number(process.hrtime.bigint() - providerStartTime) / 1_000_000;
      return {
        provider,
        results: [] as VectorResultWithProvider[],
        success: true,
        timeMs: providerTime,
        error: null,
        queryEmbeddingProvider: actualProvider,
        tfidfQueryEmbeddingFallback: timeoutMeta.tfidfQueryEmbeddingFallback
      };
    }
    const vecResults = await deps.vectorSearch(embedding, searchOptions, provider);
    const providerTime = Number(process.hrtime.bigint() - providerStartTime) / 1_000_000;
    return {
      provider,
      results: vecResults.map(result => ({
        id: result.memory_id,
        content: result.content,
        type: result.type,
        importance: result.importance,
        created_at: result.created_at,
        pinned: false,
        score: result.similarity,
        similarity: result.similarity,
        provider,
        ...(result.project_id !== undefined ? { project_id: result.project_id } : {}),
        ...(result.owner_id !== undefined ? { owner_id: result.owner_id } : {}),
        ...(result.process_id !== undefined ? { process_id: result.process_id } : {}),
        ...(result.session_id !== undefined ? { session_id: result.session_id } : {}),
      })),
      success: true,
      timeMs: providerTime,
      error: null,
      queryEmbeddingProvider: actualProvider,
      tfidfQueryEmbeddingFallback: false
    };
  } catch (error) {
    const providerTime = Number(process.hrtime.bigint() - providerStartTime) / 1_000_000;
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.logSearchStep(searchId, `VEC 벡터 검색 실패 - ${provider}`, {
      provider,
      error: errorMessage,
      timeMs: providerTime
    });
    return {
      provider,
      results: [] as VectorResultWithProvider[],
      success: false,
      timeMs: providerTime,
      error: errorMessage
    };
  }
}

export function createProviderVectorSearchTask(
  deps: ProviderVectorSearchDeps,
  provider: EmbeddingProvider,
  query: string,
  searchOptions: ProviderVectorSearchOptions,
  searchId: string
): Promise<ProviderVectorRaceResult> {
  const providerStartTime = process.hrtime.bigint();
  const timeoutMeta: {
    queryEmbeddingProvider?: EmbeddingProvider;
    tfidfQueryEmbeddingFallback?: boolean;
  } = {};

  const timeoutPromise = new Promise<ProviderVectorRaceResult>(resolve => {
    setTimeout(() => {
      const providerTime = Number(process.hrtime.bigint() - providerStartTime) / 1_000_000;
      resolve({
        provider,
        results: [] as VectorResultWithProvider[],
        success: false,
        timeMs: providerTime,
        error: `Provider 검색 타임아웃 (${HYBRID_SEARCH.PROVIDER_SEARCH_TIMEOUT_MS}ms 초과)`,
        queryEmbeddingProvider: timeoutMeta.queryEmbeddingProvider,
        tfidfQueryEmbeddingFallback: timeoutMeta.tfidfQueryEmbeddingFallback
      });
    }, HYBRID_SEARCH.PROVIDER_SEARCH_TIMEOUT_MS);
  });

  const searchTask = runSingleProviderVectorSearch(
    deps,
    provider,
    query,
    searchOptions,
    searchId,
    providerStartTime,
    timeoutMeta
  );
  return Promise.race([searchTask, timeoutPromise]);
}

export async function executeProviderSearchesWithOverallTimeout(
  searchPromises: Promise<ProviderVectorRaceResult>[],
  providersToSearch: EmbeddingProvider[],
  searchId: string,
  logSearchStep: SearchStepLogger
): Promise<ProviderSearchExecutionSummary> {
  let overallTimeoutOccurred = false;
  let overallTimeoutHandle: NodeJS.Timeout | null = null;

  const overallTimeoutPromise = new Promise<void>(resolve => {
    overallTimeoutHandle = setTimeout(() => {
      overallTimeoutOccurred = true;
      logSearchStep(searchId, 'VEC 벡터 검색 전체 타임아웃', {
        timeoutMs: HYBRID_SEARCH.OVERALL_SEARCH_TIMEOUT_MS,
        message: '전체 검색 프로세스 타임아웃 발생 - 현재까지 완료된 결과만 반환'
      });
      resolve();
    }, HYBRID_SEARCH.OVERALL_SEARCH_TIMEOUT_MS);
  });

  const cleanupTimeout = (): void => {
    if (overallTimeoutHandle !== null) {
      clearTimeout(overallTimeoutHandle);
      overallTimeoutHandle = null;
    }
  };

  try {
    const searchResults = await Promise.race([
      Promise.allSettled(searchPromises).then(results => {
        cleanupTimeout();
        return results;
      }),
      overallTimeoutPromise.then(() => Promise.allSettled(searchPromises))
    ]);

    const allResults: VectorResultWithProvider[] = [];
    const providerStats: Array<{
      provider: string;
      resultCount: number;
      success: boolean;
      timeMs: number;
      error?: string;
    }> = [];
    const queryEmbeddingProvidersRaw: EmbeddingProvider[] = [];
    const tfidfFallbackRequestedProvidersRaw: EmbeddingProvider[] = [];
    let tfidfQueryEmbeddingFallback = false;

    searchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const providerResult = result.value;
        if (providerResult.tfidfQueryEmbeddingFallback) {
          tfidfQueryEmbeddingFallback = true;
          tfidfFallbackRequestedProvidersRaw.push(providerResult.provider as EmbeddingProvider);
        }
        if (providerResult.queryEmbeddingProvider) {
          queryEmbeddingProvidersRaw.push(providerResult.queryEmbeddingProvider);
        }
        providerStats.push({
          provider: providerResult.provider,
          resultCount: providerResult.results.length,
          success: providerResult.success,
          timeMs: providerResult.timeMs,
          error: providerResult.error || undefined
        });

        if (!providerResult.success) {
          const isTimeout = providerResult.error?.includes('타임아웃');
          logSearchStep(searchId, `VEC 벡터 검색 실패 - ${providerResult.provider}`, {
            provider: providerResult.provider,
            error: providerResult.error,
            timeMs: providerResult.timeMs,
            isTimeout,
            resultCount: providerResult.results.length
          });
        }

        if (providerResult.success) {
          allResults.push(...providerResult.results);
        }
      } else {
        const provider = providersToSearch[index];
        if (!provider) {
          return;
        }
        const errorMessage = result.reason instanceof Error ? result.reason.message : String(result.reason);
        providerStats.push({
          provider,
          resultCount: 0,
          success: false,
          timeMs: 0,
          error: errorMessage
        });

        logSearchStep(searchId, `VEC 벡터 검색 Promise 실패 - ${provider}`, {
          provider,
          error: errorMessage,
          isTimeout: false
        });
      }
    });

    const queryEmbeddingProviders =
      queryEmbeddingProvidersRaw.length > 0 ? [...new Set(queryEmbeddingProvidersRaw)].sort() : undefined;

    const tfidfQueryEmbeddingFallbackProviders =
      tfidfFallbackRequestedProvidersRaw.length > 0
        ? [...new Set(tfidfFallbackRequestedProvidersRaw)].sort()
        : undefined;

    return {
      allResults,
      providerStats,
      overallTimeoutOccurred,
      queryEmbeddingProviders,
      tfidfQueryEmbeddingFallback,
      tfidfQueryEmbeddingFallbackProviders
    };
  } finally {
    cleanupTimeout();
  }
}

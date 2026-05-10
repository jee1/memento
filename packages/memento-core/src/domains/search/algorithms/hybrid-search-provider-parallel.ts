/**
 * Multi-provider VEC search: overall timeout, Promise.allSettled aggregation, diagnostics.
 * Extracted from HybridSearchEngine to reduce method size (Issue 315).
 */

import { HYBRID_SEARCH } from '../../../shared/config/constants.js';
import type { EmbeddingProvider } from '../../../shared/types/index.js';
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

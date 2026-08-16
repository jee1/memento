import Database from 'better-sqlite3';
import { HYBRID_SEARCH } from '../../../shared/config/constants.js';
import { mementoConfig } from '../../../shared/config/index.js';
import type { EmbeddingProvider, StoredEmbeddingProviderStats } from '../../../shared/types/index.js';
import { logger } from '../../../shared/utils/logger.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import type { VectorSearchResult } from '../../memory/services/memory-embedding-service.js';
import { normalizeSearchBySimilarityOutcome, collectResultIds, filterByVectorThreshold, fillUnderfilledVectorResults } from './hybrid-search-outcome-utils.js';
import {
  createProviderVectorSearchTask,
  executeProviderSearchesWithOverallTimeout,
  type ProviderVectorSearchDeps,
} from './hybrid-search-provider-parallel.js';
import type {
  HybridSearchQuery,
  IEmbeddingService,
  ISearchLogger,
  IVectorSearchEngine,
} from './hybrid-search-types.js';
import { SearchError, SearchErrorType } from './search-error.js';

export function resolveHybridVectorPrefetchLimit(requestedLimit?: number): number {
  const base = requestedLimit ?? 10;
  return Math.min(
    HYBRID_SEARCH.MAX_VECTOR_PREFETCH_LIMIT,
    base * HYBRID_SEARCH.VECTOR_SEARCH_LIMIT_MULTIPLIER
  );
}

export function resolveQueryUnifiedEmbeddingForHybridSearch(
  embeddingService: IEmbeddingService
): UnifiedEmbeddingService {
  const ext = embeddingService as IEmbeddingService & {
    getUnifiedEmbeddingService?: () => UnifiedEmbeddingService;
  };
  if (typeof ext.getUnifiedEmbeddingService === 'function') {
    return ext.getUnifiedEmbeddingService();
  }
  return new UnifiedEmbeddingService();
}

export type HybridVectorSearchOutput = {
  results: VectorSearchResult[];
  fallback_used: boolean;
  query_embedding_providers?: EmbeddingProvider[];
  tfidf_query_embedding_fallback?: boolean;
  tfidf_query_embedding_fallback_providers?: EmbeddingProvider[];
  raw_ids?: string[];
  thresholded_ids?: string[];
};

export class HybridVectorSearchExecutor {
  private providerCache: {
    stats: StoredEmbeddingProviderStats[];
    timestamp: number;
  } | null = null;

  private static readonly PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private embeddingService: IEmbeddingService,
    private vectorSearchEngine: IVectorSearchEngine,
    private queryEmbeddingService: UnifiedEmbeddingService,
    private searchLogger: ISearchLogger,
    private providerDetector?: (db: Database.Database) => Promise<StoredEmbeddingProviderStats[]>,
    private queryVectorGenerator?: (
      query: string,
      searchId: string,
      preferredProvider: EmbeddingProvider
    ) => Promise<{ embedding: number[]; actualProvider: EmbeddingProvider }>
  ) {}

  async execute(
    db: Database.Database,
    query: HybridSearchQuery,
    searchId: string
  ): Promise<HybridVectorSearchOutput> {
    const vectorSearchStart = process.hrtime.bigint();
    this.searchLogger.logSearchStep(searchId, '벡터 검색 시작', {
      query: query.query,
      embeddingAvailable: this.embeddingService.isAvailable(),
    });

    this.vectorSearchEngine.initialize(db);

    if (this.vectorSearchEngine.getIndexStatus().available) {
      return this.executeVecSearch(db, query, searchId, vectorSearchStart);
    }

    const fb = await this.executeFallbackSearch(db, query, searchId, vectorSearchStart);
    return {
      ...fb,
      fallback_used: true,
    };
  }

  private async executeVecSearch(
    db: Database.Database,
    query: HybridSearchQuery,
    searchId: string,
    startTime: bigint
  ): Promise<HybridVectorSearchOutput> {
    try {
      const detectedProviders = this.providerDetector
        ? await this.providerDetector(db)
        : await this.detectAllStoredEmbeddingProviders(db);
      const providersToSearch = this.filterProvidersToSearch(
        detectedProviders,
        query.provider_filter,
        searchId
      );

      if (providersToSearch.length === 0) {
        return {
          results: [],
          query_embedding_providers: [],
          fallback_used: false,
          tfidf_query_embedding_fallback: false,
          tfidf_query_embedding_fallback_providers: undefined,
          raw_ids: [],
          thresholded_ids: [],
        };
      }

      const searchOptions = {
        limit: resolveHybridVectorPrefetchLimit(query.limit),
        threshold: 0,
        types: query.filters?.type,
        includeContent: true,
        ...(typeof query.filters?.project_id === 'string' && query.filters.project_id.length > 0
          ? { project_id: query.filters.project_id }
          : {}),
        ...(query.filters?.owner_id !== undefined && query.filters.owner_id !== null
          ? { owner_id: query.filters.owner_id }
          : {}),
        ...(query.filters?.process_id !== undefined && query.filters.process_id !== null
          ? { process_id: query.filters.process_id }
          : {}),
        ...(query.filters?.session_id !== undefined && query.filters.session_id !== null
          ? { session_id: query.filters.session_id }
          : {}),
      };

      const providerVectorDeps = this.getProviderVectorSearchDeps();
      const searchPromises = providersToSearch.map(provider =>
        createProviderVectorSearchTask(providerVectorDeps, provider, query.query, searchOptions, searchId)
      );

      const {
        allResults,
        providerStats,
        overallTimeoutOccurred,
        queryEmbeddingProviders,
        tfidfQueryEmbeddingFallback,
        tfidfQueryEmbeddingFallbackProviders,
      } = await executeProviderSearchesWithOverallTimeout(
        searchPromises,
        providersToSearch,
        searchId,
        (sid, step, data) => this.searchLogger.logSearchStep(sid, step, data)
      );

      const thresholded = filterByVectorThreshold(allResults, HYBRID_SEARCH.HYBRID_VECTOR_THRESHOLD);
      const rankingPool = HYBRID_SEARCH.VECTOR_UNDERFILL_FILL
        ? fillUnderfilledVectorResults(thresholded, allResults, query.limit || 10)
        : thresholded;
      const vectorResults = this.normalizeAndDeduplicateResults(rankingPool);
      const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;

      this.searchLogger.logSearchStep(searchId, 'VEC 벡터 검색 완료', {
        resultCount: vectorResults.length,
        totalVectorTime: `${totalTime.toFixed(2)}ms`,
        providerStats,
        searchedProviders: providersToSearch.length,
        successfulProviders: providerStats.filter(s => s.success).length,
        overallTimeoutOccurred,
      });

      return {
        results: vectorResults,
        query_embedding_providers: queryEmbeddingProviders,
        fallback_used: false,
        tfidf_query_embedding_fallback: tfidfQueryEmbeddingFallback,
        tfidf_query_embedding_fallback_providers: tfidfQueryEmbeddingFallbackProviders,
        raw_ids: collectResultIds(allResults),
        thresholded_ids: collectResultIds(thresholded),
      };
    } catch (error) {
      this.searchLogger.logSearchStep(searchId, 'VEC 벡터 검색 실패, fallback 사용', {
        error: error instanceof Error ? error.message : String(error),
      });

      const fb = await this.executeFallbackSearch(db, query, searchId, startTime);
      return {
        ...fb,
        fallback_used: true,
      };
    }
  }

  private filterProvidersToSearch(
    detectedProviders: StoredEmbeddingProviderStats[],
    providerFilter: EmbeddingProvider[] | undefined,
    searchId: string
  ): EmbeddingProvider[] {
    let providersToSearch = detectedProviders.map(p => p.provider);

    if (providerFilter && providerFilter.length > 0) {
      providersToSearch = providersToSearch.filter(p =>
        providerFilter.includes(p as EmbeddingProvider)
      );
    }

    if (providersToSearch.length === 0) {
      this.searchLogger.logSearchStep(searchId, 'VEC 벡터 검색 - 검색할 provider 없음', {
        detectedProviders: detectedProviders.map(p => p.provider),
        providerFilter: providerFilter || [],
      });
    }

    return providersToSearch;
  }

  private getProviderVectorSearchDeps(): ProviderVectorSearchDeps {
    return {
      generateQueryVector: (query, searchId, preferred) =>
        this.queryVectorGenerator
          ? this.queryVectorGenerator(query, searchId, preferred)
          : this.generateQueryVector(query, searchId, preferred),
      vectorSearch: (vector, options, provider) =>
        this.vectorSearchEngine.search(vector, options, provider),
      logSearchStep: (searchId, step, data) =>
        this.searchLogger.logSearchStep(searchId, step, data),
    };
  }

  private normalizeAndDeduplicateResults(
    allResults: Array<VectorSearchResult & { provider: string }>
  ): VectorSearchResult[] {
    const resultsByProvider = this.groupResultsByProvider(allResults);
    const normalizedResults = this.normalizeResultsByProvider(resultsByProvider);
    const deduplicatedResults = this.deduplicateNormalizedResults(normalizedResults);
    return this.rankResults(deduplicatedResults);
  }

  private groupResultsByProvider(
    allResults: Array<VectorSearchResult & { provider: string }>
  ): Map<string, Array<VectorSearchResult & { provider: string }>> {
    const resultsByProvider = new Map<string, Array<VectorSearchResult & { provider: string }>>();
    allResults.forEach(result => {
      const provider = result.provider;
      if (!resultsByProvider.has(provider)) {
        resultsByProvider.set(provider, []);
      }
      resultsByProvider.get(provider)?.push(result);
    });
    return resultsByProvider;
  }

  private normalizeResultsByProvider(
    resultsByProvider: Map<string, Array<VectorSearchResult & { provider: string }>>
  ): Array<VectorSearchResult & { provider: string; normalizedScore: number }> {
    const normalizedResults: Array<VectorSearchResult & { provider: string; normalizedScore: number }> = [];

    resultsByProvider.forEach(results => {
      if (results.length === 0) {
        return;
      }

      const scores = results.map(r => r.similarity);
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);

      results.forEach(result => {
        const normalizedScore =
          maxScore === minScore ? result.similarity : (result.similarity - minScore) / (maxScore - minScore);
        normalizedResults.push({
          ...result,
          normalizedScore,
        });
      });
    });

    return normalizedResults;
  }

  private deduplicateNormalizedResults(
    normalizedResults: Array<VectorSearchResult & { provider: string; normalizedScore: number }>
  ): Array<VectorSearchResult & { provider: string; normalizedScore: number }> {
    const resultMap = new Map<string, VectorSearchResult & { provider: string; normalizedScore: number }>();
    normalizedResults.forEach(result => {
      const existing = resultMap.get(result.id);
      if (!existing || result.normalizedScore > existing.normalizedScore) {
        resultMap.set(result.id, result);
      }
    });
    return Array.from(resultMap.values());
  }

  private rankResults(
    deduplicatedResults: Array<VectorSearchResult & { provider: string; normalizedScore: number }>
  ): VectorSearchResult[] {
    return deduplicatedResults
      .map(({ provider: _provider, normalizedScore, ...result }) => ({
        ...result,
        similarity: normalizedScore,
      }))
      .sort((a, b) => b.similarity - a.similarity);
  }

  private async executeFallbackSearch(
    db: Database.Database,
    query: HybridSearchQuery,
    searchId: string,
    _startTime: bigint
  ): Promise<Omit<HybridVectorSearchOutput, 'fallback_used'>> {
    if (!this.embeddingService.isAvailable()) {
      this.searchLogger.logSearchStep(searchId, '임베딩 서비스 사용 불가', {});
      return { results: [], raw_ids: [], thresholded_ids: [] };
    }

    const fallbackStart = process.hrtime.bigint();
    const raw = await this.embeddingService.searchBySimilarity(db, query.query, {
      type: query.filters?.type,
      limit: resolveHybridVectorPrefetchLimit(query.limit),
      threshold: 0,
      ...(typeof query.filters?.project_id === 'string' && query.filters.project_id.length > 0
        ? { project_id: query.filters.project_id }
        : {}),
      ...(query.filters?.owner_id !== undefined && query.filters.owner_id !== null
        ? { owner_id: query.filters.owner_id }
        : {}),
      ...(query.filters?.process_id !== undefined && query.filters.process_id !== null
        ? { process_id: query.filters.process_id }
        : {}),
      ...(query.filters?.session_id !== undefined && query.filters.session_id !== null
        ? { session_id: query.filters.session_id }
        : {}),
    });
    const { results, query_embedding_providers } = normalizeSearchBySimilarityOutcome(raw);
    const fallbackTime = Number(process.hrtime.bigint() - fallbackStart) / 1_000_000;

    this.searchLogger.logSearchStep(searchId, 'Fallback 벡터 검색 완료', {
      resultCount: results.length,
      fallbackTime: `${fallbackTime.toFixed(2)}ms`,
    });

    const configured = mementoConfig.embeddingProvider as EmbeddingProvider;
    const rawProviderFilter = (query.provider_filter ?? []).filter(Boolean) as EmbeddingProvider[];
    const explicitProviderFilterRequested = rawProviderFilter.length > 0;
    const explicitTfidfOnlyRequest =
      explicitProviderFilterRequested && rawProviderFilter.every(p => p === 'tfidf');
    const requestedProviders = [...new Set(rawProviderFilter.filter(p => p !== 'tfidf'))]
      .sort() as EmbeddingProvider[];
    let tfidf_query_embedding_fallback: boolean | undefined;
    let tfidf_query_embedding_fallback_providers: EmbeddingProvider[] | undefined;

    if (query_embedding_providers?.includes('tfidf')) {
      if (explicitTfidfOnlyRequest) {
        // provider_filter=['tfidf'] is intentional TF-IDF mode.
      } else if (requestedProviders.length > 0) {
        tfidf_query_embedding_fallback = true;
        tfidf_query_embedding_fallback_providers = requestedProviders;
      } else if (configured !== 'tfidf') {
        tfidf_query_embedding_fallback = true;
        tfidf_query_embedding_fallback_providers = [configured];
      }
    }

    const thresholded = filterByVectorThreshold(results, HYBRID_SEARCH.HYBRID_VECTOR_THRESHOLD);
    const rankingPool = HYBRID_SEARCH.VECTOR_UNDERFILL_FILL
      ? fillUnderfilledVectorResults(thresholded, results, query.limit || 10)
      : thresholded;

    return {
      results: rankingPool,
      query_embedding_providers,
      tfidf_query_embedding_fallback,
      tfidf_query_embedding_fallback_providers,
      raw_ids: collectResultIds(results),
      thresholded_ids: collectResultIds(thresholded),
    };
  }

  async detectAllStoredEmbeddingProviders(db: Database.Database): Promise<StoredEmbeddingProviderStats[]> {
    const now = Date.now();
    if (this.providerCache && (now - this.providerCache.timestamp) < HybridVectorSearchExecutor.PROVIDER_CACHE_TTL_MS) {
      return this.providerCache.stats;
    }

    try {
      const providerStatsList = db.prepare(`
        SELECT
          LOWER(embedding_provider) as provider,
          COUNT(*) as count,
          AVG(dimensions) as avg_dimensions
        FROM memory_embedding
        WHERE embedding_provider IS NOT NULL
          AND embedding_provider != ''
          AND dimensions IS NOT NULL
        GROUP BY LOWER(embedding_provider)
        ORDER BY count DESC
      `).all() as Array<{ provider: string; count: number; avg_dimensions: number }>;

      if (providerStatsList && providerStatsList.length > 0) {
        const normalizedStats: StoredEmbeddingProviderStats[] = providerStatsList
          .filter(stat => {
            const validProviders: EmbeddingProvider[] = ['tfidf', 'lightweight', 'minilm', 'openai', 'gemini'];
            return validProviders.includes(stat.provider as EmbeddingProvider);
          })
          .map(stat => ({
            provider: stat.provider as EmbeddingProvider,
            count: stat.count,
            avg_dimensions: Math.round(stat.avg_dimensions || 0),
          }));

        this.providerCache = {
          stats: normalizedStats,
          timestamp: now,
        };

        this.searchLogger.logSearchStep('', '저장된 임베딩 provider 감지', {
          providers: normalizedStats.map(s => s.provider),
          total_providers: normalizedStats.length,
        });

        return normalizedStats;
      }
    } catch (error) {
      const maskedError = error instanceof Error
        ? PIIMasker.maskError(error)
        : { message: String(error), name: 'Error' };
      logger.warn('저장된 임베딩 provider 감지 실패', {
        error: maskedError.message,
      });
    }

    const emptyStats: StoredEmbeddingProviderStats[] = [];
    this.providerCache = {
      stats: emptyStats,
      timestamp: now,
    };
    return emptyStats;
  }

  async generateQueryVector(
    query: string,
    searchId: string,
    preferredProvider: EmbeddingProvider
  ): Promise<{ embedding: number[]; actualProvider: EmbeddingProvider }> {
    try {
      const embeddingStart = process.hrtime.bigint();
      const embeddingResult = await this.queryEmbeddingService.generateEmbedding(query, preferredProvider);

      if (!embeddingResult) {
        throw new SearchError(
          SearchErrorType.EMBEDDING_GENERATION_FAILED,
          '임베딩 생성에 실패했습니다',
          undefined,
          { query, searchId, preferredProvider }
        );
      }

      const actualProvider = (embeddingResult.provider || preferredProvider) as EmbeddingProvider;
      const embeddingTime = Number(process.hrtime.bigint() - embeddingStart) / 1_000_000;

      this.searchLogger.logSearchStep(searchId, '임베딩 생성 완료', {
        embeddingTime: `${embeddingTime.toFixed(2)}ms`,
        vectorLength: embeddingResult.embedding.length,
        provider: actualProvider,
      });

      return { embedding: embeddingResult.embedding, actualProvider };
    } catch (error) {
      if (error instanceof SearchError) {
        throw error;
      }

      throw new SearchError(
        SearchErrorType.EMBEDDING_GENERATION_FAILED,
        `임베딩 생성 중 오류가 발생했습니다 (provider: ${preferredProvider})`,
        error instanceof Error ? error : new Error(String(error)),
        { query, searchId, preferredProvider }
      );
    }
  }
}

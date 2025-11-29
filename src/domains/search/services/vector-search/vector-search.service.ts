/**
 * 벡터 검색 서비스
 * 단일 책임 원칙(SRP) 적용 - 검색 기능만 담당
 */

import type { 
  VectorSearchQuery, 
  VectorSearchResult, 
  VectorSearchOptions,
  ProviderHybridQuery,
  ProviderHybridResult,
  UnifiedSearchResponse
} from '../../../shared/types/vector-search.types.js';
import type { VectorSearchRepository } from '../../../shared/interfaces/database.interface.js';
import { VECTOR_SEARCH_CONFIG } from '../../../../shared/config/vector-search.config';
import { UnifiedEmbeddingService } from '../unified-embedding-service.js';
import type { EmbeddingProvider } from '../../../../shared/types/embedding.types.js';
import { vectorSearchResultNormalizer } from './vector-search-result-normalizer.js';

export class VectorSearchService {
  constructor(
    private repository: VectorSearchRepository,
    private config = VECTOR_SEARCH_CONFIG
  ) {}

  /**
   * 벡터 검색 실행
   */
  async search(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    this.validateQuery(query);
    
    try {
      return await this.repository.search(query);
    } catch (error) {
      throw new Error(`벡터 검색 실패: ${error}`);
    }
  }

  /**
   * 하이브리드 검색 실행
   */
  async hybridSearch(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    this.validateQuery(query);
    
    try {
      return await this.repository.hybridSearch(query);
    } catch (error) {
      throw new Error(`하이브리드 검색 실패: ${error}`);
    }
  }

  async providerHybridSearch(
    embeddingService: UnifiedEmbeddingService,
    baseQuery: ProviderHybridQuery
  ): Promise<ProviderHybridResult[]> {
    this.validateProviderHybridQuery(baseQuery);

    const providers = new Set<EmbeddingProvider>();
    if (baseQuery.overrideProviders && baseQuery.overrideProviders.length > 0) {
      baseQuery.overrideProviders.forEach(provider => providers.add(provider));
    } else if (baseQuery.useAvailableProviders) {
      embeddingService.getAvailableProviders().forEach(provider => providers.add(provider as EmbeddingProvider));
    } else if (baseQuery.query.provider) {
      providers.add(baseQuery.query.provider as EmbeddingProvider);
    }

    if (providers.size === 0) {
      providers.add('minilm');
    }

    const results: ProviderHybridResult[] = [];

    for (const provider of providers) {
      let providerVector = baseQuery.query.queryVector;
      if (baseQuery.text) {
        const embedding = await embeddingService.generateEmbedding(baseQuery.text, provider);
        if (!embedding || !embedding.embedding) {
          continue;
        }
        providerVector = embedding.embedding;
      }

      if (!providerVector || providerVector.length === 0) {
        continue;
      }

      const expectedDimensions = this.getExpectedDimensions(provider);
      if (providerVector.length !== expectedDimensions) {
        continue;
      }

      const providerOptions: VectorSearchOptions = {
        ...baseQuery.query.options,
        limit: baseQuery.query.options.limit ?? this.config.defaultLimit,
        threshold: baseQuery.query.options.threshold ?? this.config.defaultThreshold
      };

      const providerQuery = {
        ...baseQuery.query,
        provider,
        queryVector: providerVector,
        options: providerOptions
      };

      const vectorStart = Date.now();
      const vectorResults = await this.repository.search(providerQuery);
      const vectorLatency = Date.now() - vectorStart;
      const vectorLimit = baseQuery.vectorLimit ?? providerOptions.limit ?? this.config.defaultLimit;
      const topVector = vectorResults.slice(0, vectorLimit);

      let hybridResults: VectorSearchResult[] = [];
      let hybridLatency: number | undefined;
      if (baseQuery.useHybrid === true) {
        const hybridStart = Date.now();
        hybridResults = await this.repository.hybridSearch(providerQuery);
        hybridLatency = Date.now() - hybridStart;
      }

      results.push({
        provider,
        vectorResults: topVector,
        hybridResults,
        vectorLatencyMs: vectorLatency,
        hybridLatencyMs: hybridLatency
      });
    }

    return results;
  }

  async unifiedSearch(
    embeddingService: UnifiedEmbeddingService,
    baseQuery: ProviderHybridQuery
  ): Promise<UnifiedSearchResponse> {
    const providerResults = await this.providerHybridSearch(embeddingService, baseQuery);
    const unified = vectorSearchResultNormalizer.normalize(providerResults);
    return {
      providers: providerResults,
      unified
    };
  }

  /**
   * 검색 쿼리 유효성 검증
   */
  private validateQuery(query: VectorSearchQuery): void {
    const expectedDimensions = this.getExpectedDimensions(query.provider);
    if (!query.queryVector || query.queryVector.length !== expectedDimensions) {
      throw new Error(`벡터 차원 불일치: 예상 ${expectedDimensions}, 실제 ${query.queryVector?.length || 0}`);
    }

    if (query.options.limit && (query.options.limit < 1 || query.options.limit > 100)) {
      throw new Error('검색 제한은 1-100 사이여야 합니다');
    }
  }

  private validateProviderHybridQuery(query: ProviderHybridQuery): void {
    if (!query.query) {
      throw new Error('ProviderHybridQuery.query가 필요합니다');
    }
    this.validateQuery(query.query);
  }

  private getExpectedDimensions(provider?: string): number {
    if (!provider) {
      return this.config.defaultDimensions;
    }
    return this.config.providerDimensions[provider] ?? this.config.defaultDimensions;
  }

  /**
   * 기본 옵션 적용
   */
  applyDefaultOptions(options: VectorSearchOptions): VectorSearchOptions {
    return {
      limit: this.config.defaultLimit,
      threshold: this.config.defaultThreshold,
      includeContent: true,
      includeMetadata: false,
      ...options
    };
  }
}

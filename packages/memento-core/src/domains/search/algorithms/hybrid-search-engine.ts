/**
 * 텍스트 검색과 벡터 검색을 결합하여 검색 정확도와 포괄성을 동시에 확보합니다.
 * 세부 실행, 랭킹 컨텍스트, 보조 구현은 하위 모듈에 둡니다.
 */

import Database from 'better-sqlite3';
import { getRankingWeights } from '../../../shared/config/ranking-weights-loader.js';
import type { EmbeddingProvider, StoredEmbeddingProviderStats } from '../../../shared/types/index.js';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import { MemoryEmbeddingService } from '../../memory/services/memory-embedding-service.js';
import { RelationGraph } from '../../relation/services/relation-graph.js';
import { AdaptiveWeightCalculator } from './adaptive-weight-calculator.js';
import { HybridResultRanker } from './hybrid-result-ranker.js';
import {
  HybridVectorSearchExecutor,
  resolveHybridVectorPrefetchLimit,
  resolveQueryUnifiedEmbeddingForHybridSearch,
} from './hybrid-vector-search-executor.js';
import { ProceduralMemoryMatcher } from './procedural-memory-matcher.js';
import { SearchEngine } from './search-engine.js';
import { SearchError, SearchErrorType } from './search-error.js';
import { SearchLogger } from './search-logger.js';
import { SearchRanking } from './search-ranking.js';
import { SearchResultCombiner } from './search-result-combiner.js';
import { getVectorSearchEngine } from './vector-search-engine.js';
import type {
  HybridSearchQuery,
  HybridSearchResult,
  HybridWeights,
  IAdaptiveWeightCalculator,
  IEmbeddingService,
  IProceduralMemoryMatcher,
  ISearchLogger,
  ISearchResultCombiner,
  ITextSearchEngine,
  IVectorSearchEngine,
} from './hybrid-search-types.js';

export {
  resolveHybridVectorPrefetchLimit,
  resolveQueryUnifiedEmbeddingForHybridSearch,
  SearchError,
  SearchErrorType,
  AdaptiveWeightCalculator,
  SearchLogger,
  SearchResultCombiner,
};

export type {
  HybridSearchQuery,
  HybridSearchResult,
  IAdaptiveWeightCalculator,
  IEmbeddingService,
  IProceduralMemoryMatcher,
  ISearchLogger,
  ISearchResultCombiner,
  ITextSearchEngine,
  IVectorSearchEngine,
  TriggerContext,
} from './hybrid-search-types.js';

export class HybridSearchEngine {
  private readonly defaultVectorWeight = 0.6;
  private readonly defaultTextWeight = 0.4;
  private searchStats: Map<string, { textHits: number; vectorHits: number; totalSearches: number }> = new Map();
  private ranking: SearchRanking;
  private relationGraph: RelationGraph | null = null;
  private proceduralMemoryMatcher: IProceduralMemoryMatcher;
  private vectorExecutor: HybridVectorSearchExecutor;
  private resultRanker: HybridResultRanker;

  constructor(
    private textSearchEngine: ITextSearchEngine,
    private embeddingService: IEmbeddingService,
    private vectorSearchEngine: IVectorSearchEngine,
    private resultCombiner: ISearchResultCombiner,
    private weightCalculator: IAdaptiveWeightCalculator,
    private logger: ISearchLogger,
    private queryEmbeddingService: UnifiedEmbeddingService = new UnifiedEmbeddingService(),
    relationGraph?: RelationGraph,
    proceduralMemoryMatcher?: IProceduralMemoryMatcher,
    rankingWeightsPath?: string
  ) {
    this.proceduralMemoryMatcher = proceduralMemoryMatcher ?? new ProceduralMemoryMatcher();
    const config = getRankingWeights(rankingWeightsPath);
    this.ranking = new SearchRanking({
      relevance: config.ranking_weights.alpha,
      recency: config.ranking_weights.beta,
      importance: config.ranking_weights.gamma,
      usage: config.ranking_weights.delta,
      relation_weight: config.ranking_weights.zeta,
      duplication_penalty: config.ranking_weights.epsilon,
      zeta_fb: config.ranking_weights.zeta_fb ?? 0.05,
    });
    this.relationGraph = relationGraph || null;
    this.vectorExecutor = new HybridVectorSearchExecutor(
      this.embeddingService,
      this.vectorSearchEngine,
      this.queryEmbeddingService,
      this.logger,
      db => this.detectAllStoredEmbeddingProviders(db),
      (query, searchId, preferredProvider) =>
        this.generateQueryVector(query, searchId, preferredProvider)
    );
    this.resultRanker = new HybridResultRanker(
      this.resultCombiner,
      this.ranking,
      this.proceduralMemoryMatcher,
      () => this.relationGraph
    );
  }

  setRelationGraph(relationGraph: RelationGraph | null): void {
    this.relationGraph = relationGraph;
  }

  async search(
    db: Database.Database,
    query: HybridSearchQuery
  ): Promise<{
    items: HybridSearchResult[];
    total_count: number;
    query_time: number;
    text_count?: number;
    vector_count?: number;
    fallback_used?: boolean;
    query_embedding_providers?: EmbeddingProvider[];
    tfidf_query_embedding_fallback?: boolean;
    tfidf_query_embedding_fallback_providers?: EmbeddingProvider[];
  }> {
    const searchId = this.generateSearchId();
    const startTime = process.hrtime.bigint();

    try {
      this.logger.logSearchStart(searchId, query);
      const weights = this.calculateAdaptiveWeights(query);
      this.logger.logSearchStep(searchId, '적응형 가중치 계산 완료', weights);
      this.logRankingExperimentIfApplicable(searchId, query, weights);

      const textResults = await this.executeTextSearch(db, query, searchId);
      const vectorOut = await this.vectorExecutor.execute(db, query, searchId);
      const finalResults = await this.resultRanker.combineAndSortResults(
        textResults,
        vectorOut.results,
        weights,
        query.limit || 10,
        db,
        query.includeRelations || false,
        query
      );

      this.updateSearchStats(query.query, textResults.length, vectorOut.results.length);
      const queryTime = this.calculateQueryTime(startTime);
      const logData: { items: unknown[]; total_count: number; experiment_id?: string } = {
        items: finalResults,
        total_count: finalResults.length,
        ...(query.experiment_id ? { experiment_id: query.experiment_id } : {}),
      };
      this.logger.logSearchComplete(searchId, logData, queryTime);

      return {
        items: finalResults,
        total_count: finalResults.length,
        query_time: queryTime,
        text_count: textResults.length,
        vector_count: vectorOut.results.length,
        fallback_used: vectorOut.fallback_used,
        query_embedding_providers: vectorOut.query_embedding_providers,
        tfidf_query_embedding_fallback: vectorOut.tfidf_query_embedding_fallback,
        tfidf_query_embedding_fallback_providers: vectorOut.tfidf_query_embedding_fallback_providers,
      };
    } catch (error) {
      this.logger.logSearchError(searchId, error, query);
      throw error;
    }
  }

  async getSearchStats(db: Database.Database): Promise<{
    textSearchAvailable: boolean;
    vectorSearchAvailable: boolean;
    embeddingStats: unknown;
    searchStats: Map<string, { textHits: number; vectorHits: number; totalSearches: number }>;
  }> {
    const embeddingStats = await this.embeddingService.getEmbeddingStats(db);

    return {
      textSearchAvailable: true,
      vectorSearchAvailable: this.embeddingService.isAvailable(),
      embeddingStats,
      searchStats: this.searchStats,
    };
  }

  isEmbeddingAvailable(): boolean {
    return this.embeddingService.isAvailable();
  }

  private async executeTextSearch(
    db: Database.Database,
    query: HybridSearchQuery,
    searchId: string
  ): Promise<unknown[]> {
    try {
      const textSearchStart = process.hrtime.bigint();
      this.logger.logSearchStep(searchId, '텍스트 검색 시작', { query: query.query });

      const textSearchResult = await this.textSearchEngine.search(db, {
        query: query.query,
        filters: query.filters,
        limit: (query.limit || 10) * 2,
        omit_feedback_in_ranking: true,
      });

      const textSearchTime = Number(process.hrtime.bigint() - textSearchStart) / 1_000_000;
      this.logger.logSearchStep(searchId, '텍스트 검색 완료', {
        resultCount: textSearchResult.items.length,
        searchTime: `${textSearchTime.toFixed(2)}ms`,
      });

      return textSearchResult.items;
    } catch (error) {
      throw new SearchError(
        SearchErrorType.TEXT_SEARCH_FAILED,
        '텍스트 검색 실행 중 오류가 발생했습니다',
        error instanceof Error ? error : new Error(String(error)),
        { query: query.query, searchId }
      );
    }
  }

  private calculateAdaptiveWeights(query: HybridSearchQuery): HybridWeights & {
    originalVector: number;
    originalText: number;
  } {
    const vectorWeight = query.vectorWeight ?? this.defaultVectorWeight;
    const textWeight = query.textWeight ?? this.defaultTextWeight;
    const adaptiveWeights = this.weightCalculator.calculateWeights(query.query || '', vectorWeight, textWeight);

    return {
      vectorWeight: adaptiveWeights.vectorWeight,
      textWeight: adaptiveWeights.textWeight,
      originalVector: vectorWeight,
      originalText: textWeight,
    };
  }

  private logRankingExperimentIfApplicable(
    searchId: string,
    query: HybridSearchQuery,
    weights: HybridWeights & { originalVector: number; originalText: number }
  ): void {
    if (!query.experiment_id) {
      return;
    }

    const config = getRankingWeights();
    const variant = {
      ranking_weights: {
        alpha: config.ranking_weights.alpha,
        beta: config.ranking_weights.beta,
        gamma: config.ranking_weights.gamma,
        delta: config.ranking_weights.delta,
        zeta: config.ranking_weights.zeta,
        epsilon: config.ranking_weights.epsilon,
      },
      adaptive_weights: {
        vectorWeight: weights.vectorWeight,
        textWeight: weights.textWeight,
      },
      relation_weights: {
        max_relations: config.relation_weights.max_relations,
      },
    };

    if (this.logger.logExperiment) {
      this.logger.logExperiment(searchId, query.experiment_id, variant);
    } else {
      this.logger.logSearchStep(searchId, '실험 파라미터', {
        experiment_id: query.experiment_id,
        variant,
      });
    }
  }

  private async detectAllStoredEmbeddingProviders(
    db: Database.Database
  ): Promise<StoredEmbeddingProviderStats[]> {
    return this.vectorExecutor.detectAllStoredEmbeddingProviders(db);
  }

  private async generateQueryVector(
    query: string,
    searchId: string,
    preferredProvider: EmbeddingProvider
  ): Promise<{ embedding: number[]; actualProvider: EmbeddingProvider }> {
    return this.vectorExecutor.generateQueryVector(query, searchId, preferredProvider);
  }

  private updateSearchStats(query: string, textHits: number, vectorHits: number): void {
    const queryKey = this.normalizeQuery(query);
    const stats = this.searchStats.get(queryKey) || { textHits: 0, vectorHits: 0, totalSearches: 0 };

    stats.textHits += textHits;
    stats.vectorHits += vectorHits;
    stats.totalSearches += 1;

    this.searchStats.set(queryKey, stats);
  }

  private normalizeQuery(query: string): string {
    if (!query) {
      return '';
    }
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  private calculateQueryTime(startTime: bigint): number {
    return Number(process.hrtime.bigint() - startTime) / 1_000_000;
  }

  private generateSearchId(): string {
    return `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export function createHybridSearchEngine(
  textSearchEngine?: ITextSearchEngine,
  embeddingService?: IEmbeddingService,
  vectorSearchEngine?: IVectorSearchEngine,
  resultCombiner?: ISearchResultCombiner,
  weightCalculator?: IAdaptiveWeightCalculator,
  logger?: ISearchLogger
): HybridSearchEngine {
  const memEmb = embeddingService ?? new MemoryEmbeddingService();
  const queryUnified = resolveQueryUnifiedEmbeddingForHybridSearch(memEmb);
  return new HybridSearchEngine(
    textSearchEngine ?? new SearchEngine(),
    memEmb,
    vectorSearchEngine ?? getVectorSearchEngine(),
    resultCombiner ?? new SearchResultCombiner(),
    weightCalculator ?? new AdaptiveWeightCalculator(),
    logger ?? new SearchLogger(),
    queryUnified
  );
}

let hybridSearchEngineInstance: HybridSearchEngine | null = null;

export function getHybridSearchEngine(): HybridSearchEngine {
  if (!hybridSearchEngineInstance) {
    hybridSearchEngineInstance = createHybridSearchEngine();
  }
  return hybridSearchEngineInstance;
}

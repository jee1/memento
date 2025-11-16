/**
 * 하이브리드 검색 엔진
 * FTS5 텍스트 검색 + 벡터 검색 결합
 */

import { SearchEngine } from './search-engine.js';
import { MemoryEmbeddingService, type VectorSearchResult } from '../services/memory-embedding-service.js';
import { UnifiedEmbeddingService } from '../services/unified-embedding-service.js';
import { getVectorSearchEngine } from './vector-search-engine.js';
import type { MemorySearchFilters, MemoryType } from '../types/index.js';
import Database from 'better-sqlite3';
import { SearchRanking } from './search-ranking.js';
import { mementoConfig } from '../config/index.js';
import { RelationGraph } from '../services/relation-graph.js';
import { getRankingWeights } from '../config/ranking-weights-loader.js';

// 인터페이스 정의
export interface ITextSearchEngine {
  search(db: Database.Database, query: { query: string; filters?: MemorySearchFilters; limit?: number }): Promise<{ items: any[]; total_count: number; query_time: number }>;
}

export interface IEmbeddingService {
  isAvailable(): boolean;
  searchBySimilarity(db: Database.Database, query: string, options: { type?: MemoryType[]; limit?: number; threshold?: number }): Promise<VectorSearchResult[]>;
  getEmbeddingStats(db: Database.Database): Promise<any>;
}

export interface IVectorSearchEngine {
  initialize(db: Database.Database): void;
  getIndexStatus(): { available: boolean };
  search(vector: number[], options: { limit?: number; threshold?: number; types?: MemoryType[]; includeContent?: boolean }, provider?: string): Promise<Array<{ memory_id: string; content: string; type: string; importance: number; created_at: string; similarity: number }>>;
}

export interface ISearchResultCombiner {
  combine(textResults: any[], vectorResults: VectorSearchResult[], textWeight: number, vectorWeight: number): HybridSearchResult[];
}

export interface IAdaptiveWeightCalculator {
  calculateWeights(query: string, vectorWeight: number, textWeight: number): { vectorWeight: number; textWeight: number };
}

export interface ISearchLogger {
  logSearchStart(searchId: string, query: HybridSearchQuery): void;
  logSearchStep(searchId: string, step: string, data: any): void;
  logSearchComplete(searchId: string, result: { items: unknown[]; total_count: number }, queryTime: number): void;
  logSearchError(searchId: string, error: unknown, query: HybridSearchQuery): void;
  logExperiment?(searchId: string, experimentId: string, variant: Record<string, any>): void; // 실험 로그 (선택적)
}

// 에러 타입 정의
export enum SearchErrorType {
  EMBEDDING_GENERATION_FAILED = 'EMBEDDING_GENERATION_FAILED',
  VECTOR_SEARCH_FAILED = 'VECTOR_SEARCH_FAILED',
  TEXT_SEARCH_FAILED = 'TEXT_SEARCH_FAILED',
  RESULT_COMBINATION_FAILED = 'RESULT_COMBINATION_FAILED',
  DATABASE_CONNECTION_FAILED = 'DATABASE_CONNECTION_FAILED',
  INVALID_QUERY = 'INVALID_QUERY',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE'
}

export class SearchError extends Error {
  constructor(
    public type: SearchErrorType,
    message: string,
    public originalError?: Error,
    public context?: any
  ) {
    super(message);
    this.name = 'SearchError';
  }
}

// 책임별 클래스들
export class SearchResultCombiner implements ISearchResultCombiner {
  combine(textResults: any[], vectorResults: VectorSearchResult[], textWeight: number, vectorWeight: number): HybridSearchResult[] {
    const resultMap = new Map<string, HybridSearchResult>();

    // 텍스트 검색 결과 추가
    textResults.forEach(result => {
      const textScore = typeof result.score === 'number' ? result.score : 0;
      resultMap.set(result.id, {
        id: result.id,
        content: result.content,
        type: result.type,
        importance: result.importance,
        created_at: result.created_at,
        last_accessed: result.last_accessed,
        pinned: result.pinned,
        tags: result.tags,
        textScore: textScore,
        vectorScore: 0,
        finalScore: textScore * textWeight,
        recall_reason: result.recall_reason || '텍스트 검색 결과',
      });
    });

    // 벡터 검색 결과 추가/업데이트
    vectorResults.forEach(result => {
      const existing = resultMap.get(result.id);
      
      if (existing) {
        // 기존 결과 업데이트
        existing.vectorScore = result.similarity;
        existing.finalScore = (existing.textScore * textWeight) + (result.similarity * vectorWeight);
        existing.recall_reason = this.generateHybridReason(existing.textScore, result.similarity);
      } else {
        // 새로운 결과 추가
        resultMap.set(result.id, {
          id: result.id,
          content: result.content,
          type: result.type,
          importance: result.importance,
          created_at: result.created_at,
          last_accessed: result.last_accessed,
          pinned: result.pinned,
          tags: result.tags,
          textScore: 0,
          vectorScore: result.similarity,
          finalScore: result.similarity * vectorWeight,
          recall_reason: `벡터 유사도: ${result.similarity.toFixed(3)}`,
        });
      }
    });

    return Array.from(resultMap.values());
  }

  private generateHybridReason(textScore: number, vectorScore: number): string {
    const reasons: string[] = [];
    
    if (textScore > 0.7) {
      reasons.push('텍스트 매칭 우수');
    }
    if (vectorScore > 0.8) {
      reasons.push('의미적 유사도 높음');
    }
    if (textScore > 0.5 && vectorScore > 0.5) {
      reasons.push('텍스트+벡터 결합');
    }
    
    return reasons.length > 0 ? reasons.join(', ') : '하이브리드 검색';
  }
}

export class AdaptiveWeightCalculator implements IAdaptiveWeightCalculator {
  private adaptiveWeights: Map<string, { vectorWeight: number, textWeight: number }> = new Map();

  calculateWeights(query: string, vectorWeight: number, textWeight: number): { vectorWeight: number, textWeight: number } {
    const queryKey = this.normalizeQuery(query);
    
    // 기존 적응형 가중치가 있으면 사용
    if (this.adaptiveWeights.has(queryKey)) {
      return this.adaptiveWeights.get(queryKey)!;
    }

    // 쿼리 특성 분석
    const queryAnalysis = this.analyzeQuery(query);
    
    // 쿼리 특성에 따른 가중치 조정
    let adjustedVectorWeight = vectorWeight;
    let adjustedTextWeight = textWeight;

    if (queryAnalysis.isTechnicalTerm) {
      // 기술 용어는 벡터 검색에 더 의존
      adjustedVectorWeight = Math.min(0.8, vectorWeight + 0.2);
      adjustedTextWeight = Math.max(0.2, textWeight - 0.2);
    } else if (queryAnalysis.isPhrase) {
      // 구문 검색은 텍스트 검색에 더 의존
      adjustedVectorWeight = Math.max(0.2, vectorWeight - 0.2);
      adjustedTextWeight = Math.min(0.8, textWeight + 0.2);
    } else if (queryAnalysis.isShortQuery) {
      // 짧은 쿼리는 벡터 검색에 더 의존
      adjustedVectorWeight = Math.min(0.7, vectorWeight + 0.1);
      adjustedTextWeight = Math.max(0.3, textWeight - 0.1);
    }

    // 가중치 정규화
    const totalWeight = adjustedVectorWeight + adjustedTextWeight;
    const normalizedVectorWeight = adjustedVectorWeight / totalWeight;
    const normalizedTextWeight = adjustedTextWeight / totalWeight;

    const weights = { vectorWeight: normalizedVectorWeight, textWeight: normalizedTextWeight };
    this.adaptiveWeights.set(queryKey, weights);
    
    return weights;
  }

  private analyzeQuery(query: string): { isTechnicalTerm: boolean, isPhrase: boolean, isShortQuery: boolean } {
    const normalizedQuery = query.toLowerCase().trim();
    
    return {
      isTechnicalTerm: /^(api|sql|http|json|xml|css|html|js|ts|react|vue|angular|node|python|java|c\+\+|go|rust|docker|kubernetes|aws|azure|gcp)$/i.test(normalizedQuery),
      isPhrase: normalizedQuery.includes(' ') && normalizedQuery.split(' ').length >= 3,
      isShortQuery: normalizedQuery.length <= 10
    };
  }

  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }
}

export class SearchLogger implements ISearchLogger {
  logSearchStart(searchId: string, query: HybridSearchQuery): void {
    // console.log(`🔍 [${searchId}] 하이브리드 검색 시작`, {
    //   query: query.query,
    //   limit: query.limit,
    //   vectorWeight: query.vectorWeight,
    //   textWeight: query.textWeight,
    //   filters: query.filters,
    //   experiment_id: query.experiment_id
    // });
  }

  logSearchStep(searchId: string, step: string, data: any): void {
    console.log(`🔍 [${searchId}] ${step}`, data);
  }

  logSearchComplete(searchId: string, result: { items: unknown[]; total_count: number }, queryTime: number): void {
    // console.log(`✅ [${searchId}] 하이브리드 검색 완료`, {
    //   resultCount: result.items.length,
    //   totalCount: result.total_count,
    //   queryTime: `${queryTime.toFixed(2)}ms`,
    //   searchType: 'hybrid',
    //   experiment_id: (result as any).experiment_id
    // });
  }

  logSearchError(searchId: string, error: unknown, query: HybridSearchQuery): void {
    // console.error(`❌ [${searchId}] 하이브리드 검색 에러`, {
    //   error: error instanceof Error ? error.message : String(error),
    //   stack: error instanceof Error ? error.stack : undefined,
    //   query: query.query,
    //   limit: query.limit,
    //   experiment_id: query.experiment_id
    // });
  }

  /**
   * 실험 로그 기록
   * A/B 테스트를 위한 실험 ID와 변이 파라미터를 로깅합니다.
   */
  logExperiment(searchId: string, experimentId: string, variant: Record<string, any>): void {
    // console.log(`🧪 [${searchId}] 실험 로그`, {
    //   experiment_id: experimentId,
    //   variant,
    //   timestamp: new Date().toISOString()
    // });
  }
}

export interface HybridSearchQuery {
  query: string;
  filters?: MemorySearchFilters | undefined;
  limit?: number | undefined;
  vectorWeight?: number | undefined; // 벡터 검색 가중치 (0.0 ~ 1.0)
  textWeight?: number | undefined;   // 텍스트 검색 가중치 (0.0 ~ 1.0)
  includeRelations?: boolean; // 관계 정보 포함 여부 (기본값: false)
  experiment_id?: string; // 실험 ID (A/B 테스트용)
}

export interface HybridSearchResult {
  id: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed?: string | undefined;
  pinned: boolean;
  tags?: string[] | undefined;
  textScore: number;
  vectorScore: number;
  finalScore: number;
  recall_reason: string;
  consolidation_score?: number; // Consolidation Score (선택적)
  relation_weight?: number; // 관계 가중치 (관계 그래프 기반)
  relations?: Array<{ // 관계 정보 (선택적)
    target_id: string;
    relation_type: string;
    confidence: number;
  }>;
}

export class HybridSearchEngine {
  private readonly defaultVectorWeight = 0.6; // 벡터 검색 60%
  private readonly defaultTextWeight = 0.4;   // 텍스트 검색 40%
  private searchStats: Map<string, { textHits: number, vectorHits: number, totalSearches: number }> = new Map();
  private ranking: SearchRanking;
  private relationGraph: RelationGraph | null = null;

  constructor(
    private textSearchEngine: ITextSearchEngine,
    private embeddingService: IEmbeddingService,
    private vectorSearchEngine: IVectorSearchEngine,
    private resultCombiner: ISearchResultCombiner,
    private weightCalculator: IAdaptiveWeightCalculator,
    private logger: ISearchLogger,
    private queryEmbeddingService: UnifiedEmbeddingService = new UnifiedEmbeddingService(),
    relationGraph?: RelationGraph
  ) {
    // TOML 설정에서 가중치 로드
    const config = getRankingWeights();
    this.ranking = new SearchRanking({
      relevance: config.ranking_weights.alpha,
      recency: config.ranking_weights.beta,
      importance: config.ranking_weights.gamma,
      usage: config.ranking_weights.delta,
      relation_weight: config.ranking_weights.zeta,
      duplication_penalty: config.ranking_weights.epsilon
    });
    this.relationGraph = relationGraph || null;
  }

  /**
   * RelationGraph 설정 (선택적)
   */
  setRelationGraph(relationGraph: RelationGraph): void {
    this.relationGraph = relationGraph;
  }

  /**
   * 하이브리드 검색 실행 - 적응형 가중치 적용
   */
  async search(
    db: Database.Database,
    query: HybridSearchQuery
  ): Promise<{ items: HybridSearchResult[], total_count: number, query_time: number }> {
    const searchId = this.generateSearchId();
    const startTime = process.hrtime.bigint();
    
    try {
      this.logger.logSearchStart(searchId, query);
      
      // 1. 적응형 가중치 계산
      const weights = this.calculateAdaptiveWeights(query);
      this.logger.logSearchStep(searchId, '적응형 가중치 계산 완료', weights);

      // 실험 로그 (experiment_id가 있는 경우)
      if (query.experiment_id) {
        const config = getRankingWeights();
        const variant = {
          ranking_weights: {
            alpha: config.ranking_weights.alpha,
            beta: config.ranking_weights.beta,
            gamma: config.ranking_weights.gamma,
            delta: config.ranking_weights.delta,
            zeta: config.ranking_weights.zeta,
            epsilon: config.ranking_weights.epsilon
          },
          adaptive_weights: {
            vectorWeight: weights.vectorWeight,
            textWeight: weights.textWeight
          },
          relation_weights: {
            max_relations: config.relation_weights.max_relations
          }
        };
        
        if (this.logger.logExperiment) {
          this.logger.logExperiment(searchId, query.experiment_id, variant);
        } else {
          // logExperiment가 없으면 logSearchStep으로 대체
          this.logger.logSearchStep(searchId, '실험 파라미터', {
            experiment_id: query.experiment_id,
            variant
          });
        }
      }

      // 2. 텍스트 검색 실행
      const textResults = await this.executeTextSearch(db, query, searchId);

      // 3. 벡터 검색 실행
      const vectorResults = await this.executeVectorSearch(db, query, searchId);

      // 4. 결과 결합 및 정렬 (데이터베이스 전달하여 consolidation_score 및 관계 가중치 조회)
      const finalResults = await this.combineAndSortResults(
        textResults, 
        vectorResults, 
        weights, 
        query.limit || 10, 
        db,
        query.includeRelations || false
      );

      // 5. 통계 업데이트 및 결과 반환
      this.updateSearchStats(query.query, textResults.length, vectorResults.length);
      
      const queryTime = this.calculateQueryTime(startTime);
      
      // 검색 완료 로그에 실험 ID 포함
      const logData: any = {
        items: finalResults,
        total_count: finalResults.length
      };
      
      if (query.experiment_id) {
        logData.experiment_id = query.experiment_id;
      }
      
      this.logger.logSearchComplete(searchId, logData, queryTime);

      return {
        items: finalResults,
        total_count: finalResults.length,
        query_time: queryTime
      };
    } catch (error) {
      this.logger.logSearchError(searchId, error, query);
      throw error;
    }
  }

  private generateSearchId(): string {
    return `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateAdaptiveWeights(query: HybridSearchQuery): { vectorWeight: number, textWeight: number, originalVector: number, originalText: number } {
    const vectorWeight = query.vectorWeight ?? this.defaultVectorWeight;
    const textWeight = query.textWeight ?? this.defaultTextWeight;
    
    const adaptiveWeights = this.weightCalculator.calculateWeights(query.query, vectorWeight, textWeight);
    
    return {
      vectorWeight: adaptiveWeights.vectorWeight,
      textWeight: adaptiveWeights.textWeight,
      originalVector: vectorWeight,
      originalText: textWeight
    };
  }

  private async executeTextSearch(db: Database.Database, query: HybridSearchQuery, searchId: string): Promise<any[]> {
    try {
      const textSearchStart = process.hrtime.bigint();
      this.logger.logSearchStep(searchId, '텍스트 검색 시작', { query: query.query });
      
      const textSearchResult = await this.textSearchEngine.search(db, {
        query: query.query,
        filters: query.filters,
        limit: (query.limit || 10) * 2,
      });
      
      const textSearchTime = Number(process.hrtime.bigint() - textSearchStart) / 1_000_000;
      this.logger.logSearchStep(searchId, '텍스트 검색 완료', {
        resultCount: textSearchResult.items.length,
        searchTime: `${textSearchTime.toFixed(2)}ms`
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

  private async executeVectorSearch(db: Database.Database, query: HybridSearchQuery, searchId: string): Promise<VectorSearchResult[]> {
    const vectorSearchStart = process.hrtime.bigint();
    this.logger.logSearchStep(searchId, '벡터 검색 시작', { 
      query: query.query,
      embeddingAvailable: this.embeddingService.isAvailable()
    });
    
    this.vectorSearchEngine.initialize(db);
    
    if (this.vectorSearchEngine.getIndexStatus().available) {
      return await this.executeVecSearch(db, query, searchId, vectorSearchStart);
    } else {
      return await this.executeFallbackSearch(db, query, searchId, vectorSearchStart);
    }
  }

  private async executeVecSearch(db: Database.Database, query: HybridSearchQuery, searchId: string, startTime: bigint): Promise<VectorSearchResult[]> {
    try {
      // 저장된 임베딩의 provider와 차원을 확인하여 동일한 provider로 쿼리 임베딩 생성
      const detectedProvider = await this.detectStoredEmbeddingProvider(db);
      const queryVector = await this.generateQueryVector(query.query, searchId, detectedProvider);
      const vecResults = await this.vectorSearchEngine.search(queryVector, {
        limit: (query.limit || 10) * 2,
        threshold: 0.5,
        types: query.filters?.type,
        includeContent: true
      }, detectedProvider);
      
      const vectorResults = vecResults.map(result => ({
        id: result.memory_id,
        content: result.content,
        type: result.type,
        importance: result.importance,
        created_at: result.created_at,
        pinned: false,
        score: result.similarity,
        similarity: result.similarity
      }));
      
      this.logger.logSearchStep(searchId, 'VEC 벡터 검색 완료', {
        resultCount: vectorResults.length,
        totalVectorTime: `${(Number(process.hrtime.bigint() - startTime) / 1_000_000).toFixed(2)}ms`
      });
      
      return vectorResults;
    } catch (error) {
      this.logger.logSearchStep(searchId, 'VEC 벡터 검색 실패, fallback 사용', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return await this.executeFallbackSearch(db, query, searchId, startTime);
    }
  }

  private async executeFallbackSearch(db: Database.Database, query: HybridSearchQuery, searchId: string, startTime: bigint): Promise<VectorSearchResult[]> {
    if (!this.embeddingService.isAvailable()) {
      this.logger.logSearchStep(searchId, '임베딩 서비스 사용 불가', {});
      return [];
    }
    
    const fallbackStart = process.hrtime.bigint();
    const vectorResults = await this.embeddingService.searchBySimilarity(db, query.query, {
      type: query.filters?.type as MemoryType[],
      limit: (query.limit || 10) * 2,
      threshold: 0.5,
    });
    const fallbackTime = Number(process.hrtime.bigint() - fallbackStart) / 1_000_000;
    
    this.logger.logSearchStep(searchId, 'Fallback 벡터 검색 완료', {
      resultCount: vectorResults.length,
      fallbackTime: `${fallbackTime.toFixed(2)}ms`
    });
    
    return vectorResults;
  }

  /**
   * 저장된 임베딩의 provider 감지
   * 가장 많이 사용된 provider를 반환 (기본값: 'minilm')
   */
  private async detectStoredEmbeddingProvider(db: Database.Database): Promise<string> {
    try {
      const providerStats = db.prepare(`
        SELECT 
          embedding_provider as provider,
          COUNT(*) as count,
          AVG(dimensions) as avg_dimensions
        FROM memory_embedding
        WHERE embedding_provider IS NOT NULL
          AND embedding_provider != ''
          AND dimensions IS NOT NULL
        GROUP BY embedding_provider
        ORDER BY count DESC
        LIMIT 1
      `).get() as { provider: string; count: number; avg_dimensions: number } | undefined;

      if (providerStats && providerStats.provider) {
        const provider = providerStats.provider.toLowerCase();
        this.logger.logSearchStep('', '저장된 임베딩 provider 감지', {
          provider,
          count: providerStats.count,
          dimensions: Math.round(providerStats.avg_dimensions || 0)
        });
        return provider;
      }
    } catch (error) {
      console.warn('⚠️ 저장된 임베딩 provider 감지 실패:', error);
    }

    // 기본값: minilm (가장 많이 사용되는 provider)
    return 'minilm';
  }

  private async generateQueryVector(query: string, searchId: string, preferredProvider?: string): Promise<number[]> {
    try {
      const embeddingStart = process.hrtime.bigint();
      
      // preferredProvider가 있으면 해당 provider로 임베딩 생성 시도
      let embeddingResult;
      if (preferredProvider) {
        try {
          embeddingResult = await this.queryEmbeddingService.generateEmbedding(query, preferredProvider as any);
        } catch (error) {
          // preferred provider 실패 시 fallback
          console.warn(`⚠️ Preferred provider '${preferredProvider}' 실패, fallback 시도:`, error);
          embeddingResult = await this.queryEmbeddingService.generateEmbedding(query);
        }
      } else {
        embeddingResult = await this.queryEmbeddingService.generateEmbedding(query);
      }
      
      if (!embeddingResult) {
        throw new SearchError(
          SearchErrorType.EMBEDDING_GENERATION_FAILED,
          '임베딩 생성에 실패했습니다',
          undefined,
          { query, searchId }
        );
      }
      
      const embeddingTime = Number(process.hrtime.bigint() - embeddingStart) / 1_000_000;
      
      this.logger.logSearchStep(searchId, '임베딩 생성 완료', {
        embeddingTime: `${embeddingTime.toFixed(2)}ms`,
        vectorLength: embeddingResult.embedding.length,
        provider: embeddingResult.provider || 'unknown'
      });
      
      return embeddingResult.embedding;
    } catch (error) {
      if (error instanceof SearchError) {
        throw error;
      }
      
      throw new SearchError(
        SearchErrorType.EMBEDDING_GENERATION_FAILED,
        '임베딩 생성 중 오류가 발생했습니다',
        error instanceof Error ? error : new Error(String(error)),
        { query, searchId }
      );
    }
  }

  private async combineAndSortResults(
    textResults: any[], 
    vectorResults: VectorSearchResult[], 
    weights: any, 
    limit: number,
    db?: Database.Database,
    includeRelations: boolean = false
  ): Promise<HybridSearchResult[]> {
    try {
      const combinedResults = this.resultCombiner.combine(
        textResults,
        vectorResults,
        weights.textWeight,
        weights.vectorWeight
      );
      
      // 관계 가중치 및 Consolidation Score 계산
      if (db) {
        const memoryIds = combinedResults.map(r => r.id);
        if (memoryIds.length > 0) {
          // 관계 가중치 및 관계 정보 계산
          const relationData = await this.fetchRelationWeights(db, memoryIds);
          const relationWeights = relationData.weights;
          const relationInfo = relationData.relations;
          
          // Consolidation Score 조회 (활성화된 경우)
          let consolidationScores: Map<string, number> = new Map();
          if (mementoConfig.consolidationScoreEnabled) {
            consolidationScores = this.fetchConsolidationScores(db, memoryIds);
          }
          
          // 각 결과에 대해 finalScore 재계산
          combinedResults.forEach(result => {
            const relationWeight = relationWeights.get(result.id);
            
            // relationGraph가 있고 관계가 있는 경우에만 relation_weight 설정
            if (relationWeight !== undefined && relationWeight > 0) {
              result.relation_weight = relationWeight;
            }
            
            // 관계 정보 포함 (선택적, includeRelations 옵션이 true인 경우만)
            if (includeRelations) {
              const relations = relationInfo.get(result.id);
              if (relations && relations.length > 0) {
                result.relations = relations.map(r => ({
                  target_id: r.target_id,
                  relation_type: r.relation_type,
                  confidence: r.confidence
                }));
              }
            }
            
            const consolidationScore = consolidationScores.get(result.id);
            
            if (consolidationScore !== undefined) {
              // Consolidation Score가 있으면 기존 로직 사용
              result.consolidation_score = consolidationScore;
              const vectorSimilarity = result.vectorScore;
              result.finalScore = this.ranking.calculateFinalScoreWithConsolidation(
                vectorSimilarity,
                consolidationScore,
                'balanced'
              );
            } else {
              // 관계 가중치를 포함한 finalScore 재계산
              // SearchFeatures 구성
              const features = {
                relevance: result.vectorScore || result.textScore || 0,
                recency: this.calculateRecency(result.created_at),
                importance: result.importance || 0.5,
                usage: this.calculateUsage(result.last_accessed),
                relation_weight: relationWeight || 0, // relationWeight가 undefined면 0 사용
                duplication_penalty: 0 // 중복 패널티는 이미 결과 결합 시 처리됨
              };
              
              result.finalScore = this.ranking.calculateFinalScore(features);
            }
          });
        }
      }
      
      return combinedResults
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, limit);
    } catch (error) {
      throw new SearchError(
        SearchErrorType.RESULT_COMBINATION_FAILED,
        '결과 결합 중 오류가 발생했습니다',
        error instanceof Error ? error : new Error(String(error)),
        { textResultsCount: textResults.length, vectorResultsCount: vectorResults.length, weights }
      );
    }
  }

  /**
   * 데이터베이스에서 consolidation_score 조회
   */
  private fetchConsolidationScores(db: Database.Database, memoryIds: string[]): Map<string, number> {
    const scores = new Map<string, number>();
    
    if (memoryIds.length === 0) {
      return scores;
    }
    
    try {
      const placeholders = memoryIds.map(() => '?').join(',');
      const sql = `SELECT id, consolidation_score FROM memory_item WHERE id IN (${placeholders})`;
      const results = db.prepare(sql).all(...memoryIds) as Array<{ id: string; consolidation_score: number | null }>;
      
      results.forEach(row => {
        if (row.consolidation_score !== null && row.consolidation_score !== undefined) {
          scores.set(row.id, Number(row.consolidation_score));
        }
      });
    } catch (error) {
      // 에러 발생 시 빈 Map 반환 (기존 finalScore 유지)
      console.warn('⚠️ Consolidation Score 조회 실패:', error);
    }
    
    return scores;
  }

  /**
   * 관계 가중치 계산 및 조회
   * 관계 정보도 함께 반환 (선택적)
   */
  private async fetchRelationWeights(
    db: Database.Database, 
    memoryIds: string[]
  ): Promise<{
    weights: Map<string, number>;
    relations: Map<string, Array<{ target_id: string; relation_type: string; confidence: number }>>;
  }> {
    const weights = new Map<string, number>();
    const relations = new Map<string, Array<{ target_id: string; relation_type: string; confidence: number }>>();
    
    if (memoryIds.length === 0 || !this.relationGraph) {
      return { weights, relations };
    }
    
    try {
      const config = getRankingWeights();
      const maxRelations = config.relation_weights.max_relations;
      
      // 각 메모리에 대해 관계 조회 및 가중치 계산
      for (const memoryId of memoryIds) {
        const memoryRelations = await this.relationGraph.getRelations(memoryId, {
          direction: 'both',
          minConfidence: 0.5 // 최소 신뢰도 필터
        });
        
        if (memoryRelations.length > 0) {
          // 관계 가중치 계산
          const relationData = memoryRelations.map(r => ({
            confidence: r.confidence,
            relation_type: r.relation_type
          }));
          
          const relationWeight = this.ranking.calculateRelationWeight(relationData, maxRelations);
          weights.set(memoryId, relationWeight);
          
          // 관계 정보 저장 (간단한 형태로 변환)
          const simplifiedRelations = memoryRelations.map(r => ({
            target_id: r.source_id === memoryId ? r.target_id : r.source_id,
            relation_type: r.relation_type,
            confidence: r.confidence
          }));
          
          relations.set(memoryId, simplifiedRelations);
        }
      }
    } catch (error) {
      // 에러 발생 시 빈 Map 반환 (관계 가중치 없이 진행)
      console.warn('⚠️ 관계 가중치 계산 실패:', error);
    }
    
    return { weights, relations };
  }

  /**
   * 최근성 점수 계산 (간단한 구현)
   */
  private calculateRecency(createdAt: string | Date | undefined): number {
    if (!createdAt) return 0.5;
    
    const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
    const ageDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
    
    // 30일 반감기
    return Math.exp(-Math.log(2) * ageDays / 30);
  }

  /**
   * 사용성 점수 계산 (간단한 구현)
   */
  private calculateUsage(lastAccessed: string | Date | undefined): number {
    if (!lastAccessed) return 0.1;
    
    const accessed = typeof lastAccessed === 'string' ? new Date(lastAccessed) : lastAccessed;
    const daysSinceAccess = (Date.now() - accessed.getTime()) / (1000 * 60 * 60 * 24);
    
    return Math.exp(-daysSinceAccess / 30);
  }

  private calculateQueryTime(startTime: bigint): number {
    const endTime = process.hrtime.bigint();
    return Number(endTime - startTime) / 1_000_000;
  }


  /**
   * 검색 통계 업데이트
   */
  private updateSearchStats(query: string, textHits: number, vectorHits: number): void {
    const queryKey = this.normalizeQuery(query);
    const stats = this.searchStats.get(queryKey) || { textHits: 0, vectorHits: 0, totalSearches: 0 };
    
    stats.textHits += textHits;
    stats.vectorHits += vectorHits;
    stats.totalSearches += 1;
    
    this.searchStats.set(queryKey, stats);
  }

  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * 검색 통계 정보
   */
  async getSearchStats(db: any): Promise<{
    textSearchAvailable: boolean;
    vectorSearchAvailable: boolean;
    embeddingStats: any;
    searchStats: Map<string, { textHits: number, vectorHits: number, totalSearches: number }>;
  }> {
    const embeddingStats = await this.embeddingService.getEmbeddingStats(db);
    
    return {
      textSearchAvailable: true,
      vectorSearchAvailable: this.embeddingService.isAvailable(),
      embeddingStats,
      searchStats: this.searchStats,
    };
  }

  /**
   * 임베딩 서비스 사용 가능 여부 확인
   */
  isEmbeddingAvailable(): boolean {
    return this.embeddingService.isAvailable();
  }
}

// 팩토리 함수들
export function createHybridSearchEngine(
  textSearchEngine?: ITextSearchEngine,
  embeddingService?: IEmbeddingService,
  vectorSearchEngine?: IVectorSearchEngine,
  resultCombiner?: ISearchResultCombiner,
  weightCalculator?: IAdaptiveWeightCalculator,
  logger?: ISearchLogger
): HybridSearchEngine {
  return new HybridSearchEngine(
    textSearchEngine ?? new SearchEngine(),
    embeddingService ?? new MemoryEmbeddingService(),
    vectorSearchEngine ?? getVectorSearchEngine(),
    resultCombiner ?? new SearchResultCombiner(),
    weightCalculator ?? new AdaptiveWeightCalculator(),
    logger ?? new SearchLogger()
  );
}

// 기존 호환성을 위한 싱글톤 (deprecated)
let hybridSearchEngineInstance: HybridSearchEngine | null = null;

export function getHybridSearchEngine(): HybridSearchEngine {
  if (!hybridSearchEngineInstance) {
    hybridSearchEngineInstance = createHybridSearchEngine();
  }
  return hybridSearchEngineInstance;
}

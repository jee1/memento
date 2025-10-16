/**
 * 하이브리드 검색 엔진
 * FTS5 텍스트 검색 + 벡터 검색 결합
 */

import { SearchEngine } from './search-engine.js';
import { MemoryEmbeddingService, type VectorSearchResult } from '../services/memory-embedding-service.js';
import { EmbeddingService } from '../services/embedding-service.js';
import { getVectorSearchEngine } from './vector-search-engine.js';
import type { MemorySearchFilters, MemoryType } from '../types/index.js';
import Database from 'better-sqlite3';

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
  search(vector: number[], options: { limit?: number; threshold?: number; types?: MemoryType[]; includeContent?: boolean }): Promise<Array<{ memory_id: string; content: string; type: string; importance: number; created_at: string; similarity: number }>>;
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
    //   filters: query.filters
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
    //   searchType: 'hybrid'
    // });
  }

  logSearchError(searchId: string, error: unknown, query: HybridSearchQuery): void {
    // console.error(`❌ [${searchId}] 하이브리드 검색 에러`, {
    //   error: error instanceof Error ? error.message : String(error),
    //   stack: error instanceof Error ? error.stack : undefined,
    //   query: query.query,
    //   limit: query.limit
    // });
  }
}

export interface HybridSearchQuery {
  query: string;
  filters?: MemorySearchFilters | undefined;
  limit?: number | undefined;
  vectorWeight?: number | undefined; // 벡터 검색 가중치 (0.0 ~ 1.0)
  textWeight?: number | undefined;   // 텍스트 검색 가중치 (0.0 ~ 1.0)
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
}

export class HybridSearchEngine {
  private readonly defaultVectorWeight = 0.6; // 벡터 검색 60%
  private readonly defaultTextWeight = 0.4;   // 텍스트 검색 40%
  private searchStats: Map<string, { textHits: number, vectorHits: number, totalSearches: number }> = new Map();

  constructor(
    private textSearchEngine: ITextSearchEngine,
    private embeddingService: IEmbeddingService,
    private vectorSearchEngine: IVectorSearchEngine,
    private resultCombiner: ISearchResultCombiner,
    private weightCalculator: IAdaptiveWeightCalculator,
    private logger: ISearchLogger
  ) {}

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

      // 2. 텍스트 검색 실행
      const textResults = await this.executeTextSearch(db, query, searchId);

      // 3. 벡터 검색 실행
      const vectorResults = await this.executeVectorSearch(db, query, searchId);

      // 4. 결과 결합 및 정렬
      const finalResults = this.combineAndSortResults(textResults, vectorResults, weights, query.limit || 10);

      // 5. 통계 업데이트 및 결과 반환
      this.updateSearchStats(query.query, textResults.length, vectorResults.length);
      
      const queryTime = this.calculateQueryTime(startTime);
      this.logger.logSearchComplete(searchId, {
        items: finalResults,
        total_count: finalResults.length
      }, queryTime);

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
      const queryVector = await this.generateQueryVector(query.query, searchId);
      const vecResults = await this.vectorSearchEngine.search(queryVector, {
        limit: (query.limit || 10) * 2,
        threshold: 0.5,
        types: query.filters?.type,
        includeContent: true
      });
      
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

  private async generateQueryVector(query: string, searchId: string): Promise<number[]> {
    try {
      const embeddingStart = process.hrtime.bigint();
      const embeddingService = new EmbeddingService();
      const embeddingResult = await embeddingService.generateEmbedding(query);
      
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
        vectorLength: embeddingResult.embedding.length
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

  private combineAndSortResults(textResults: any[], vectorResults: VectorSearchResult[], weights: any, limit: number): HybridSearchResult[] {
    try {
      const combinedResults = this.resultCombiner.combine(
        textResults,
        vectorResults,
        weights.textWeight,
        weights.vectorWeight
      );
      
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

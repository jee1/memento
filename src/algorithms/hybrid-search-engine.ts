/**
 * 하이브리드 검색 엔진
 * FTS5 텍스트 검색 + 벡터 검색 결합
 */

import { SearchEngine } from './search-engine.js';
import { MemoryEmbeddingService, type VectorSearchResult } from '../services/memory-embedding-service.js';
import { UnifiedEmbeddingService } from '../services/unified-embedding-service.js';
import { getVectorSearchEngine } from './vector-search-engine.js';
import type { MemorySearchFilters, MemoryType, StoredEmbeddingProviderStats, EmbeddingProvider } from '../types/index.js';
import Database from 'better-sqlite3';
import { SearchRanking } from './search-ranking.js';
import { mementoConfig } from '../config/index.js';
import { RelationGraph } from '../services/relation-graph.js';
import { getRankingWeights } from '../config/ranking-weights-loader.js';

// 검색 관련 상수
/**
 * 개별 provider 검색 타임아웃 (밀리초)
 * 각 provider별 검색 작업이 이 시간 내에 완료되지 않으면 타임아웃 처리
 */
const PROVIDER_SEARCH_TIMEOUT_MS = 2000;

/**
 * 전체 검색 프로세스 타임아웃 (밀리초)
 * 모든 provider 검색이 이 시간 내에 완료되지 않으면 현재까지 완료된 결과만 반환
 * 개별 provider 타임아웃보다 충분히 길어야 함 (여러 provider가 병렬로 실행되므로)
 */
const OVERALL_SEARCH_TIMEOUT_MS = 5000;

/**
 * 벡터 검색 결과 limit 배수
 * 중복 제거 전에 더 많은 결과를 가져와서 최종 결과의 품질을 보장
 */
const VECTOR_SEARCH_LIMIT_MULTIPLIER = 2;

/**
 * 벡터 검색 similarity threshold
 * 이 값보다 낮은 similarity를 가진 결과는 제외
 */
const VECTOR_SEARCH_THRESHOLD = 0.5;

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
  provider_filter?: EmbeddingProvider[]; // 검색할 provider 필터 (선택적, 미지정 시 모든 provider 검색)
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

  /**
   * 벡터 검색 실행 (다중 provider 지원)
   * 
   * @param db - 데이터베이스 연결
   * @param query - 하이브리드 검색 쿼리
   * @param searchId - 검색 ID (로깅용)
   * @param startTime - 시작 시간 (성능 측정용)
   * @returns 벡터 검색 결과 배열
   */
  private async executeVecSearch(db: Database.Database, query: HybridSearchQuery, searchId: string, startTime: bigint): Promise<VectorSearchResult[]> {
    try {
      // 저장된 임베딩의 모든 provider 감지
      const detectedProviders = await this.detectAllStoredEmbeddingProviders(db);
      
      // provider 필터링
      const providersToSearch = this.filterProvidersToSearch(detectedProviders, query.provider_filter, searchId);
      if (providersToSearch.length === 0) {
        return [];
      }
      
      // 다중 provider 병렬 검색 실행
      const searchOptions = {
        limit: (query.limit || 10) * VECTOR_SEARCH_LIMIT_MULTIPLIER,
        threshold: VECTOR_SEARCH_THRESHOLD,
        types: query.filters?.type,
        includeContent: true
      };
      
      // 각 provider별 검색 작업 생성
      const searchPromises = providersToSearch.map(provider => 
        this.createProviderSearchTask(provider, query.query, searchOptions, searchId)
      );
      
      // 모든 provider 검색 실행 및 결과 수집
      const { allResults, providerStats, overallTimeoutOccurred } = 
        await this.executeProviderSearchesWithTimeout(searchPromises, providersToSearch, searchId);
      
      // 결과 정규화 및 중복 제거
      const vectorResults = this.normalizeAndDeduplicateResults(allResults);
      
      const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      
      this.logger.logSearchStep(searchId, 'VEC 벡터 검색 완료', {
        resultCount: vectorResults.length,
        totalVectorTime: `${totalTime.toFixed(2)}ms`,
        providerStats,
        searchedProviders: providersToSearch.length,
        successfulProviders: providerStats.filter(s => s.success).length,
        overallTimeoutOccurred
      });
      
      return vectorResults;
    } catch (error) {
      this.logger.logSearchStep(searchId, 'VEC 벡터 검색 실패, fallback 사용', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return await this.executeFallbackSearch(db, query, searchId, startTime);
    }
  }

  /**
   * Provider 필터링
   * 
   * @param detectedProviders - 감지된 모든 provider 목록
   * @param providerFilter - 필터링할 provider 목록 (선택적, 빈 배열이면 undefined로 처리되어 모든 provider 검색)
   * @param searchId - 검색 ID (로깅용)
   * @returns 필터링된 provider 목록
   */
  private filterProvidersToSearch(
    detectedProviders: StoredEmbeddingProviderStats[],
    providerFilter: EmbeddingProvider[] | undefined,
    searchId: string
  ): EmbeddingProvider[] {
    let providersToSearch = detectedProviders.map(p => p.provider);
    
    // providerFilter가 있고 비어있지 않은 경우에만 필터링
    // 빈 배열은 undefined로 처리되어 모든 provider를 검색함
    if (providerFilter && providerFilter.length > 0) {
      providersToSearch = providersToSearch.filter(p => 
        providerFilter.includes(p as EmbeddingProvider)
      );
    }
    
    // 검색할 provider가 없으면 로깅
    if (providersToSearch.length === 0) {
      this.logger.logSearchStep(searchId, 'VEC 벡터 검색 - 검색할 provider 없음', {
        detectedProviders: detectedProviders.map(p => p.provider),
        providerFilter: providerFilter || []
      });
    }
    
    return providersToSearch;
  }

  /**
   * 단일 provider 검색 작업 생성 (타임아웃 포함)
   * 
   * @param provider - 검색할 provider
   * @param query - 검색 쿼리 문자열
   * @param searchOptions - 검색 옵션
   * @param searchId - 검색 ID (로깅용)
   * @returns 검색 결과 Promise (타임아웃 포함)
   */
  private createProviderSearchTask(
    provider: EmbeddingProvider,
    query: string,
    searchOptions: { limit: number; threshold: number; types?: MemoryType[]; includeContent: boolean },
    searchId: string
  ): Promise<{
    provider: string;
    results: Array<VectorSearchResult & { provider: string }>;
    success: boolean;
    timeMs: number;
    error: string | null;
  }> {
    const providerStartTime = process.hrtime.bigint();
    
    // 타임아웃 Promise 생성
    const timeoutPromise = new Promise<{
      provider: string;
      results: Array<VectorSearchResult & { provider: string }>;
      success: boolean;
      timeMs: number;
      error: string | null;
    }>((resolve) => {
      setTimeout(() => {
        const providerTime = Number(process.hrtime.bigint() - providerStartTime) / 1_000_000;
        resolve({
          provider,
          results: [] as Array<VectorSearchResult & { provider: string }>,
          success: false,
          timeMs: providerTime,
          error: `Provider 검색 타임아웃 (${PROVIDER_SEARCH_TIMEOUT_MS}ms 초과)`
        });
      }, PROVIDER_SEARCH_TIMEOUT_MS);
    });
    
    // 실제 검색 작업 Promise
    const searchTask = (async () => {
      try {
        // 각 provider에 맞는 쿼리 임베딩 생성
        const queryVector = await this.generateQueryVector(query, searchId, provider);
        
        // 벡터 검색 실행
        const vecResults = await this.vectorSearchEngine.search(queryVector, searchOptions, provider);
        
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
            provider // provider 정보 추가
          })),
          success: true,
          timeMs: providerTime,
          error: null as string | null
        };
      } catch (error) {
        const providerTime = Number(process.hrtime.bigint() - providerStartTime) / 1_000_000;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        this.logger.logSearchStep(searchId, `VEC 벡터 검색 실패 - ${provider}`, {
          provider,
          error: errorMessage,
          timeMs: providerTime
        });
        
        return {
          provider,
          results: [] as Array<VectorSearchResult & { provider: string }>,
          success: false,
          timeMs: providerTime,
          error: errorMessage
        };
      }
    })();
    
    // Promise.race로 타임아웃과 검색 작업 중 먼저 완료되는 것 반환
    return Promise.race([searchTask, timeoutPromise]);
  }

  /**
   * 모든 provider 검색 실행 및 결과 수집 (전체 타임아웃 포함)
   * 
   * @param searchPromises - 각 provider별 검색 Promise 배열
   * @param providersToSearch - 검색할 provider 목록
   * @param searchId - 검색 ID (로깅용)
   * @returns 검색 결과 및 통계
   */
  private async executeProviderSearchesWithTimeout(
    searchPromises: Promise<{
      provider: string;
      results: Array<VectorSearchResult & { provider: string }>;
      success: boolean;
      timeMs: number;
      error: string | null;
    }>[],
    providersToSearch: EmbeddingProvider[],
    searchId: string
  ): Promise<{
    allResults: Array<VectorSearchResult & { provider: string }>;
    providerStats: Array<{ provider: string; resultCount: number; success: boolean; timeMs: number; error?: string }>;
    overallTimeoutOccurred: boolean;
  }> {
    // 전체 검색 프로세스의 maximum timeout 설정
    // 모든 provider가 타임아웃되어도 응답을 보장하기 위함
    // 개별 provider 타임아웃보다 충분히 길어야 여러 provider가 병렬로 실행될 수 있음
    let overallTimeoutOccurred = false;
    let overallTimeoutHandle: NodeJS.Timeout | null = null;
    
    const overallTimeoutPromise = new Promise<void>((resolve) => {
      overallTimeoutHandle = setTimeout(() => {
        overallTimeoutOccurred = true;
        this.logger.logSearchStep(searchId, 'VEC 벡터 검색 전체 타임아웃', {
          timeoutMs: OVERALL_SEARCH_TIMEOUT_MS,
          message: '전체 검색 프로세스 타임아웃 발생 - 현재까지 완료된 결과만 반환'
        });
        resolve();
      }, OVERALL_SEARCH_TIMEOUT_MS);
    });
    
    // 타임아웃 타이머 정리 함수
    const cleanupTimeout = () => {
      if (overallTimeoutHandle !== null) {
        clearTimeout(overallTimeoutHandle);
        overallTimeoutHandle = null;
      }
    };
    
    try {
      // Promise.allSettled()를 사용하여 모든 provider 검색 실행 (일부 실패해도 계속 진행)
      // 전체 타임아웃과 병렬 검색 중 먼저 완료되는 것 사용
      const searchResults = await Promise.race([
        Promise.allSettled(searchPromises).then(results => {
          cleanupTimeout();
          return results;
        }),
        overallTimeoutPromise.then(() => {
          // 타임아웃 발생 시 현재까지 완료된 Promise만 수집
          // Promise.allSettled는 이미 실행 중이므로 결과를 기다림
          return Promise.allSettled(searchPromises);
        })
      ]);
      
      // 성공한 검색 결과 수집
      const allResults: Array<VectorSearchResult & { provider: string }> = [];
      const providerStats: Array<{ provider: string; resultCount: number; success: boolean; timeMs: number; error?: string }> = [];
      
      searchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const providerResult = result.value;
          providerStats.push({
            provider: providerResult.provider,
            resultCount: providerResult.results.length,
            success: providerResult.success,
            timeMs: providerResult.timeMs,
            error: providerResult.error || undefined
          });
          
          // 타임아웃 또는 실패 시 상세 로깅
          if (!providerResult.success) {
            const isTimeout = providerResult.error?.includes('타임아웃');
            this.logger.logSearchStep(searchId, `VEC 벡터 검색 실패 - ${providerResult.provider}`, {
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
          // Promise 자체가 실패한 경우 (매우 드묾)
          const provider = providersToSearch[index];
          if (!provider) {
            // provider가 없는 경우 (매우 드묾, 인덱스 불일치) - 스킵
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
          
          this.logger.logSearchStep(searchId, `VEC 벡터 검색 Promise 실패 - ${provider}`, {
            provider,
            error: errorMessage,
            isTimeout: false
          });
        }
      });
      
      return { allResults, providerStats, overallTimeoutOccurred };
    } finally {
      // 예외 발생 시에도 타임아웃 타이머 정리 보장
      cleanupTimeout();
    }
  }

  /**
   * 결과 정규화 및 중복 제거
   * Provider별로 Min-Max 정규화를 수행하고, 중복된 memory_id는 최고 점수만 유지
   * 
   * @param allResults - 모든 provider의 검색 결과
   * @returns 정규화 및 중복 제거된 결과 배열
   */
  private normalizeAndDeduplicateResults(
    allResults: Array<VectorSearchResult & { provider: string }>
  ): VectorSearchResult[] {
    const resultsByProvider = this.groupResultsByProvider(allResults);
    const normalizedResults = this.normalizeResultsByProvider(resultsByProvider);
    const deduplicatedResults = this.deduplicateResults(normalizedResults);
    return this.rankResults(deduplicatedResults);
  }

  /**
   * Provider별로 결과 그룹화
   */
  private groupResultsByProvider(
    allResults: Array<VectorSearchResult & { provider: string }>
  ): Map<string, Array<VectorSearchResult & { provider: string }>> {
    const resultsByProvider = new Map<string, Array<VectorSearchResult & { provider: string }>>();
    allResults.forEach(result => {
      const provider = result.provider;
      if (!resultsByProvider.has(provider)) {
        resultsByProvider.set(provider, []);
      }
      const providerResults = resultsByProvider.get(provider);
      if (providerResults) {
        providerResults.push(result);
      }
    });
    return resultsByProvider;
  }

  /**
   * Provider별로 Min-Max 정규화 수행
   */
  private normalizeResultsByProvider(
    resultsByProvider: Map<string, Array<VectorSearchResult & { provider: string }>>
  ): Array<VectorSearchResult & { provider: string; normalizedScore: number }> {
    const normalizedResults: Array<VectorSearchResult & { provider: string; normalizedScore: number }> = [];
    
    resultsByProvider.forEach((results) => {
      if (results.length === 0) {
        return;
      }
      
      const scores = results.map(r => r.similarity);
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);
      
      // 모든 점수가 동일한 경우 원본 점수 유지, 그 외에는 Min-Max 정규화
      if (maxScore === minScore) {
        results.forEach(result => {
          normalizedResults.push({
            ...result,
            normalizedScore: result.similarity
          });
        });
      } else {
        results.forEach(result => {
          const normalizedScore = (result.similarity - minScore) / (maxScore - minScore);
          normalizedResults.push({
            ...result,
            normalizedScore
          });
        });
      }
    });
    
    return normalizedResults;
  }

  /**
   * 중복 제거 (memory_id 기준, 정규화된 점수 중 최고 점수만 유지)
   */
  private deduplicateResults(
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

  /**
   * 정규화된 점수로 재랭킹
   */
  private rankResults(
    deduplicatedResults: Array<VectorSearchResult & { provider: string; normalizedScore: number }>
  ): VectorSearchResult[] {
    return deduplicatedResults
      .map(({ provider, normalizedScore, ...result }) => ({
        ...result,
        similarity: normalizedScore
      }))
      .sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Fallback 벡터 검색 실행
   * 벡터 인덱스가 사용 불가능한 경우 임베딩 서비스를 직접 사용하여 검색
   * 
   * @param db - 데이터베이스 연결
   * @param query - 하이브리드 검색 쿼리
   * @param searchId - 검색 ID (로깅용)
   * @param startTime - 시작 시간 (성능 측정용, 현재는 사용하지 않음)
   * @returns 벡터 검색 결과 배열
   */
  private async executeFallbackSearch(db: Database.Database, query: HybridSearchQuery, searchId: string, startTime: bigint): Promise<VectorSearchResult[]> {
    if (!this.embeddingService.isAvailable()) {
      this.logger.logSearchStep(searchId, '임베딩 서비스 사용 불가', {});
      return [];
    }
    
    const fallbackStart = process.hrtime.bigint();
    const vectorResults = await this.embeddingService.searchBySimilarity(db, query.query, {
      type: query.filters?.type as MemoryType[],
      limit: (query.limit || 10) * VECTOR_SEARCH_LIMIT_MULTIPLIER,
      threshold: VECTOR_SEARCH_THRESHOLD,
    });
    const fallbackTime = Number(process.hrtime.bigint() - fallbackStart) / 1_000_000;
    
    this.logger.logSearchStep(searchId, 'Fallback 벡터 검색 완료', {
      resultCount: vectorResults.length,
      fallbackTime: `${fallbackTime.toFixed(2)}ms`
    });
    
    return vectorResults;
  }

  /**
   * Provider 목록 캐시 (메모리 캐시)
   * Provider 목록은 자주 변경되지 않으므로 캐싱하여 성능 개선
   */
  private providerCache: {
    stats: StoredEmbeddingProviderStats[];
    timestamp: number;
  } | null = null;

  /**
   * Provider 캐시 TTL (밀리초)
   * 5분간 캐시 유지
   */
  private static readonly PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000;

  /**
   * 저장된 임베딩의 모든 provider 감지
   * 모든 provider 목록을 반환 (count 내림차순 정렬)
   * 캐싱을 사용하여 성능 개선
   */
  private async detectAllStoredEmbeddingProviders(db: Database.Database): Promise<StoredEmbeddingProviderStats[]> {
    // 캐시 확인
    const now = Date.now();
    if (this.providerCache && (now - this.providerCache.timestamp) < HybridSearchEngine.PROVIDER_CACHE_TTL_MS) {
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
            // 유효한 EmbeddingProvider인지 확인
            const validProviders: EmbeddingProvider[] = ['tfidf', 'lightweight', 'minilm', 'openai', 'gemini'];
            return validProviders.includes(stat.provider as EmbeddingProvider);
          })
          .map(stat => ({
            provider: stat.provider as EmbeddingProvider,
            count: stat.count,
            avg_dimensions: Math.round(stat.avg_dimensions || 0)
          }));
        
        // 캐시 업데이트
        this.providerCache = {
          stats: normalizedStats,
          timestamp: now
        };
        
        this.logger.logSearchStep('', '저장된 임베딩 provider 감지', {
          providers: normalizedStats.map(s => s.provider),
          total_providers: normalizedStats.length
        });
        
        return normalizedStats;
      }
    } catch (error) {
      console.warn('⚠️ 저장된 임베딩 provider 감지 실패:', error);
    }

    // 기본값: 빈 배열 반환 (provider가 없는 경우)
    const emptyStats: StoredEmbeddingProviderStats[] = [];
    this.providerCache = {
      stats: emptyStats,
      timestamp: now
    };
    return emptyStats;
  }

  /**
   * 쿼리 임베딩 벡터 생성
   * preferredProvider가 지정된 경우 해당 provider로만 임베딩 생성
   * 각 provider는 서로 다른 차원의 임베딩을 사용할 수 있으므로 fallback을 사용하지 않음
   * 
   * @param query - 검색 쿼리 문자열
   * @param searchId - 검색 ID (로깅용)
   * @param preferredProvider - 선호하는 임베딩 provider (필수, 각 provider별로 다른 차원의 임베딩 필요)
   * @returns 임베딩 벡터 배열
   * @throws SearchError - 임베딩 생성 실패 시
   */
  private async generateQueryVector(query: string, searchId: string, preferredProvider: EmbeddingProvider): Promise<number[]> {
    try {
      const embeddingStart = process.hrtime.bigint();
      
      // 각 provider는 서로 다른 차원의 임베딩을 사용할 수 있으므로
      // preferredProvider로만 임베딩 생성 (fallback 사용 안 함)
      const embeddingResult = await this.queryEmbeddingService.generateEmbedding(query, preferredProvider);
      
      if (!embeddingResult) {
        throw new SearchError(
          SearchErrorType.EMBEDDING_GENERATION_FAILED,
          '임베딩 생성에 실패했습니다',
          undefined,
          { query, searchId, preferredProvider }
        );
      }
      
      const embeddingTime = Number(process.hrtime.bigint() - embeddingStart) / 1_000_000;
      
      this.logger.logSearchStep(searchId, '임베딩 생성 완료', {
        embeddingTime: `${embeddingTime.toFixed(2)}ms`,
        vectorLength: embeddingResult.embedding.length,
        provider: embeddingResult.provider || preferredProvider
      });
      
      return embeddingResult.embedding;
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

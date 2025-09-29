/**
 * 하이브리드 검색 엔진
 * FTS5 텍스트 검색 + 벡터 검색 결합
 */

import { SearchEngine } from './search-engine.js';
import { MemoryEmbeddingService, type VectorSearchResult } from '../services/memory-embedding-service.js';
import type { MemorySearchFilters } from '../types/index.js';

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
  private textSearchEngine: SearchEngine;
  private embeddingService: MemoryEmbeddingService;
  private readonly defaultVectorWeight = 0.6; // 벡터 검색 60%
  private readonly defaultTextWeight = 0.4;   // 텍스트 검색 40%
  private searchStats: Map<string, { textHits: number, vectorHits: number, totalSearches: number }> = new Map();
  private adaptiveWeights: Map<string, { vectorWeight: number, textWeight: number }> = new Map();

  constructor() {
    this.textSearchEngine = new SearchEngine();
    this.embeddingService = new MemoryEmbeddingService();
  }

  /**
   * 하이브리드 검색 실행 - 적응형 가중치 적용
   */
  async search(
    db: any,
    query: HybridSearchQuery
  ): Promise<{ items: HybridSearchResult[], total_count: number, query_time: number }> {
    try {
      console.log('🚀 하이브리드 검색 엔진 시작!');
      console.log('🔍 하이브리드 검색 엔진 호출됨:', query);
      const startTime = process.hrtime.bigint();
      const {
        query: searchQuery,
        filters,
        limit = 10,
        vectorWeight = this.defaultVectorWeight,
        textWeight = this.defaultTextWeight,
      } = query;

    // 1. 적응형 가중치 계산
    const adaptiveWeights = this.calculateAdaptiveWeights(searchQuery, vectorWeight, textWeight);
    const normalizedVectorWeight = adaptiveWeights.vectorWeight;
    const normalizedTextWeight = adaptiveWeights.textWeight;

    console.log(`🔍 하이브리드 검색: "${searchQuery}" (벡터:${normalizedVectorWeight.toFixed(2)}, 텍스트:${normalizedTextWeight.toFixed(2)})`);

    // 2. 텍스트 검색 실행
    console.log('🔍 하이브리드에서 SearchEngine 호출:', searchQuery);
    const textSearchResult = await this.textSearchEngine.search(db, {
      query: searchQuery,
      filters,
      limit: limit * 2, // 더 많은 후보를 가져와서 결합
    });
    console.log('🔍 SearchEngine 결과:', JSON.stringify(textSearchResult, null, 2));
    const textResults = textSearchResult.items;
    console.log('🔍 textResults:', textResults.length, '개');

    // 3. 벡터 검색 실행 (임베딩 서비스 사용 가능한 경우)
    let vectorResults: VectorSearchResult[] = [];
    if (this.embeddingService.isAvailable()) {
      vectorResults = await this.embeddingService.searchBySimilarity(db, searchQuery, {
        type: filters?.type as any,
        limit: limit * 2,
        threshold: 0.5, // 낮은 임계값으로 더 많은 결과 확보
      });
    }

    // 4. 결과 결합 및 점수 계산
    const combinedResults = this.combineResults(
      textResults,
      vectorResults,
      normalizedTextWeight,
      normalizedVectorWeight
    );

    // 5. 최종 점수로 정렬하고 제한
    const finalResults = combinedResults
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, limit);

    // 6. 검색 통계 업데이트
    this.updateSearchStats(searchQuery, textResults.length, vectorResults.length);
    
    // 7. 쿼리 시간 계산
    const endTime = process.hrtime.bigint();
    const queryTime = Number(endTime - startTime) / 1_000_000; // 밀리초로 변환

    return {
      items: finalResults,
      total_count: finalResults.length,
      query_time: queryTime
    };
    } catch (error) {
      console.error('❌ 하이브리드 검색 엔진 에러:', error);
      throw error;
    }
  }

  /**
   * 텍스트 검색과 벡터 검색 결과 결합
   */
  private combineResults(
    textResults: any[],
    vectorResults: VectorSearchResult[],
    textWeight: number,
    vectorWeight: number
  ): HybridSearchResult[] {
    const resultMap = new Map<string, HybridSearchResult>();

    // 텍스트 검색 결과 추가
    textResults.forEach(result => {
      const textScore = typeof result.score === 'number' ? result.score : 0; // 안전한 점수 처리
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

  /**
   * 하이브리드 검색 이유 생성
   */
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

  /**
   * 적응형 가중치 계산
   */
  private calculateAdaptiveWeights(query: string, vectorWeight: number, textWeight: number): { vectorWeight: number, textWeight: number } {
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

  /**
   * 쿼리 특성 분석
   */
  private analyzeQuery(query: string): { isTechnicalTerm: boolean, isPhrase: boolean, isShortQuery: boolean } {
    const normalizedQuery = query.toLowerCase().trim();
    
    return {
      isTechnicalTerm: /^(api|sql|http|json|xml|css|html|js|ts|react|vue|angular|node|python|java|c\+\+|go|rust|docker|kubernetes|aws|azure|gcp)$/i.test(normalizedQuery),
      isPhrase: normalizedQuery.includes(' ') && normalizedQuery.split(' ').length >= 3,
      isShortQuery: normalizedQuery.length <= 10
    };
  }

  /**
   * 쿼리 정규화
   */
  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
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

  /**
   * 검색 통계 정보
   */
  async getSearchStats(db: any): Promise<{
    textSearchAvailable: boolean;
    vectorSearchAvailable: boolean;
    embeddingStats: any;
    searchStats: Map<string, { textHits: number, vectorHits: number, totalSearches: number }>;
    adaptiveWeights: Map<string, { vectorWeight: number, textWeight: number }>;
  }> {
    const embeddingStats = await this.embeddingService.getEmbeddingStats(db);
    
    return {
      textSearchAvailable: true,
      vectorSearchAvailable: this.embeddingService.isAvailable(),
      embeddingStats,
      searchStats: this.searchStats,
      adaptiveWeights: this.adaptiveWeights,
    };
  }

  /**
   * 임베딩 서비스 사용 가능 여부 확인
   */
  isEmbeddingAvailable(): boolean {
    return this.embeddingService.isAvailable();
  }
}

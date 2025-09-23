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

  constructor() {
    this.textSearchEngine = new SearchEngine();
    this.embeddingService = new MemoryEmbeddingService();
  }

  /**
   * 하이브리드 검색 실행
   */
  async search(
    db: any,
    query: HybridSearchQuery
  ): Promise<HybridSearchResult[]> {
    const {
      query: searchQuery,
      filters,
      limit = 10,
      vectorWeight = this.defaultVectorWeight,
      textWeight = this.defaultTextWeight,
    } = query;

    // 가중치 정규화
    const totalWeight = vectorWeight + textWeight;
    const normalizedVectorWeight = vectorWeight / totalWeight;
    const normalizedTextWeight = textWeight / totalWeight;

    console.log(`🔍 하이브리드 검색: "${searchQuery}" (벡터:${normalizedVectorWeight.toFixed(2)}, 텍스트:${normalizedTextWeight.toFixed(2)})`);

    // 1. 텍스트 검색 실행
    const textResults = await this.textSearchEngine.search(db, {
      query: searchQuery,
      filters,
      limit: limit * 2, // 더 많은 후보를 가져와서 결합
    });

    // 2. 벡터 검색 실행 (임베딩 서비스 사용 가능한 경우)
    let vectorResults: VectorSearchResult[] = [];
    if (this.embeddingService.isAvailable()) {
      vectorResults = await this.embeddingService.searchBySimilarity(db, searchQuery, {
        type: filters?.type as any,
        limit: limit * 2,
        threshold: 0.5, // 낮은 임계값으로 더 많은 결과 확보
      });
    }

    // 3. 결과 결합 및 점수 계산
    const combinedResults = this.combineResults(
      textResults,
      vectorResults,
      normalizedTextWeight,
      normalizedVectorWeight
    );

    // 4. 최종 점수로 정렬하고 제한
    return combinedResults
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, limit);
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
      resultMap.set(result.id, {
        id: result.id,
        content: result.content,
        type: result.type,
        importance: result.importance,
        created_at: result.created_at,
        last_accessed: result.last_accessed,
        pinned: result.pinned,
        tags: result.tags,
        textScore: result.score,
        vectorScore: 0,
        finalScore: result.score * textWeight,
        recall_reason: result.recall_reason,
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
   * 검색 통계 정보
   */
  async getSearchStats(db: any): Promise<{
    textSearchAvailable: boolean;
    vectorSearchAvailable: boolean;
    embeddingStats: any;
  }> {
    const embeddingStats = await this.embeddingService.getEmbeddingStats(db);
    
    return {
      textSearchAvailable: true,
      vectorSearchAvailable: this.embeddingService.isAvailable(),
      embeddingStats,
    };
  }

  /**
   * 임베딩 서비스 사용 가능 여부 확인
   */
  isEmbeddingAvailable(): boolean {
    return this.embeddingService.isAvailable();
  }
}

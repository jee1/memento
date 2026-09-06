/**
 * 쿼리 필터 서비스 인터페이스 및 구현
 * Phase 2.4: anchor-search-service.ts 분리
 */

import { logger } from '../../../../shared/utils/logger.js';
import { cosineSimilarity } from '../../../../shared/utils/vector-math.js';
import { UnifiedEmbeddingService } from '../../../embedding/services/unified-embedding-service.js';
import type { IAnchorCacheService } from './anchor-interfaces.js';

/**
 * 필터링 대상 결과 타입
 */
export interface FilterableResult {
  memory_id: string;
  content: string;
  type: string;
  similarity: number;
  hop_distance: number;
  importance: number;
  created_at: string;
  tags?: string[];
}

/**
 * 쿼리 필터 서비스 인터페이스
 */
export interface IQueryFilterService {
  /**
   * 쿼리 기반 필터링
   */
  filterByQuery(
    query: string,
    results: FilterableResult[],
    provider: string
  ): Promise<FilterableResult[]>;
}

/**
 * 쿼리 필터 서비스 구현
 */
export class QueryFilterService implements IQueryFilterService {
  private cacheService: IAnchorCacheService;
  private queryEmbeddingService: UnifiedEmbeddingService;

  constructor(cacheService: IAnchorCacheService) {
    this.cacheService = cacheService;
    this.queryEmbeddingService = new UnifiedEmbeddingService();
  }

  /**
   * 쿼리 기반 필터링
   */
  async filterByQuery(
    query: string,
    results: FilterableResult[],
    _provider: string
  ): Promise<FilterableResult[]> {
    if (results.length === 0) {
      return results;
    }

    try {
      // 쿼리 임베딩 생성
      const queryEmbeddingResult = await this.queryEmbeddingService.generateEmbedding(query);
      if (!queryEmbeddingResult || !queryEmbeddingResult.embedding) {
        logger.warn('Query embedding generation failed, skipping filter');
        return results;
      }

      const queryEmbedding = queryEmbeddingResult.embedding;

      // 각 결과 메모리의 임베딩 조회 및 쿼리 유사도 계산
      const resultsWithQuerySimilarity = await Promise.all(
        results.map(async (result) => {
          try {
            const memoryEmbedding = await this.cacheService.getAnchorEmbedding(result.memory_id);
            if (!memoryEmbedding || !memoryEmbedding.embedding) {
              return {
                ...result,
                query_similarity: 0,
                combined_similarity: result.similarity * 0.5
              };
            }

            // 쿼리 임베딩과 메모리 임베딩 간 유사도 계산
            let querySim = 0;
            if (queryEmbedding.length === memoryEmbedding.embedding.length) {
              querySim = cosineSimilarity(queryEmbedding, memoryEmbedding.embedding);
            } else {
              // 차원이 다르면 텍스트 기반 간단한 매칭
              querySim = this.calculateTextSimilarity(query, result.content);
            }

            const baseRankingScore = this.calculateBaseRankingScore(
              result.similarity,
              result.hop_distance,
              result.importance
            );
            
            const combinedSimilarity = baseRankingScore * 0.6 + querySim * 0.4;

            return {
              ...result,
              query_similarity: querySim,
              combined_similarity: combinedSimilarity
            };
          } catch (error) {
            logger.error('Query filtering failed for memory', {
              memoryId: result.memory_id,
              error: error instanceof Error ? error.message : String(error)
            });
            return {
              ...result,
              query_similarity: 0,
              combined_similarity: result.similarity * 0.5
            };
          }
        })
      );

      // 쿼리 유사도 임계값 적용.
      // combined_similarity 는 60% 가 앵커 기준 랭킹 점수라, hop 1 결과는 쿼리와 아무 관련이
      // 없어도 항상 0.5 를 넘긴다. 그래서 `|| combined >= 0.5` 는 필터를 사실상 무력화했다
      // (실측: '김치찌개 레시피' slot A 98건 중 query_similarity>=0.3 은 0건, combined 로만
      // 통과한 것이 98건). 통과 여부는 쿼리 유사도로만 판정하고 combined 는 정렬에만 쓴다 (#873).
      const queryThreshold = 0.3;
      const filtered = resultsWithQuerySimilarity.filter(
        r => r.query_similarity >= queryThreshold
      );

      // 결합 유사도 기준으로 재정렬
      filtered.sort((a, b) => {
        if (Math.abs(a.combined_similarity - b.combined_similarity) < 0.001) {
          return a.hop_distance - b.hop_distance;
        }
        return b.combined_similarity - a.combined_similarity;
      });

      // 원본 similarity를 combined_similarity로 업데이트하여 반환
      return filtered.map(r => ({
        ...r,
        similarity: r.combined_similarity
      }));
    } catch (error) {
      logger.error('Query-based filtering failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return results;
    }
  }

  /**
   * 텍스트 기반 유사도 계산
   */
  private calculateTextSimilarity(query: string, content: string): number {
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();
    const queryWords = queryLower.split(/\s+/);
    const matchCount = queryWords.filter(word => contentLower.includes(word)).length;
    return matchCount / Math.max(queryWords.length, 1);
  }

  /**
   * 기본 랭킹 점수 계산
   */
  private calculateBaseRankingScore(
    similarity: number,
    hopDistance: number,
    importance: number = 0.5
  ): number {
    const hopDecayFactor = 1.0 / (1.0 + (hopDistance - 1) * 0.3);
    const anchorProximityBoost = hopDistance === 1 ? 1.2 : 1.0;
    const importanceWeight = 0.1;
    const importanceBoost = 1.0 + (importance - 0.5) * importanceWeight;
    
    return Math.min(
      1.0,
      similarity * hopDecayFactor * anchorProximityBoost * importanceBoost
    );
  }
}

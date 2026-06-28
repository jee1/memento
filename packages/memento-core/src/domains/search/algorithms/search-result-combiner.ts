/**
 * 검색 결과를 결합하는 클래스
 * 텍스트 검색 결과와 벡터 검색 결과를 결합하여 하이브리드 검색 결과를 생성합니다.
 * 
 * 단일 책임 원칙을 준수하여 HybridSearchEngine에서 분리되었습니다.
 */

import type { ISearchResultCombiner, HybridSearchResult } from './hybrid-search-types.js';
import type { VectorSearchResult } from '../../memory/services/memory-embedding-service.js';
import { HYBRID_SEARCH } from '../../../shared/config/constants.js';

/**
 * 검색 결과를 결합하는 클래스
 * 
 * Given: 텍스트 검색 결과와 벡터 검색 결과, 가중치가 제공됨
 * When: 두 결과를 결합하여 하이브리드 검색 결과를 생성함
 * Then: 통합된 검색 결과 배열을 반환함
 */
export class SearchResultCombiner implements ISearchResultCombiner {
  /**
   * Given: 텍스트 검색 결과와 벡터 검색 결과, 가중치가 제공됨
   * When: 두 결과를 결합하여 하이브리드 검색 결과를 생성함
   * Then: 통합된 검색 결과 배열을 반환함
   * 
   * @param textResults - 텍스트 검색 결과 배열
   * @param vectorResults - 벡터 검색 결과 배열
   * @param textWeight - 텍스트 검색 가중치
   * @param vectorWeight - 벡터 검색 가중치
   * @returns 통합된 하이브리드 검색 결과 배열
   */
  combine(textResults: unknown[], vectorResults: VectorSearchResult[], textWeight: number, vectorWeight: number): HybridSearchResult[] {
    const resultMap = new Map<string, HybridSearchResult>();

    // 텍스트 검색 결과를 먼저 추가하여 기본 점수를 설정합니다.
    textResults.forEach((rawResult) => {
      const result = rawResult as { id: string; content: string; type: string; importance: number; created_at: string; last_accessed: string; pinned: number | boolean; tags: string[]; score?: number; recall_reason?: string; project_id?: string; owner_id?: string; process_id?: string; session_id?: string };
      const textScore = typeof result.score === 'number' ? result.score : HYBRID_SEARCH.DEFAULT_TEXT_WEIGHT * 0; // 0
      const entry: HybridSearchResult = {
        id: result.id,
        content: result.content,
        type: result.type,
        importance: result.importance,
        created_at: result.created_at,
        last_accessed: result.last_accessed,
        pinned: Boolean(result.pinned),
        tags: result.tags,
        textScore: textScore,
        vectorScore: 0,
        finalScore: textScore * textWeight,
        recall_reason: result.recall_reason || '텍스트 검색 결과',
      };
      // Project-scoped memory (Issue #81): project_id 전달
      if (result.project_id !== undefined) entry.project_id = result.project_id;
      // 기타 extended 필드 전달
      if (result.owner_id !== undefined) entry.owner_id = result.owner_id;
      if (result.process_id !== undefined) (entry as any).process_id = result.process_id;
      if (result.session_id !== undefined) (entry as any).session_id = result.session_id;
      resultMap.set(result.id, entry);
    });

    // 벡터 검색 결과를 추가하거나 기존 텍스트 결과와 결합하여 하이브리드 점수를 계산합니다.
    vectorResults.forEach(result => {
      const existing = resultMap.get(result.id);
      
      if (existing) {
        // 텍스트와 벡터 검색 모두에서 발견된 결과를 업데이트하여 종합 점수를 계산합니다.
        existing.vectorScore = result.similarity;
        existing.finalScore = (existing.textScore * textWeight) + (result.similarity * vectorWeight);
        existing.recall_reason = this.generateHybridReason(existing.textScore, result.similarity);
      } else {
        // 벡터 검색에서만 발견된 결과를 추가하여 검색 포괄성을 확보합니다.
        const vectorOnly: HybridSearchResult = {
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
        };
        if (result.project_id !== undefined) vectorOnly.project_id = result.project_id;
        if (result.owner_id !== undefined) vectorOnly.owner_id = result.owner_id;
        resultMap.set(result.id, vectorOnly);
      }
    });

    return Array.from(resultMap.values());
  }

  /**
   * Given: 텍스트 점수와 벡터 점수가 제공됨
   * When: 하이브리드 검색 이유를 생성함
   * Then: 검색 이유 문자열을 반환함
   * 
   * @param textScore - 텍스트 검색 점수
   * @param vectorScore - 벡터 검색 점수
   * @returns 검색 이유 문자열
   */
  private generateHybridReason(textScore: number, vectorScore: number): string {
    const reasons: string[] = [];
    
    if (textScore > 0.7) {
      reasons.push('텍스트 매칭 우수');
    }
    if (vectorScore > HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.high_vector_score_threshold) {
      reasons.push('의미적 유사도 높음');
    }
    if (textScore > HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.medium_score_threshold && 
        vectorScore > HYBRID_SEARCH.ADAPTIVE_WEIGHT_ADJUSTMENT.medium_score_threshold) {
      reasons.push('텍스트+벡터 결합');
    }
    
    return reasons.length > 0 ? reasons.join(', ') : '하이브리드 검색';
  }
}

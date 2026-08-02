/**
 * 벡터 검색 결과 매핑
 */

import { mcpLogger } from '../../../../server/mcp-logger.js';
import type { VectorSearchResult } from '../../../../shared/types/vector-search.types.js';
import type { RawVectorSearchResult } from './vector-search.types.js';
import type { VectorSearchExecutionOptions } from './vector-search.types.js';

export function safeParseTags(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    mcpLogger.logServer('warn', '태그 JSON 파싱 실패, 빈 배열로 대체합니다', {
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

/**
 * cosine distance → cosine similarity 변환 (issue #713).
 *
 * vec0 테이블은 `distance_metric=cosine`으로 생성되므로 distance는 [0, 2] 범위의 cosine distance다.
 * `1 - distance`는 [-1, 1]이지만 slot threshold(0.8/0.6/0.4)와 랭킹은 [0, 1] 유사도를 가정하므로,
 * 반대 방향(distance 2)은 하한 0으로, 부동소수 오차로 인한 음수 distance는 상한 1로 clamp한다.
 */
export function cosineDistanceToSimilarity(distance: number): number {
  if (typeof distance !== 'number' || !Number.isFinite(distance)) {
    return 0;
  }
  return clampSimilarity(1 - distance);
}

function clampSimilarity(similarity: number): number {
  if (typeof similarity !== 'number' || !Number.isFinite(similarity)) {
    return 0;
  }
  return Math.min(1, Math.max(0, similarity));
}

export function mapKnnResults(
  results: RawVectorSearchResult[],
  options: VectorSearchExecutionOptions
): VectorSearchResult[] {
  const { threshold, includeContent, includeMetadata } = options;

  return results
    .map(result => {
      const similarity = cosineDistanceToSimilarity(result.similarity);
      return {
        memory_id: result.memory_id,
        similarity,
        content: includeContent ? result.content : '',
        type: result.type,
        importance: result.importance,
        created_at: result.created_at,
        last_accessed: includeMetadata
          ? (typeof result.last_accessed_at === 'string' ? result.last_accessed_at : undefined)
          : undefined,
        pinned: includeMetadata ? Boolean(result.pinned) : false,
        tags: includeMetadata ? safeParseTags(result.tags) : undefined,
        ...(result.project_id !== undefined ? { project_id: result.project_id } : {}),
        ...(result.owner_id !== undefined ? { owner_id: result.owner_id } : {}),
        ...(result.process_id !== undefined ? { process_id: result.process_id } : {}),
        ...(result.session_id !== undefined ? { session_id: result.session_id } : {}),
      };
    })
    .filter(result => result.similarity >= threshold);
}

export function mapHybridResults(
  results: RawVectorSearchResult[],
  options: VectorSearchExecutionOptions,
  hasTextQuery: boolean
): VectorSearchResult[] {
  const { threshold, includeContent, includeMetadata } = options;

  return results
    .map(result => {
      // 하이브리드 SQL은 `1 - distance`를 이미 계산해 넘기므로 clamp만 적용한다 (issue #713).
      const vectorSimilarity = clampSimilarity(
        typeof result.vector_similarity === 'number'
          ? result.vector_similarity
          : (result.similarity as number)
      );
      const textSimilarity = typeof result.text_similarity === 'number' ? result.text_similarity : 0;

      const similarity = hasTextQuery
        ? vectorSimilarity * 0.6 + textSimilarity * 0.4
        : vectorSimilarity;

      return {
        memory_id: result.memory_id,
        similarity,
        content: includeContent ? result.content : '',
        type: result.type,
        importance: result.importance,
        created_at: result.created_at,
        last_accessed: includeMetadata
          ? (typeof result.last_accessed_at === 'string' ? result.last_accessed_at : undefined)
          : undefined,
        pinned: includeMetadata ? Boolean(result.pinned) : false,
        tags: includeMetadata ? safeParseTags(result.tags) : undefined,
        ...(result.project_id !== undefined ? { project_id: result.project_id } : {}),
        ...(result.owner_id !== undefined ? { owner_id: result.owner_id } : {}),
        ...(result.process_id !== undefined ? { process_id: result.process_id } : {}),
        ...(result.session_id !== undefined ? { session_id: result.session_id } : {}),
      };
    })
    .filter(result => result.similarity >= threshold);
}

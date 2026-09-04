/**
 * 벡터 검색 결과 매핑
 */

import { mcpLogger } from '../../../../server/mcp-logger.js';
import { cosineDistanceToSimilarity } from '../../../../shared/utils/vector-similarity.js';
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

/** issue #713/#806: 변환 정의는 shared/utils/vector-similarity.ts 한 곳에만 둔다. */
export { cosineDistanceToSimilarity };

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
      // Hybrid SQL은 cosine distance를 넘긴다. 반환 점수 변환은 mapper-only (#811 US5 / #806 FR-020).
      const vectorDistance =
        typeof result.vector_distance === 'number'
          ? result.vector_distance
          : (result.similarity as number);
      const vectorSimilarity = cosineDistanceToSimilarity(vectorDistance);
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

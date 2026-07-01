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

export function mapKnnResults(
  results: RawVectorSearchResult[],
  options: VectorSearchExecutionOptions
): VectorSearchResult[] {
  const { threshold, includeContent, includeMetadata } = options;

  return results
    .map(result => {
      const similarity = Math.max(0, 1 - result.similarity);
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
      const vectorSimilarity = typeof result.vector_similarity === 'number'
        ? result.vector_similarity
        : (result.similarity as number);
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
        tags: includeMetadata ? safeParseTags(result.tags) : undefined
      };
    })
    .filter(result => result.similarity >= threshold);
}

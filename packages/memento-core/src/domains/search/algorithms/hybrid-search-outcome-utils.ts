/**
 * 하이브리드 검색 — 벡터 검색 반환 형태 정규화 (배열 vs { results, query_embedding_providers })
 */

import type { VectorSearchResult, SearchBySimilarityOutcome } from '../../memory/services/memory-embedding-service.js';
import type { EmbeddingProvider } from '../../../shared/types/index.js';

/** 테스트 목업(배열 반환)과 MemoryEmbeddingService(객체 반환) 모두 수용 */
export function normalizeSearchBySimilarityOutcome(
  raw: VectorSearchResult[] | SearchBySimilarityOutcome
): { results: VectorSearchResult[]; query_embedding_providers?: EmbeddingProvider[] } {
  if (Array.isArray(raw)) {
    return { results: raw };
  }
  return {
    results: raw.results,
    query_embedding_providers: raw.query_embedding_providers,
  };
}

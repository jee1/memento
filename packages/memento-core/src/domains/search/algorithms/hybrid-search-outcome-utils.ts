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

export function collectResultIds(items: Array<{ id?: unknown; memory_id?: unknown }>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const id = typeof item.id === 'string' && item.id.length > 0
      ? item.id
      : typeof item.memory_id === 'string' && item.memory_id.length > 0
        ? item.memory_id
        : undefined;
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function filterByVectorThreshold<T extends { similarity?: number }>(
  items: T[],
  threshold: number
): T[] {
  return items.filter((item) => (typeof item.similarity === 'number' ? item.similarity : 0) >= threshold);
}

function itemId(item: { id?: unknown; memory_id?: unknown }): string | undefined {
  if (typeof item.id === 'string' && item.id.length > 0) {
    return item.id;
  }
  if (typeof item.memory_id === 'string' && item.memory_id.length > 0) {
    return item.memory_id;
  }
  return undefined;
}

/**
 * Keep thresholded hits first, then top up from raw (higher similarity first)
 * until minCount. Used when hashed TF-IDF scores sit below HYBRID_VECTOR_THRESHOLD.
 */
export function fillUnderfilledVectorResults<T extends { similarity?: number; id?: unknown; memory_id?: unknown }>(
  thresholded: T[],
  raw: T[],
  minCount: number,
): T[] {
  if (thresholded.length >= minCount) {
    return thresholded;
  }
  const seen = new Set<string>();
  const filled: T[] = [];
  for (const item of thresholded) {
    const id = itemId(item);
    if (id) {
      seen.add(id);
    }
    filled.push(item);
  }
  const rest = [...raw].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  for (const item of rest) {
    if (filled.length >= minCount) {
      break;
    }
    const id = itemId(item);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    filled.push(item);
  }
  return filled;
}

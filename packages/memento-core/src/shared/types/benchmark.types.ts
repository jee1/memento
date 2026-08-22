/**
 * 검색 품질 벤치마크·카테고리 리포트 타입
 */

import type { EmbeddingProvider } from './embedding.types.js';

/**
 * benchmark-v3 오프라인 시드 스크립트는 TF-IDF + mock 벡터를 저장한다.
 * 하이브리드 검색 시 쿼리 임베딩도 동일 provider로 고정해 환경의 EMBEDDING_PROVIDER와 무관하게 결정론적 베이스라인을 만든다.
 * mock provider는 콘텐츠 기반 해시 벡터로 TF-IDF와 상관관계가 낮아 alpha 가중치 조정 효과를 측정할 수 있다.
 */
export const BENCHMARK_OFFLINE_VECTOR_PROVIDER_FILTER: EmbeddingProvider[] = ['tfidf', 'mock'];

export type MacroCategory =
  | 'episodic_recent'
  | 'procedural'
  | 'conceptual'
  | 'tag_filter';

const MACRO_CATEGORY_SET = new Set<string>([
  'episodic_recent',
  'procedural',
  'conceptual',
  'tag_filter',
]);

/** category-mapping.json의 query_overrides 등 — 오타 시 즉시 실패 */
export function assertMacroCategory(value: string, contextLabel: string): MacroCategory {
  if (!MACRO_CATEGORY_SET.has(value)) {
    const allowed = [...MACRO_CATEGORY_SET].sort().join(', ');
    throw new Error(
      `Invalid macro category "${value}" for ${contextLabel}. Expected one of: ${allowed}`
    );
  }
  return value as MacroCategory;
}

export interface QueryWithCategory {
  query_id: string;
  query: string;
  language: string;
  category: string;
  macro_category?: MacroCategory;
  notes?: string;
}

export interface CategoryQualityReport {
  macro_category: MacroCategory;
  query_count: number;
  mrr: number;
  ndcg_at_5: number;
  ndcg_at_10: number;
  /** MRR ≥ 0.5 게이트 통과 여부 */
  threshold_passed: boolean;
}

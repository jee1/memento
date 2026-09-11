/**
 * 검색 품질 벤치마크·카테고리 리포트 타입
 */

import type { EmbeddingProvider } from './embedding.types.js';

const BENCHMARK_EMBEDDING_PROVIDERS = new Set<string>([
  'tfidf',
  'lightweight',
  'minilm',
  'openai',
  'gemini',
  'mock',
]);

/**
 * category-report / weight-profile 벤치마크는 프로덕션과 같은 벡터 공간을 쓴다 (#905).
 * `EMBEDDING_PROVIDER` env를 호출 시점에 읽고, unset/invalid면 `minilm`(config 기본과 동일).
 * 시드와 `provider_filter`는 동일 resolver를 써야 한다(조용한 tfidf 폴백 금지).
 */
export function resolveBenchmarkEmbeddingProvider(): EmbeddingProvider {
  const raw = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (raw && BENCHMARK_EMBEDDING_PROVIDERS.has(raw)) {
    return raw as EmbeddingProvider;
  }
  return 'minilm';
}

/** 시드에 쓴 provider만 검색한다 — 교차-provider(mock) 페어는 #905에서 제거 */
export function getBenchmarkVectorProviderFilter(): EmbeddingProvider[] {
  return [resolveBenchmarkEmbeddingProvider()];
}
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
  /** 실제 채점된 쿼리 수 (GT 보유) */
  query_count: number;
  /** queries.json에 작성된 쿼리 수 — query_count와 다르면 조용히 빠진 쿼리가 있다 (#934) */
  authored_query_count: number;
  mrr: number;
  ndcg_at_5: number;
  ndcg_at_10: number;
  /** top-10 결과 content 길이 평균 — 길이 편향의 무-GT 지표 (#934, 게이트 아님) */
  mean_top10_content_length: number;
  /** MRR ≥ 0.5 게이트 통과 여부 */
  threshold_passed: boolean;
}

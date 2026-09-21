/**
 * 벡터 검색 설정 관리
 * 하드코딩된 값들을 설정 객체로 분리
 */

import type { VectorSearchConfig } from '../types/vector-search.types';

/**
 * vec0 가상 테이블의 거리 척도 계약 (issue #713).
 *
 * 모든 vec 테이블은 `distance_metric=cosine`으로 생성되며, 검색 similarity는
 * `clamp(1 - cosine_distance, 0, 1)`인 cosine similarity다. threshold(0.8/0.6/0.4)도 이 기준이다.
 */
export const VECTOR_SEARCH_DISTANCE_METRIC = 'cosine' as const;

export const VECTOR_SEARCH_CONFIG: VectorSearchConfig = {
  defaultDimensions: 384,
  defaultThreshold: 0.7,
  defaultLimit: 10,
  tableNames: {
    /** 384차원 공용 테이블 (lightweight 등). 트리거는 dimensions=384일 때 여기에 INSERT */
    lightweight: 'memory_item_vec',
    tfidf: 'memory_item_vec_tfidf',
    minilm: 'memory_item_vec_minilm',
    openai: 'memory_item_vec_openai',
    gemini: 'memory_item_vec_gemini',
    mock: 'memory_item_vec_mock'
  },
  providerDimensions: {
    lightweight: 384,
    tfidf: 512,
    minilm: 384,
    openai: 1536,
    gemini: 768,
    mock: 64
  }
} as const;

export const VECTOR_SEARCH_PROVIDERS = {
  LIGHTWEIGHT: 'lightweight',
  TFIDF: 'tfidf',
  MINILM: 'minilm',
  OPENAI: 'openai',
  GEMINI: 'gemini',
  MOCK: 'mock'
} as const;

export const VECTOR_SEARCH_DEFAULTS = {
  DIMENSIONS: 384,
  THRESHOLD: 0.7,
  LIMIT: 10,
  PERFORMANCE_ITERATIONS: 10
} as const;

export const VECTOR_SEARCH_ERRORS = {
  VEC_NOT_AVAILABLE: 'VEC를 사용할 수 없습니다',
  DIMENSION_MISMATCH: '벡터 차원이 일치하지 않습니다',
  SEARCH_FAILED: '벡터 검색에 실패했습니다',
  INDEX_REBUILD_FAILED: '인덱스 재구성에 실패했습니다'
} as const;

/**
 * 벡터 KNN 프리페치 깊이 (#1112).
 *
 * 프리페치를 최종 limit 과 같게 자르면 재랭킹이 볼 수 있는 후보가 limit 개뿐이다.
 * #1107 Phase 1 측정에서 정답이 35·37위에 있었는데 limit 20 프리페치는 후보 단계에서 버린다.
 * 최종 LIMIT 은 그대로 limit 을 쓰고, KNN 단계만 깊게 판다.
 */
export const VECTOR_PREFETCH_CONFIG = {
  multiplier: 8,
  minCandidates: 100,
  maxCandidates: 512,
} as const;

/** MEMENTO_VECTOR_PREFETCH_MULTIPLIER 로 배수를 덮어쓸 수 있다(튜닝·롤백용). */
export function resolveVectorPrefetchMultiplier(): number {
  const raw = process.env.MEMENTO_VECTOR_PREFETCH_MULTIPLIER?.trim();
  if (!raw) {
    return VECTOR_PREFETCH_CONFIG.multiplier;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return VECTOR_PREFETCH_CONFIG.multiplier;
  }
  return parsed;
}

/** 최종 limit 으로부터 KNN 프리페치 깊이를 구한다. */
export function resolveVectorPrefetchLimit(limit: number): number {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
  const scaled = Math.ceil(safeLimit * resolveVectorPrefetchMultiplier());
  const floored = Math.max(scaled, VECTOR_PREFETCH_CONFIG.minCandidates);
  const capped = Math.min(floored, VECTOR_PREFETCH_CONFIG.maxCandidates);
  // 천장이 최종 limit 보다 낮으면 프리페치가 결과보다 얕아진다. limit 이 바닥이다.
  return Math.max(capped, safeLimit);
}

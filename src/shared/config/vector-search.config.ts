/**
 * 벡터 검색 설정 관리
 * 하드코딩된 값들을 설정 객체로 분리
 */

import type { VectorSearchConfig } from '../types/vector-search.types';

export const VECTOR_SEARCH_CONFIG: VectorSearchConfig = {
  defaultDimensions: 384,
  defaultThreshold: 0.7,
  defaultLimit: 10,
  tableNames: {
    tfidf: 'memory_item_vec_tfidf',
    minilm: 'memory_item_vec_minilm',
    openai: 'memory_item_vec_openai',
    gemini: 'memory_item_vec_gemini'
  },
  providerDimensions: {
    tfidf: 512,
    minilm: 384,
    openai: 1536,
    gemini: 768
  }
} as const;

export const VECTOR_SEARCH_PROVIDERS = {
  TFIDF: 'tfidf',
  MINILM: 'minilm',
  OPENAI: 'openai',
  GEMINI: 'gemini'
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

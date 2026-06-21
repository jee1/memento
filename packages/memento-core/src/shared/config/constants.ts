/**
 * 공통 상수 정의
 * 
 * 매직 넘버를 상수로 추출하여 유지보수성을 향상시킵니다.
 * 설정 파일과 함께 사용하여 코드의 가독성과 유지보수성을 개선합니다.
 */

/**
 * 검색 랭킹 관련 상수
 */
export const SEARCH_RANKING = {
  /**
   * 기본 가중치 (ranking-weights.toml에서 오버라이드 가능)
   */
  DEFAULT_WEIGHTS: {
    relevance: 0.45,
    recency: 0.20,
    importance: 0.20,
    usage: 0.10,
    relation_weight: 0.15,
    duplication_penalty: 0.10,
    consolidation_score: 0.2,
    process_attribute_fit: 0.1, // θ (Issue #91)
    zeta_fb: 0.05
  },

  /**
   * Procedural Memory 부스트 값
   */
  PROCEDURAL_MEMORY_BOOST: {
    workflow_name_match: 0.1,
    skill_name_match: 0.1,
    trigger_conditions_match: 0.15,
    max_boost: 0.35
  },

  /**
   * Consolidation Score 최대값
   */
  CONSOLIDATION_SCORE_MAX: 0.4,

  /**
   * Consolidation Score 가중치 (프로파일별)
   */
  CONSOLIDATION_WEIGHTS: {
    recent: { vectorSimilarity: 0.9, consolidationScore: 0.1 },
    balanced: { vectorSimilarity: 0.8, consolidationScore: 0.2 },
    memory: { vectorSimilarity: 0.7, consolidationScore: 0.3 }
  },

  /**
   * 관련성 점수 계산 가중치
   */
  RELEVANCE_WEIGHTS: {
    embedding: 0.60,
    bm25: 0.30,
    tag: 0.05,
    title: 0.05
  }
} as const;

/**
 * 벡터 검색 관련 상수
 */
export const VECTOR_SEARCH = {
  /**
   * 기본 임계값 (threshold)
   */
  DEFAULT_THRESHOLD: 0.5,

  /**
   * Provider별 기본 차원 수
   */
  PROVIDER_DIMENSIONS: {
    lightweight: 384,
    tfidf: 512,
    minilm: 384,
    openai: 1536,
    gemini: 768
  },

  /**
   * 기본 차원 수 (fallback)
   */
  DEFAULT_DIMENSIONS: 512,

  /**
   * 성능 테스트 기본 반복 횟수
   */
  PERFORMANCE_TEST_ITERATIONS: 10
} as const;

/**
 * 하이브리드 검색 관련 상수
 */
export const HYBRID_SEARCH = {
  /**
   * Provider별 검색 타임아웃 (밀리초)
   */
  PROVIDER_SEARCH_TIMEOUT_MS: 2000,

  /**
   * 전체 검색 타임아웃 (밀리초)
   */
  OVERALL_SEARCH_TIMEOUT_MS: 5000,

  /**
   * 벡터 검색 결과 제한 배수 (중복 제거를 위해 더 많은 후보 확보)
   */
  VECTOR_SEARCH_LIMIT_MULTIPLIER: 2,

  /**
   * VectorSearchService가 허용하는 prefetch limit 상한
   */
  MAX_VECTOR_PREFETCH_LIMIT: 100,

  /**
   * 벡터 검색 기본 임계값 (일반 경로)
   */
  VECTOR_SEARCH_THRESHOLD: 0.5,

  /**
   * 하이브리드(recall) 전용 벡터 임계값. 긴 쿼리에서도 후보가 나오도록 완화.
   */
  HYBRID_VECTOR_THRESHOLD: 0.38,

  /**
   * 기본 벡터 가중치
   */
  DEFAULT_VECTOR_WEIGHT: 0.6,

  /**
   * 기본 텍스트 가중치
   */
  DEFAULT_TEXT_WEIGHT: 0.4,

  /**
   * 적응형 가중치 조정 값
   */
  ADAPTIVE_WEIGHT_ADJUSTMENT: {
    high_text_score_threshold: 0.7,
    high_vector_score_threshold: 0.8,
    medium_score_threshold: 0.5,
    high_text_boost: 0.2,
    high_vector_boost: 0.2,
    medium_boost: 0.1,
    min_weight: 0.2,
    max_weight: 0.8
  },

  /**
   * 쿼리 분석 임계값
   */
  QUERY_ANALYSIS: {
    phrase_min_words: 3,
    short_query_max_length: 10
  },

  /**
   * FTS 정책: 토큰 수가 이 값을 초과하면 OR 조합으로 완화하여 긴 쿼리에서도 후보 확보
   */
  FTS_OR_ABOVE_TOKEN_COUNT: 5,

  /**
   * FTS OR 쿼리 시 사용할 최대 토큰 수 (과도한 OR 방지)
   */
  FTS_MAX_TOKENS_FOR_OR: 8
} as const;

/**
 * 검색 관련 상수 타입 정의
 */
export type SearchRankingWeights = typeof SEARCH_RANKING.DEFAULT_WEIGHTS;
export type ConsolidationScoreWeights = typeof SEARCH_RANKING.CONSOLIDATION_WEIGHTS.balanced;
export type VectorSearchConstants = typeof VECTOR_SEARCH;
export type HybridSearchConstants = typeof HYBRID_SEARCH;


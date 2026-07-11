/**
 * 검색 랭킹 알고리즘 타입 정의
 */

export interface SearchFeatures {
  relevance: number;
  recency: number;
  importance: number;
  usage: number;
  duplication_penalty: number;
  consolidation_score?: number; // Consolidation Score (선택적)
  relation_weight?: number; // 관계 가중치 (관계 그래프 기반)
  // Procedural Memory Enhancement (v7.0) 필드
  workflow_name_match?: boolean; // workflow_name 매칭 여부
  skill_name_match?: boolean; // skill_name 매칭 여부
  trigger_conditions_match?: boolean; // trigger_conditions 매칭 여부
  // Process Attribute (Issue #91): recall 시 process 적합도 (0~1, 미제공 시 1)
  process_attribute_fit?: number;
  /** 시그모이드 정규화된 피드백 점수 [0,1], 미제공 시 랭킹에서 0.5(중립)로 처리 */
  feedback_score?: number;
}

export interface EmbeddingSimilarity {
  queryEmbedding: number[];
  docEmbedding: number[];
}

export interface BM25Result {
  score: number;
  normalizedScore: number;
}

export interface UsageMetrics {
  viewCount: number;
  citeCount: number;
  editCount: number;
  lastAccessed?: Date | undefined;
}

export interface RelevanceInput {
  query: string;
  content: string;
  title?: string;
  tags: string[];
  embeddingSimilarity?: EmbeddingSimilarity | undefined;
  bm25Result?: BM25Result | undefined;
}

export interface SearchRankingWeights {
  relevance: number;    // α = 0.45
  recency: number;      // β = 0.20
  importance: number;   // γ = 0.20
  usage: number;        // δ = 0.10
  relation_weight: number; // ζ = 0.15
  duplication_penalty: number; // ε = 0.10
  consolidation_score?: number; // w2 = 0.2 (기본값, 최대 0.4)
  process_attribute_fit?: number; // θ = 0.1 (Issue #91, process 적합도 가중치)
  zeta_fb?: number; // 피드백 신호 가중치
}

/**
 * 사용자의 검색 목적에 따라 다른 가중치를 적용하여 맞춤형 검색 결과를 제공합니다.
 */
export type SearchProfile = 'recent' | 'balanced' | 'memory';

/**
 * 벡터 유사도와 통합 점수의 균형을 조절하여 검색 정확도를 최적화합니다.
 */
export interface ConsolidationScoreWeights {
  vectorSimilarity: number; // w1
  consolidationScore: number; // w2 (최대 0.4)
}

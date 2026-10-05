/**
 * 검색 랭킹 알고리즘 타입 정의
 */

export interface SearchFeatures {
  relevance: number;
  recency: number;
  importance: number;
  usage: number;
  duplication_penalty: number;
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
  duplication_penalty: number; // ε = 0.10
  process_attribute_fit?: number; // θ = 0.1 (Issue #91, process 적합도 가중치)
  zeta_fb?: number; // 피드백 신호 가중치
}

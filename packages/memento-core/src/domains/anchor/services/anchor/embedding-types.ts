/**
 * 임베딩 관련 타입 정의
 * Phase 4.3: 타입 안정성 개선 - 임베딩 도메인 타입 정의
 */

/**
 * 임베딩 결과
 */
export interface EmbeddingResult {
  embedding: number[];
  provider: string;
}

/**
 * 임베딩 프로바이더 타입
 */
export type EmbeddingProvider = 'tfidf' | 'minilm' | 'openai' | 'gemini';

/**
 * 임베딩 결과 (null 가능)
 */
export type EmbeddingResultOrNull = EmbeddingResult | null;


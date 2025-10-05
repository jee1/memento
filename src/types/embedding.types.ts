/**
 * 임베딩 서비스 공통 타입 정의
 * 모든 임베딩 서비스가 구현해야 하는 인터페이스
 */

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  provider?: EmbeddingProvider;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface SimilarityResult {
  id: string;
  content: string;
  similarity: number;
  score: number;
}

export interface EmbeddingData {
  id: string;
  content: string;
  embedding: number[];
}

/**
 * 임베딩 서비스 공통 인터페이스
 * 의존성 역전 원칙을 위한 추상화
 */
export interface EmbeddingServiceInterface {
  /**
   * 텍스트를 임베딩 벡터로 변환
   */
  generateEmbedding(text: string): Promise<EmbeddingResult | null>;
  
  /**
   * 쿼리와 유사한 임베딩 검색
   */
  searchSimilar(
    query: string,
    embeddings: EmbeddingData[],
    limit?: number,
    threshold?: number
  ): Promise<SimilarityResult[]>;
  
  /**
   * 서비스 사용 가능 여부 확인
   */
  isAvailable(): boolean;
  
  /**
   * 모델 정보 반환
   */
  getModelInfo(): {
    model: string;
    dimensions: number;
    maxTokens: number;
  };
}

/**
 * 임베딩 제공자 타입
 */
export type EmbeddingProvider = 'tfidf' | 'minilm' | 'openai' | 'gemini';

/**
 * 임베딩 제공자 정보
 */
export interface ProviderInfo {
  name: EmbeddingProvider;
  available: boolean;
  priority: number;
  cost: 'free' | 'paid';
  performance: 'low' | 'medium' | 'high';
}

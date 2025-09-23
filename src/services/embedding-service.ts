/**
 * OpenAI API를 사용한 임베딩 서비스
 * 텍스트를 벡터로 변환하고 유사도 검색 제공
 */

import OpenAI from 'openai';
import { mementoConfig } from '../config/index.js';

export interface EmbeddingResult {
  embedding: number[];
  model: string;
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

export class EmbeddingService {
  private openai: OpenAI | null = null;
  private readonly model = 'text-embedding-3-small'; // 1536차원
  private readonly maxTokens = 8191; // text-embedding-3-small 최대 토큰

  constructor() {
    this.initializeOpenAI();
  }

  /**
   * OpenAI 클라이언트 초기화
   */
  private initializeOpenAI(): void {
    if (!mementoConfig.openaiApiKey) {
      console.warn('⚠️ OpenAI API 키가 설정되지 않았습니다. 임베딩 기능이 비활성화됩니다.');
      return;
    }

    try {
      this.openai = new OpenAI({
        apiKey: mementoConfig.openaiApiKey,
      });
      console.log('✅ OpenAI 임베딩 서비스 초기화 완료');
    } catch (error) {
      console.error('❌ OpenAI 초기화 실패:', error);
      this.openai = null;
    }
  }

  /**
   * 텍스트를 임베딩으로 변환
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult | null> {
    if (!this.openai) {
      throw new Error('OpenAI API가 초기화되지 않았습니다');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('텍스트가 비어있습니다');
    }

    // 토큰 수 제한 확인
    const truncatedText = this.truncateText(text);
    
    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: truncatedText,
        encoding_format: 'float',
      });

      const embedding = response.data[0]?.embedding;
      if (!embedding) {
        throw new Error('임베딩 생성에 실패했습니다');
      }
      
      return {
        embedding,
        model: this.model,
        usage: {
          prompt_tokens: response.usage.prompt_tokens,
          total_tokens: response.usage.total_tokens,
        },
      };
    } catch (error) {
      console.error('❌ 임베딩 생성 실패:', error);
      throw new Error(`임베딩 생성 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 쿼리와 유사한 임베딩 검색
   */
  async searchSimilar(
    query: string,
    embeddings: Array<{ id: string; content: string; embedding: number[] }>,
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<SimilarityResult[]> {
    if (!this.openai) {
      throw new Error('OpenAI API가 초기화되지 않았습니다');
    }

    // 쿼리 임베딩 생성
    const queryEmbedding = await this.generateEmbedding(query);
    if (!queryEmbedding) {
      return [];
    }

    // 코사인 유사도 계산
    const similarities = embeddings.map(item => {
      const similarity = this.cosineSimilarity(queryEmbedding.embedding, item.embedding);
      return {
        id: item.id,
        content: item.content,
        similarity,
        score: similarity
      };
    });

    // 유사도 순으로 정렬하고 임계값 필터링
    return similarities
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * 코사인 유사도 계산
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('벡터 차원이 일치하지 않습니다');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] || 0;
      const bVal = b[i] || 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * 텍스트를 토큰 제한에 맞게 자르기
   */
  private truncateText(text: string): string {
    // 간단한 토큰 추정 (1 토큰 ≈ 4 문자)
    const estimatedTokens = text.length / 4;
    
    if (estimatedTokens <= this.maxTokens) {
      return text;
    }

    // 토큰 제한에 맞게 자르기
    const maxChars = this.maxTokens * 4;
    return text.substring(0, maxChars);
  }

  /**
   * 서비스 사용 가능 여부 확인
   */
  isAvailable(): boolean {
    return this.openai !== null;
  }

  /**
   * 모델 정보 반환
   */
  getModelInfo(): { model: string; dimensions: number; maxTokens: number } {
    return {
      model: this.model,
      dimensions: 1536, // text-embedding-3-small 차원
      maxTokens: this.maxTokens,
    };
  }
}

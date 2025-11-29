
/**
 * OpenAI 임베딩 서비스
 * text-embedding-3 시리즈를 활용해 고차원 임베딩 제공
 */

import OpenAI from 'openai';
import { mementoConfig } from '../../../config/index.js';
import type {
  EmbeddingServiceInterface,
  EmbeddingResult,
  SimilarityResult,
  EmbeddingData
} from '../../../types/embedding.types.js';
import { LightweightEmbeddingService } from './lightweight-embedding-service.js';

export class OpenAIEmbeddingService implements EmbeddingServiceInterface {
  private client: OpenAI | null = null;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly maxTokens: number;
  private readonly cache = new Map<string, EmbeddingResult>();
  private readonly fallbackService = new LightweightEmbeddingService();

  constructor() {
    this.model = mementoConfig.openaiModel || 'text-embedding-3-small';
    // text-embedding-3-small = 1536, text-embedding-3-large = 3072
    this.dimensions = mementoConfig.embeddingDimensions || 1536;
    this.maxTokens = 8191; // OpenAI 공식 문서 기준

    this.initializeClient();
  }

  /**
   * OpenAI 클라이언트를 초기화
   */
  private initializeClient(): void {
    if (!mementoConfig.openaiApiKey) {
      console.warn(
        '⚠️ OPENAI_API_KEY가 설정되지 않아 OpenAI 임베딩이 비활성화됩니다. ' +
          '고품질 임베딩이 필요하면 키를 설정하거나 EMBEDDING_PROVIDER를 minilm으로 변경하세요.'
      );
      this.client = null;
      return;
    }

    try {
      this.client = new OpenAI({ apiKey: mementoConfig.openaiApiKey });
      console.log('✅ OpenAI 임베딩 서비스 초기화 완료');
    } catch (error) {
      console.error(
        '❌ OpenAI 초기화 실패. OPENAI_API_KEY 값과 네트워크 접근 권한을 확인하거나 MiniLM/TFiDF 모델로 폴백하세요:',
        error
      );
      this.client = null;
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  getModelInfo(): { model: string; dimensions: number; maxTokens: number } {
    return {
      model: this.model,
      dimensions: this.dimensions,
      maxTokens: this.maxTokens
    };
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult | null> {
    this.validateInput(text);

    const cacheKey = this.generateCacheKey(text);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      if (!this.client && mementoConfig.openaiApiKey) {
        this.initializeClient();
      }

      const result = await this.generateOpenAIEmbedding(text);
      if (result) {
        this.cache.set(cacheKey, result);
        this.cleanupCache();
      }
      return result;
    } catch (error) {
      console.warn('⚠️ OpenAI 임베딩 생성 실패, 경량 서비스로 fallback:', error);
      return this.generateFallbackEmbedding(text, cacheKey);
    }
  }

  async searchSimilar(
    query: string,
    embeddings: EmbeddingData[],
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<SimilarityResult[]> {
    if (embeddings.length === 0) {
      return [];
    }

    const queryEmbedding = await this.generateEmbedding(query);
    if (!queryEmbedding) {
      return [];
    }

    return embeddings
      .map(item => ({
        id: item.id,
        content: item.content,
        similarity: this.cosineSimilarity(queryEmbedding.embedding, item.embedding),
        score: this.cosineSimilarity(queryEmbedding.embedding, item.embedding)
      }))
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  private async generateOpenAIEmbedding(text: string): Promise<EmbeddingResult | null> {
    if (!this.client) {
      throw new Error('OpenAI 클라이언트가 초기화되지 않았습니다.');
    }

    const truncatedText = this.truncateText(text);
    const response = await this.client.embeddings.create({
      model: this.model,
      input: truncatedText
    });

    const embedding = response.data?.[0]?.embedding ?? [];
    if (embedding.length === 0) {
      throw new Error('OpenAI 임베딩 응답이 비어 있습니다.');
    }

    return {
      embedding,
      model: this.model,
      provider: 'openai',
      usage: {
        prompt_tokens: response.usage?.prompt_tokens ?? this.estimateTokens(truncatedText),
        total_tokens: response.usage?.total_tokens ?? this.estimateTokens(truncatedText)
      }
    };
  }

  private async generateFallbackEmbedding(text: string, cacheKey: string): Promise<EmbeddingResult | null> {
    try {
      const fallbackResult = await this.fallbackService.generateEmbedding(text);
      if (fallbackResult) {
        const patchedResult: EmbeddingResult = {
          ...fallbackResult,
          provider: fallbackResult.provider ?? 'tfidf'
        };
        this.cache.set(cacheKey, patchedResult);
        this.cleanupCache();
        return patchedResult;
      }
      return null;
    } catch (fallbackError) {
      console.error('❌ 경량 임베딩 fallback도 실패했습니다:', fallbackError);
      return null;
    }
  }

  private validateInput(text: string): void {
    if (!text || text.trim().length === 0) {
      throw new Error('텍스트가 비어 있습니다');
    }
  }

  private truncateText(text: string): string {
    const estimatedTokens = this.estimateTokens(text);
    if (estimatedTokens <= this.maxTokens) {
      return text;
    }
    const maxChars = this.maxTokens * 4;
    return text.substring(0, maxChars);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('벡터 차원이 일치하지 않습니다');
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      const a = vecA[i] ?? 0;
      const b = vecB[i] ?? 0;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dot / denominator;
  }

  private generateCacheKey(text: string): string {
    return `openai:${this.hashText(text)}`;
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // 32bit 변환
    }
    return hash.toString(36);
  }

  private cleanupCache(): void {
    const MAX_CACHE_SIZE = 1000;
    if (this.cache.size <= MAX_CACHE_SIZE) {
      return;
    }

    const entries = Array.from(this.cache.entries());
    this.cache.clear();
    entries.slice(-MAX_CACHE_SIZE / 2).forEach(([key, value]) => {
      this.cache.set(key, value);
    });
  }
}

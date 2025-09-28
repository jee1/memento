/**
 * 통합 임베딩 서비스
 * OpenAI, Gemini, 경량 하이브리드 서비스 중 선택하여 사용
 * 설정에 따라 자동으로 적절한 제공자 선택
 */

import OpenAI from 'openai';
import { mementoConfig } from '../config/index.js';
import { GeminiEmbeddingService, type GeminiEmbeddingResult, type GeminiSimilarityResult } from './gemini-embedding-service.js';
import { LightweightEmbeddingService, type LightweightEmbeddingResult, type LightweightSimilarityResult } from './lightweight-embedding-service.js';

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
  private geminiService: GeminiEmbeddingService;
  private lightweightService: LightweightEmbeddingService;
  private readonly model = 'text-embedding-3-small'; // 1536차원
  private readonly maxTokens = 8191; // text-embedding-3-small 최대 토큰
  private embeddingCache: Map<string, EmbeddingResult> = new Map(); // 임베딩 캐시
  private batchQueue: string[] = []; // 배치 처리 큐
  private batchTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.geminiService = new GeminiEmbeddingService();
    this.lightweightService = new LightweightEmbeddingService();
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
   * 텍스트를 임베딩으로 변환 - 캐시 최적화
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult | null> {
    if (!text || text.trim().length === 0) {
      throw new Error('텍스트가 비어있습니다');
    }

    // 1. 캐시 확인
    const cacheKey = this.generateCacheKey(text);
    const cached = this.embeddingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. 설정에 따른 제공자 선택
    const provider = mementoConfig.embeddingProvider;
    let result: EmbeddingResult | null = null;

    try {
      switch (provider) {
        case 'openai':
          result = await this.generateOpenAIEmbedding(text);
          break;
        case 'gemini':
          result = await this.generateGeminiEmbedding(text);
          break;
        case 'lightweight':
          result = await this.generateLightweightEmbedding(text);
          break;
        default:
          console.warn(`⚠️ 알 수 없는 임베딩 제공자: ${provider}, 경량 서비스로 fallback`);
          result = await this.generateLightweightEmbedding(text);
      }
    } catch (error) {
      console.warn(`⚠️ ${provider} 임베딩 실패, 경량 서비스로 fallback:`, error);
      result = await this.generateLightweightEmbedding(text);
    }

    if (result) {
      // 캐시에 저장
      this.embeddingCache.set(cacheKey, result);
      this.cleanupCache();
    }

    return result;
  }

  /**
   * OpenAI 임베딩 생성
   */
  private async generateOpenAIEmbedding(text: string): Promise<EmbeddingResult | null> {
    if (!this.openai) {
      throw new Error('OpenAI 클라이언트가 초기화되지 않았습니다');
    }

    const truncatedText = this.truncateText(text);
    
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
  }

  /**
   * Gemini 임베딩 생성
   */
  private async generateGeminiEmbedding(text: string): Promise<EmbeddingResult | null> {
    const geminiResult = await this.geminiService.generateEmbedding(text);
    if (!geminiResult) {
      return null;
    }

    return {
      embedding: geminiResult.embedding,
      model: geminiResult.model,
      usage: geminiResult.usage,
    };
  }

  /**
   * 경량 임베딩 생성
   */
  private async generateLightweightEmbedding(text: string): Promise<EmbeddingResult | null> {
    const lightweightResult = await this.lightweightService.generateEmbedding(text);
    if (!lightweightResult) {
      return null;
    }

    return {
      embedding: lightweightResult.embedding,
      model: lightweightResult.model,
      usage: lightweightResult.usage,
    };
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
    // 쿼리 임베딩 생성 (fallback 로직 포함)
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
   * 캐시 키 생성
   */
  private generateCacheKey(text: string): string {
    // 텍스트 해시를 사용하여 캐시 키 생성
    return `embedding:${this.hashText(text)}`;
  }

  /**
   * 텍스트 해시 생성
   */
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32비트 정수로 변환
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 캐시 정리
   */
  private cleanupCache(): void {
    const maxCacheSize = 1000;
    if (this.embeddingCache.size > maxCacheSize) {
      const entries = Array.from(this.embeddingCache.entries());
      this.embeddingCache.clear();
      // 최신 500개만 유지
      entries.slice(-500).forEach(([key, value]) => {
        this.embeddingCache.set(key, value);
      });
    }
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
    const provider = mementoConfig.embeddingProvider;
    
    switch (provider) {
      case 'openai':
        return this.openai !== null;
      case 'gemini':
        return this.geminiService.isAvailable();
      case 'lightweight':
        return this.lightweightService.isAvailable();
      default:
        return this.lightweightService.isAvailable();
    }
  }

  /**
   * 모델 정보 반환
   */
  getModelInfo(): { model: string; dimensions: number; maxTokens: number } {
    const provider = mementoConfig.embeddingProvider;
    
    switch (provider) {
      case 'openai':
        return {
          model: this.model,
          dimensions: 1536, // text-embedding-3-small 차원
          maxTokens: this.maxTokens,
        };
      case 'gemini':
        return this.geminiService.getModelInfo();
      case 'lightweight':
        return this.lightweightService.getModelInfo();
      default:
        return this.lightweightService.getModelInfo();
    }
  }
}

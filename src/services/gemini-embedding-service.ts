/**
 * Google Gemini API를 사용한 임베딩 서비스
 * 텍스트를 벡터로 변환하고 유사도 검색 제공
 * OpenAI와 동일한 인터페이스를 제공하여 교체 가능
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { mementoConfig } from '../config/index.js';
import { LightweightEmbeddingService, type LightweightEmbeddingResult, type LightweightSimilarityResult } from './lightweight-embedding-service.js';

export interface GeminiEmbeddingResult {
  embedding: number[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface GeminiSimilarityResult {
  id: string;
  content: string;
  similarity: number;
  score: number;
}

export class GeminiEmbeddingService {
  private genAI: GoogleGenerativeAI | null = null;
  private lightweightService: LightweightEmbeddingService;
  private readonly model: string;
  private readonly maxTokens = 2048; // Gemini text-embedding-004 최대 토큰
  private embeddingCache: Map<string, GeminiEmbeddingResult> = new Map(); // 임베딩 캐시
  private batchQueue: string[] = []; // 배치 처리 큐
  private batchTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.lightweightService = new LightweightEmbeddingService();
    this.model = mementoConfig.geminiModel;
    this.initializeGemini();
  }

  /**
   * Gemini 클라이언트 초기화
   */
  private initializeGemini(): void {
    if (!mementoConfig.geminiApiKey) {
      console.warn('⚠️ Gemini API 키가 설정되지 않았습니다. 임베딩 기능이 비활성화됩니다.');
      return;
    }

    try {
      this.genAI = new GoogleGenerativeAI(mementoConfig.geminiApiKey);
      console.log('✅ Gemini 임베딩 서비스 초기화 완료');
    } catch (error) {
      console.error('❌ Gemini 초기화 실패:', error);
      this.genAI = null;
    }
  }

  /**
   * 텍스트를 임베딩으로 변환 - 캐시 최적화
   */
  async generateEmbedding(text: string): Promise<GeminiEmbeddingResult | null> {
    if (!text || text.trim().length === 0) {
      throw new Error('텍스트가 비어있습니다');
    }

    // 1. 캐시 확인
    const cacheKey = this.generateCacheKey(text);
    const cached = this.embeddingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Gemini가 사용 가능한 경우
    if (this.genAI) {
      try {
        // 토큰 수 제한 확인
        const truncatedText = this.truncateText(text);
        
        const model = this.genAI.getGenerativeModel({ model: this.model });
        const result = await model.embedContent(truncatedText);
        
        const embedding = result.embedding.values;
        if (!embedding || embedding.length === 0) {
          throw new Error('임베딩 생성에 실패했습니다');
        }
        
        const embeddingResult = {
          embedding: Array.from(embedding),
          model: this.model,
          usage: {
            prompt_tokens: this.estimateTokens(truncatedText),
            total_tokens: this.estimateTokens(truncatedText),
          },
        };

        // 캐시에 저장
        this.embeddingCache.set(cacheKey, embeddingResult);
        this.cleanupCache();
        
        return embeddingResult;
      } catch (error) {
        console.warn('⚠️ Gemini 임베딩 실패, 경량 서비스로 fallback:', error);
        // Gemini 실패 시 경량 서비스로 fallback
      }
    }

    // 3. Gemini가 없거나 실패한 경우 경량 서비스 사용
    console.log('🔄 경량 하이브리드 임베딩 서비스 사용');
    try {
      const lightweightResult = await this.lightweightService.generateEmbedding(text);
      if (!lightweightResult) {
        return null;
      }

      const result = {
        embedding: lightweightResult.embedding,
        model: lightweightResult.model,
        usage: lightweightResult.usage,
      };

      // 캐시에 저장
      this.embeddingCache.set(cacheKey, result);
      this.cleanupCache();
      
      return result;
    } catch (error) {
      console.error('❌ 경량 임베딩 생성 실패:', error);
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
  ): Promise<GeminiSimilarityResult[]> {
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
    return `gemini_embedding:${this.hashText(text)}`;
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
   * 토큰 수 추정
   */
  private estimateTokens(text: string): number {
    // 간단한 추정: 1 토큰 ≈ 4 문자
    return Math.ceil(text.length / 4);
  }

  /**
   * 서비스 사용 가능 여부 확인
   */
  isAvailable(): boolean {
    return this.genAI !== null || this.lightweightService.isAvailable();
  }

  /**
   * 모델 정보 반환
   */
  getModelInfo(): { model: string; dimensions: number; maxTokens: number } {
    if (this.genAI) {
      return {
        model: this.model,
        dimensions: mementoConfig.embeddingDimensions, // 환경 변수에서 차원 가져오기
        maxTokens: this.maxTokens,
      };
    } else {
      return this.lightweightService.getModelInfo();
    }
  }
}

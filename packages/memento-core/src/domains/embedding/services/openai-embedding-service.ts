
/**
 * OpenAI 임베딩 서비스
 * text-embedding-3 시리즈를 활용해 고차원 임베딩 제공
 */

import OpenAI from 'openai';
import { mementoConfig } from '../../../shared/config/index.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { logger } from '../../../shared/utils/logger.js';
import type {
  EmbeddingServiceInterface,
  EmbeddingResult,
  SimilarityResult,
  EmbeddingData
} from '../../../shared/types/embedding.types.js';
import { LightweightEmbeddingService } from './lightweight-embedding-service.js';
import { RetryManager } from '../../../infrastructure/scheduler/retry-manager.js';
import type { RetryConfig } from '../../../infrastructure/scheduler/retry-manager.js';
import { getRetryOptions } from '../../../shared/config/retry-options-loader.js';
import {
  cleanupEmbeddingCache,
  estimateEmbeddingTokens,
  generateEmbeddingCacheKey,
  rankSimilarEmbeddings,
  truncateEmbeddingText,
} from './embedding-helpers.js';

export class OpenAIEmbeddingService implements EmbeddingServiceInterface {
  private client: OpenAI | null = null;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly maxTokens: number;
  private readonly cache = new Map<string, EmbeddingResult>();
  private readonly fallbackService = new LightweightEmbeddingService();
  private readonly retryManager: RetryManager;

  constructor() {
    this.model = mementoConfig.openaiModel || 'text-embedding-3-small';
    // text-embedding-3-small = 1536, text-embedding-3-large = 3072
    this.dimensions = mementoConfig.embeddingDimensions || 1536;
    this.maxTokens = 8191; // OpenAI 공식 문서 기준

    // RetryManager 초기화 (embedding_api 설정 사용)
    const retryOptions = getRetryOptions();
    const retryConfig: RetryConfig = {
      ...retryOptions.embedding_api,
      maxErrorCount: retryOptions.default.maxErrorCount
    };
    this.retryManager = new RetryManager(retryConfig);

    this.initializeClient();
  }

  /**
   * OpenAI 클라이언트를 초기화
   */
  private initializeClient(): void {
    if (!mementoConfig.openaiApiKey) {
      // 경고 로그는 MCP 프로토콜 준수를 위해 출력하지 않음
      this.client = null;
      return;
    }

    try {
      this.client = new OpenAI({ apiKey: mementoConfig.openaiApiKey });
      // 초기화 로그는 MCP 프로토콜 준수를 위해 출력하지 않음
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      process.stderr.write(
        `❌ OpenAI 초기화 실패. OPENAI_API_KEY 값과 네트워크 접근 권한을 확인하거나 MiniLM/TFiDF 모델로 폴백하세요: ${maskedError.message}\n`
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

    const cacheKey = generateEmbeddingCacheKey('openai', text);
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
        cleanupEmbeddingCache(this.cache);
      }
      return result;
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      process.stderr.write(`⚠️ OpenAI 임베딩 생성 실패, 경량 서비스로 fallback: ${maskedError.message}\n`);
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

    return rankSimilarEmbeddings(queryEmbedding.embedding, embeddings, limit, threshold);
  }

  private async generateOpenAIEmbedding(text: string): Promise<EmbeddingResult | null> {
    if (!this.client) {
      throw new Error('OpenAI 클라이언트가 초기화되지 않았습니다.');
    }

    const truncatedText = truncateEmbeddingText(text, this.maxTokens);
    
    // RetryManager를 사용하여 외부 API 호출 재시도
    const retryOptions = getRetryOptions();
    const response = await this.retryManager.retry(
      async () => {
        return await this.client!.embeddings.create({
          model: this.model,
          input: truncatedText
        });
      },
      {
        maxAttempts: retryOptions.embedding_api.maxAttempts,
        baseDelay: retryOptions.embedding_api.baseDelay,
        shouldRetry: (error: Error) => {
          // 네트워크 에러나 일시적 오류만 재시도
          const message = error.message.toLowerCase();
          return message.includes('network') || 
                 message.includes('timeout') || 
                 message.includes('rate limit') ||
                 message.includes('server error') ||
                 message.includes('503') ||
                 message.includes('502') ||
                 message.includes('500');
        },
        onRetry: (error: Error, attempt: number, delay: number) => {
          logger.warn('OpenAI 임베딩 API 호출 재시도', {
            attempt,
            delay,
            error: error.message,
            model: this.model
          });
        }
      }
    );

    const embedding = response.data?.[0]?.embedding ?? [];
    if (embedding.length === 0) {
      throw new Error('OpenAI 임베딩 응답이 비어 있습니다.');
    }

    return {
      embedding,
      model: this.model,
      provider: 'openai',
      usage: {
        prompt_tokens: response.usage?.prompt_tokens ?? estimateEmbeddingTokens(truncatedText),
        total_tokens: response.usage?.total_tokens ?? estimateEmbeddingTokens(truncatedText)
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
        cleanupEmbeddingCache(this.cache);
        return patchedResult;
      }
      return null;
    } catch (fallbackError) {
      const errorMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      process.stderr.write(`❌ 경량 임베딩 fallback도 실패했습니다: ${errorMsg}\n`);
      return null;
    }
  }

  private validateInput(text: string): void {
    if (!text || text.trim().length === 0) {
      throw new Error('텍스트가 비어 있습니다');
    }
  }

}

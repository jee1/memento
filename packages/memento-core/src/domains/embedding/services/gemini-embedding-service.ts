/**
 * Google Gemini API를 사용한 임베딩 서비스
 * 텍스트를 벡터로 변환하고 유사도 검색 제공
 * OpenAI와 동일한 인터페이스를 제공하여 교체 가능
 */

import { GoogleGenAI } from '@google/genai';
import { mementoConfig } from '../../../shared/config/index.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { RetryManager } from '../../../infrastructure/scheduler/retry-manager.js';
import type { RetryConfig } from '../../../infrastructure/scheduler/retry-manager.js';
import { getRetryOptions } from '../../../shared/config/retry-options-loader.js';
import { logger, isCliQuiet } from '../../../shared/utils/logger.js';
import { MiniLMEmbeddingService } from './minilm-embedding-service.js';
import {
  cleanupEmbeddingCache,
  estimateEmbeddingTokens,
  generateEmbeddingCacheKey,
  rankSimilarEmbeddings,
  truncateEmbeddingText,
} from './embedding-helpers.js';

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
  private genAI: GoogleGenAI | null = null;
  private miniLMService: MiniLMEmbeddingService;
  private readonly model: string;
  private readonly maxTokens = 2048; // Gemini text-embedding-004 최대 토큰
  private embeddingCache: Map<string, GeminiEmbeddingResult> = new Map(); // 임베딩 캐시
  private readonly retryManager: RetryManager;

  constructor() {
    this.miniLMService = new MiniLMEmbeddingService();
    this.model = mementoConfig.geminiModel;
    
    // RetryManager 초기화 (embedding_api 설정 사용)
    const retryOptions = getRetryOptions();
    const retryConfig: RetryConfig = {
      ...retryOptions.embedding_api,
      maxErrorCount: retryOptions.default.maxErrorCount
    };
    this.retryManager = new RetryManager(retryConfig);
    
    this.initializeGemini();
  }

  /**
   * Gemini 클라이언트 초기화
   */
  private initializeGemini(): void {
    if (!mementoConfig.geminiApiKey) {
      // 경고 로그는 MCP 프로토콜 준수를 위해 출력하지 않음
      return;
    }

    try {
      this.genAI = new GoogleGenAI({ apiKey: mementoConfig.geminiApiKey });
      // 초기화 로그는 MCP 프로토콜 준수를 위해 출력하지 않음
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!isCliQuiet()) {
        process.stderr.write(
          `❌ Gemini 초기화 실패. GEMINI_API_KEY 값과 네트워크 접근 권한을 확인하거나 MiniLM 모델을 사용하세요: ${errorMsg}\n`
        );
      }
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
    const cacheKey = generateEmbeddingCacheKey('gemini_embedding', text, true);
    const cached = this.embeddingCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. Gemini가 사용 가능한 경우
    if (this.genAI || mementoConfig.geminiApiKey) {
      try {
        if (!this.genAI && mementoConfig.geminiApiKey) {
          this.initializeGemini();
        }

        if (!this.genAI) {
          throw new Error('Gemini 클라이언트가 초기화되지 않았습니다');
        }

        // 토큰 수 제한 확인
        const truncatedText = truncateEmbeddingText(text, this.maxTokens);
        
        // RetryManager를 사용하여 외부 API 호출 재시도
        const retryOptions = getRetryOptions();
        const result = await this.retryManager.retry(
          async () => {
            return await this.genAI!.models.embedContent({
              model: this.model,
              contents: [{ parts: [{ text: truncatedText }] }],
              config: {
                outputDimensionality: mementoConfig.embeddingDimensions
              }
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
              logger.warn('Gemini 임베딩 API 호출 재시도', {
                attempt,
                delay,
                error: error.message,
                model: this.model
              });
            }
          }
        );
        
        const embedding = result.embeddings?.[0]?.values;
        if (!embedding || embedding.length === 0) {
          throw new Error('임베딩 생성에 실패했습니다');
        }
        
        const embeddingResult = {
          embedding: Array.from(embedding) as number[],
          model: this.model,
          usage: {
            prompt_tokens: estimateEmbeddingTokens(truncatedText),
            total_tokens: estimateEmbeddingTokens(truncatedText),
          },
        };

        // 캐시에 저장
        this.embeddingCache.set(cacheKey, embeddingResult);
        cleanupEmbeddingCache(this.embeddingCache);
        
        return embeddingResult;
      } catch (error) {
        const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
        if (!isCliQuiet()) process.stderr.write(`⚠️ Gemini 임베딩 실패, MiniLM 서비스로 fallback: ${maskedError.message}\n`);
        // Gemini 실패 시 MiniLM 서비스로 fallback
      }
    }

    // 3. Gemini가 없거나 실패한 경우 MiniLM 서비스 사용
    if (!isCliQuiet()) process.stderr.write('🔄 MiniLM 임베딩 서비스 사용\n');
    try {
      const miniLMResult = await this.miniLMService.generateEmbedding(text);
      if (!miniLMResult) {
        return null;
      }

      const result = {
        embedding: miniLMResult.embedding,
        model: miniLMResult.model,
        usage: miniLMResult.usage,
      };

      // 캐시에 저장
      this.embeddingCache.set(cacheKey, result);
      cleanupEmbeddingCache(this.embeddingCache);
      
      return result;
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      if (!isCliQuiet()) process.stderr.write(`❌ MiniLM 임베딩 생성 실패: ${maskedError.message}\n`);
      throw new Error(`임베딩 생성 실패: ${maskedError.message}`);
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

    return rankSimilarEmbeddings(queryEmbedding.embedding, embeddings, limit, threshold, {
      nanAsZero: true,
    });
  }

  /**
   * 서비스 사용 가능 여부 확인
   * Gemini API가 실제로 초기화되어 사용 가능한 경우에만 true 반환
   * (fallback인 miniLM은 별도로 확인하지 않음)
   */
  isAvailable(): boolean {
    return this.genAI !== null;
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
      return this.miniLMService.getModelInfo();
    }
  }
}

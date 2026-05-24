import type { GoogleGenerativeAI } from '@google/generative-ai';
import { resolveLlmModel } from '../../../../shared/config/llm-model-resolver.js';
import { getRetryOptions } from '../../../../shared/config/retry-options-loader.js';
import { LIMITS } from '../../../../shared/constants/relation-constants.js';
import { logger } from '../../../../shared/utils/logger.js';
import type { IRetryManager } from '../../../../shared/interfaces/retry-manager.interface.js';
import type { ParseResult } from './types.js';
import type { TokenBucketRateLimiter } from './token-bucket-rate-limiter.js';

export interface GeminiRelationExtractDeps {
  rateLimiter: TokenBucketRateLimiter;
  retryManager: IRetryManager;
  calculateAndLogCost: (
    provider: 'gemini',
    promptTokens: number,
    completionTokens: number
  ) => number;
  parseLlmRelationsResponse: (text: string) => ParseResult;
}

export async function extractRelationsWithGemini(
  geminiClient: GoogleGenerativeAI,
  prompt: string,
  deps: GeminiRelationExtractDeps
): Promise<ParseResult> {
    if (!geminiClient) {
      throw new Error('Gemini 클라이언트가 초기화되지 않았습니다.');
    }

    // Rate limit 확인
    await deps.rateLimiter.consume();

    try {
      const modelName = resolveLlmModel('gemini', 'relation_extraction');
      const retryOptions = getRetryOptions();
      const result = await deps.retryManager.retry(
        async () => {
          const model = geminiClient!.getGenerativeModel({ model: modelName });
          return await model.generateContent({
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: LIMITS.MAX_RESPONSE_TOKENS,
              responseMimeType: 'application/json'
            }
          });
        },
        {
          maxAttempts: retryOptions.external_api.maxAttempts,
          baseDelay: retryOptions.external_api.baseDelay,
          shouldRetry: (error: Error) => {
            const message = error.message.toLowerCase();
            return message.includes('network error') ||
                   message.includes('rate limit') ||
                   message.includes('server error') ||
                   message.includes('503') ||
                   message.includes('502') ||
                   message.includes('500');
          },
          onRetry: (error: Error, attempt: number, delay: number) => {
            logger.warn('Gemini LLM 호출 재시도', { attempt, delay, error: error.message, model: modelName });
          }
        }
      );

      const response = result.response;
      const text = response.text();
      if (!text) {
        throw new Error('Gemini 응답이 비어있습니다.');
      }

      // 비용 모니터링 (Gemini는 usage 정보를 직접 제공하지 않으므로 대략적 추정)
      const estimatedPromptTokens = Math.ceil(prompt.length / 4); // 대략적 추정
      const estimatedCompletionTokens = Math.ceil(text.length / 4);
      deps.calculateAndLogCost('gemini', estimatedPromptTokens, estimatedCompletionTokens);

      const parseResult = deps.parseLlmRelationsResponse(text);
      if (!parseResult.success) {
        // 파싱 실패 시 예외를 던져 호출자가 실패를 인지할 수 있도록 함
        throw new Error(`LLM 응답 파싱 실패: ${parseResult.error}`);
      }
      return parseResult;
    } catch (error) {
      logger.error('Gemini 호출 실패', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
}

import type OpenAI from 'openai';
import { mementoConfig } from '../../../../shared/config/index.js';
import { getRetryOptions } from '../../../../shared/config/retry-options-loader.js';
import { LIMITS } from '../../../../shared/constants/relation-constants.js';
import { logger } from '../../../../shared/utils/logger.js';
import type { IRetryManager } from '../../../../shared/interfaces/retry-manager.interface.js';
import type { ParseResult } from './types.js';
import type { TokenBucketRateLimiter } from './token-bucket-rate-limiter.js';

export interface OpenAiRelationExtractDeps {
  rateLimiter: TokenBucketRateLimiter;
  retryManager: IRetryManager;
  calculateAndLogCost: (
    provider: 'openai',
    promptTokens: number,
    completionTokens: number
  ) => number;
  parseLlmRelationsResponse: (text: string) => ParseResult;
}

export async function extractRelationsWithOpenAI(
  openaiClient: OpenAI,
  prompt: string,
  deps: OpenAiRelationExtractDeps
): Promise<ParseResult> {
    if (!openaiClient) {
      throw new Error('OpenAI 클라이언트가 초기화되지 않았습니다.');
    }

    // Rate limit 확인
    await deps.rateLimiter.consume();

    try {
      const model = mementoConfig.openaiLlmModel || 'gpt-4o-mini';
      const retryOptions = getRetryOptions();
      const response = await deps.retryManager.retry(
        async () => {
          return await openaiClient!.chat.completions.create({
            model,
            messages: [
              {
                role: 'system',
                content: 'You are a semantic relation analyzer. Analyze relationships between memories and return JSON format only.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3, // 일관성을 위해 낮은 temperature
            max_tokens: LIMITS.MAX_RESPONSE_TOKENS,
            response_format: { type: 'json_object' } // JSON 모드 강제
          });
        },
        {
          maxAttempts: retryOptions.external_api.maxAttempts,
          baseDelay: retryOptions.external_api.baseDelay,
          shouldRetry: (error: Error) => {
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
            logger.warn('OpenAI API 호출 재시도 (관계 추출)', {
              attempt,
              delay,
              error: error.message,
              model
            });
          }
        }
      );

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI 응답이 비어있습니다.');
      }

      // 비용 모니터링
      const promptTokens = response.usage?.prompt_tokens || 0;
      const completionTokens = response.usage?.completion_tokens || 0;
      deps.calculateAndLogCost('openai', promptTokens, completionTokens);

      const parseResult = deps.parseLlmRelationsResponse(content);
      if (!parseResult.success) {
        // 파싱 실패 시 예외를 던져 호출자가 실패를 인지할 수 있도록 함
        throw new Error(`LLM 응답 파싱 실패: ${parseResult.error}`);
      }
      return parseResult;
    } catch (error) {
      logger.error('OpenAI 호출 실패', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
}

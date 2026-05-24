import { mementoConfig } from '../../../../shared/config/index.js';
import { resolveLlmModel } from '../../../../shared/config/llm-model-resolver.js';
import { LIMITS } from '../../../../shared/constants/relation-constants.js';
import { logger } from '../../../../shared/utils/logger.js';
import type { IRetryManager } from '../../../../shared/interfaces/retry-manager.interface.js';
import type { ParseResult } from './types.js';
import type { TokenBucketRateLimiter } from './token-bucket-rate-limiter.js';
import {
  buildOllamaErrorLogContext,
  checkOllamaModel,
  parseOllamaChatResponsePayload
} from './ollama-chat-support.js';
import { prepareOllamaRelationJsonContent } from './llm-response-parse.js';

export interface OllamaRelationExtractDeps {
  rateLimiter: TokenBucketRateLimiter;
  retryManager: IRetryManager;
  calculateAndLogCost: (
    provider: 'ollama',
    promptTokens: number,
    completionTokens: number
  ) => number;
  parseLlmRelationsResponse: (text: string) => ParseResult;
}

export async function extractRelationsWithOllama(
  prompt: string,
  deps: OllamaRelationExtractDeps
): Promise<ParseResult> {
    await deps.rateLimiter.consume();

    const baseUrl = mementoConfig.ollamaBaseUrl || 'http://localhost:11434';
    const model = resolveLlmModel('ollama', 'relation_extraction');

    // Ollama API 요청 준비 (에러 로깅을 위해 함수 스코프 밖에 선언)
    const requestBody = {
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
      options: {
        temperature: 0.3,
        num_predict: LIMITS.MAX_RESPONSE_TOKENS
      },
      format: 'json' as const // JSON 형식 강제
    };

    try {
      // 모델 존재 여부 확인
      const modelExists = await checkOllamaModel(deps.retryManager, baseUrl, model);
      if (!modelExists) {
        throw new Error(
          `Ollama 모델 '${model}'이 설치되지 않았습니다. ` +
          `다음 명령어로 모델을 설치하세요: ollama pull ${model}`
        );
      }
      
      // Ollama API 호출
      const apiUrl = `${baseUrl}/api/chat`;
      
      let response: Response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(60000) // 60초 타임아웃
        });
      } catch (fetchError) {
        logger.error('Ollama API fetch 실패', {
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
          url: apiUrl,
          baseUrl,
          model,
          ...buildOllamaErrorLogContext(requestBody, prompt)
        });
        throw fetchError;
      }

      if (!response.ok) {
        let errorText = '';
        try {
          errorText = await response.text();
          logger.error('Ollama API 에러 응답', {
            status: response.status,
            statusText: response.statusText,
            errorText,
            url: apiUrl
          });
        } catch (textError) {
          logger.error('Ollama API 에러 응답 텍스트 읽기 실패', {
            status: response.status,
            statusText: response.statusText,
            textError: textError instanceof Error ? textError.message : String(textError)
          });
        }
        
        let errorMessage = `Ollama API 호출 실패: ${response.status} ${response.statusText}`;
        
        if (response.status === 404) {
          errorMessage = `Ollama 모델 '${model}'을 찾을 수 없습니다. 모델이 설치되어 있는지 확인하세요: ollama pull ${model}`;
        } else if (errorText) {
          try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.error || errorMessage;
          } catch {
            // JSON 파싱 실패 시 원본 에러 메시지 사용
            errorMessage = errorText || errorMessage;
          }
        }
        
        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type') || '';
      const isNDJSON =
        contentType.includes('application/x-ndjson') || contentType.includes('ndjson');
      const headerRecord = Object.fromEntries(response.headers.entries());

      let responseText = '';
      let data: Record<string, unknown>;
      let content = '';
      try {
        responseText = await response.text();
        const parsed = parseOllamaChatResponsePayload(responseText, contentType, {
          status: response.status,
          statusText: response.statusText,
          headers: headerRecord
        });
        data = parsed.data;
        content = parsed.content;
      } catch (textError) {
        logger.error('Ollama API 응답 본문 읽기 실패', {
          textError: textError instanceof Error ? textError.message : String(textError),
          status: response.status,
          statusText: response.statusText,
          headers: headerRecord,
          contentType,
          isNDJSON,
          responseTextLength: responseText.length,
          responseTextPreview: responseText.substring(0, 500),
          responseTextFull: responseText
        });
        throw textError;
      }

      if (!content && data.message && typeof data.message === 'object' && data.message !== null) {
        const mc = (data.message as { content?: unknown }).content;
        if (typeof mc === 'string') {
          content = mc;
        }
      }

      if (!content) {
        logger.error('Ollama 응답이 비어있습니다', {
          status: response.status,
          statusText: response.statusText,
          headers: headerRecord,
          contentType,
          isNDJSON,
          responseTextLength: responseText.length,
          responseTextPreview: responseText.substring(0, 500),
          responseTextFull: responseText,
          fullResponse: data
        });
        throw new Error('Ollama 응답이 비어있습니다.');
      }

      const promptTokens =
        typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : 0;
      const completionTokens = typeof data.eval_count === 'number' ? data.eval_count : 0;
      deps.calculateAndLogCost('ollama', promptTokens, completionTokens);

      const finalJson = prepareOllamaRelationJsonContent(content);

      const parseResult = deps.parseLlmRelationsResponse(finalJson);
      if (!parseResult.success) {
        logger.error('Ollama 응답 파싱 실패', {
          error: parseResult.error,
          contentLength: content.length,
          finalLength: finalJson.length,
          contentPreview: content.substring(0, 500),
          finalPreview: finalJson.substring(0, 500),
          contentFull:
            content.length < 2000
              ? content
              : content.substring(0, 1000) + '...' + content.substring(content.length - 1000),
          model: mementoConfig.ollamaModel,
          baseUrl: mementoConfig.ollamaBaseUrl,
          ...buildOllamaErrorLogContext(requestBody, prompt),
          responseTextLength: responseText.length,
          responseTextPreview: responseText.substring(0, 500),
          responseTextFull: responseText,
          contentType,
          isNDJSON,
          status: response.status,
          statusText: response.statusText,
          headers: headerRecord
        });
        throw new Error(`LLM 응답 파싱 실패: ${parseResult.error}`);
      }
      return parseResult;
    } catch (error) {
      logger.error('Ollama 호출 실패', {
        error: error instanceof Error ? error.message : String(error),
        baseUrl: mementoConfig.ollamaBaseUrl,
        model: mementoConfig.ollamaModel,
        ...buildOllamaErrorLogContext(requestBody, prompt)
      });
      throw error;
    }
}

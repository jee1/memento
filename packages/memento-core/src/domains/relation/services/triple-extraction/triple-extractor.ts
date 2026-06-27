/**
 * Triple 추출기 클래스
 * LLM을 사용하여 텍스트에서 Triple을 추출합니다.
 * 
 * Given: 텍스트와 추출 옵션이 제공됨
 * When: LLM을 사용하여 Triple을 추출함
 * Then: 추출된 Triple 배열을 반환함
 */

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { mementoConfig } from '../../../../shared/config/index.js';
import { resolveLlmModel } from '../../../../shared/config/llm-model-resolver.js';
import { PromptTemplateLoader } from '../../../../shared/utils/prompt-template-loader.js';
import { logger } from '../../../../shared/utils/logger.js';
import type { IRetryManager } from '../../../../shared/interfaces/retry-manager.interface.js';
import { getRetryOptions } from '../../../../shared/config/retry-options-loader.js';
import { LLMClientInitializer } from '../../../../shared/services/llm-client-initializer.js';
import type { LLMClientInitializationResult } from '../../../../shared/services/llm-client-initializer.js';
import type { ITripleExtractor } from './interfaces.js';
import type { Triple, TripleExtractionOptions } from '../../../../shared/types/triple-extraction.js';
import { RelationRetryManager } from '../relation-retry-manager.js';

/**
 * Triple 추출기 클래스
 * LLM을 사용하여 텍스트에서 Triple을 추출합니다.
 */
export class TripleExtractor implements ITripleExtractor {
  private openaiClient: OpenAI | null = null;
  private geminiClient: GoogleGenerativeAI | null = null;
  private preferredProvider: 'openai' | 'gemini' | 'ollama' | null = null;
  private initializedProviders: ('openai' | 'gemini' | 'ollama')[] = [];
  private readonly retryManager: IRetryManager;
  private initializationPromise: Promise<void> | null = null;

  // 기본 설정
  private readonly DEFAULT_TEMPERATURE = 0.3;
  private readonly DEFAULT_MAX_TOKENS = 2000;
  private readonly SYSTEM_MESSAGE = 'You are a knowledge graph extractor. Extract triples (subject, predicate, object) from observations and return JSON format only.';

  constructor(retryManager?: IRetryManager) {
    this.initializationPromise = this.initializeClients();
    const retryOptions = getRetryOptions();
    this.retryManager = retryManager ?? new RelationRetryManager({
      maxAttempts: retryOptions.external_api.maxAttempts,
      baseDelay: retryOptions.external_api.baseDelay,
    });
  }

  /**
   * Given: 텍스트와 추출 옵션이 제공됨
   * When: LLM을 사용하여 Triple을 추출함
   * Then: 추출된 Triple 배열과 rawResponse, provider를 반환함
   * 
   * @param text - 추출할 텍스트
   * @param options - 추출 옵션
   * @returns 추출된 Triple 배열과 메타데이터
   */
  async extract(
    text: string,
    options?: TripleExtractionOptions
  ): Promise<{
    triples: Triple[];
    rawResponse: string;
    provider: 'openai' | 'gemini' | 'ollama';
  }> {
    // 초기화 완료 대기
    if (this.initializationPromise) {
      await this.initializationPromise;
    }

    // 프롬프트 템플릿 로드 및 렌더링
    const prompt = PromptTemplateLoader.loadAndRender('triple-extraction', {
      observation: text
    });

    // Provider 선택
    const requestedProvider = options?.provider === 'auto' || !options?.provider
      ? 'auto'
      : options.provider;
    const provider = this.determineProvider(requestedProvider);

    if (!provider) {
      throw new Error('사용 가능한 LLM Provider가 없습니다.');
    }

    try {
      // Provider에 따라 추출 수행
      const rawLLMOutput = await this.extractWithProvider(provider, prompt, options);

      // JSON 파싱 및 Triple 추출
      const parseResult = this.parseLLMResponse(rawLLMOutput);
      if (!parseResult.success) {
        // 파싱 실패 시 빈 배열 반환
        return {
          triples: [],
          rawResponse: rawLLMOutput,
          provider
        };
      }

      return {
        triples: parseResult.triples,
        rawResponse: rawLLMOutput,
        provider
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('TripleExtractor: LLM 호출 실패', {
        error: errorMessage,
        provider
      });
      throw error;
    }
  }

  /**
   * Provider에 따라 LLM을 사용하여 Triple 추출
   * 
   * @param provider 사용할 provider
   * @param prompt 프롬프트
   * @param options 추출 옵션
   * @returns LLM 응답 텍스트
   */
  private async extractWithProvider(
    provider: 'openai' | 'gemini' | 'ollama',
    prompt: string,
    options?: TripleExtractionOptions
  ): Promise<string> {
    switch (provider) {
      case 'openai':
        return await this.extractWithOpenAI(prompt, options);
      case 'gemini':
        return await this.extractWithGemini(prompt, options);
      case 'ollama':
        return await this.extractWithOllama(prompt, options);
      default:
        throw new Error(`지원하지 않는 LLM Provider: ${provider}`);
    }
  }

  /**
   * OpenAI를 사용하여 Triple 추출
   */
  private async extractWithOpenAI(
    prompt: string,
    options?: TripleExtractionOptions
  ): Promise<string> {
    if (!this.openaiClient) {
      throw new Error('OpenAI 클라이언트가 초기화되지 않았습니다.');
    }

    const model = resolveLlmModel('openai', 'triple_extraction');
    const temperature = options?.temperature ?? this.DEFAULT_TEMPERATURE;
    const maxTokens = options?.maxTokens ?? this.DEFAULT_MAX_TOKENS;
    const retryOptions = getRetryOptions();

    const response = await this.retryManager.retry(
      async () => {
        return await this.openaiClient!.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: this.SYSTEM_MESSAGE },
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' }
        });
      },
      {
        maxAttempts: retryOptions.external_api.maxAttempts,
        baseDelay: retryOptions.external_api.baseDelay,
        shouldRetry: this.shouldRetry,
        onRetry: (error: Error, attempt: number, delay: number) => {
          logger.warn('TripleExtractor: OpenAI API 호출 재시도', {
            attempt, delay, error: error.message, model
          });
        }
      }
    );

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI 응답이 비어있습니다.');
    }
    return content;
  }

  /**
   * Gemini를 사용하여 Triple 추출
   */
  private async extractWithGemini(
    prompt: string,
    options?: TripleExtractionOptions
  ): Promise<string> {
    if (!this.geminiClient) {
      throw new Error('Gemini 클라이언트가 초기화되지 않았습니다.');
    }

    const modelName = resolveLlmModel('gemini', 'triple_extraction');
    const model = this.geminiClient.getGenerativeModel({ model: modelName });
    const temperature = options?.temperature ?? this.DEFAULT_TEMPERATURE;
    const maxTokens = options?.maxTokens ?? this.DEFAULT_MAX_TOKENS;
    const retryOptions = getRetryOptions();

    const result = await this.retryManager.retry(
      async () => {
        return await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
            responseMimeType: 'application/json'
          }
        });
      },
      {
        maxAttempts: retryOptions.external_api.maxAttempts,
        baseDelay: retryOptions.external_api.baseDelay,
        shouldRetry: this.shouldRetry,
        onRetry: (error: Error, attempt: number, delay: number) => {
          logger.warn('TripleExtractor: Gemini API 호출 재시도', {
            attempt, delay, error: error.message, model: modelName
          });
        }
      }
    );

    const text = result.response.text();
    if (!text) {
      throw new Error('Gemini 응답이 비어있습니다.');
    }
    return text;
  }

  /**
   * Ollama를 사용하여 Triple 추출
   */
  private async extractWithOllama(
    prompt: string,
    options?: TripleExtractionOptions
  ): Promise<string> {
    const baseUrl = mementoConfig.ollamaBaseUrl || 'http://localhost:11434';
    const model = resolveLlmModel('ollama', 'triple_extraction');
    const temperature = options?.temperature ?? this.DEFAULT_TEMPERATURE;
    const maxTokens = options?.maxTokens ?? this.DEFAULT_MAX_TOKENS;

    const requestBody = {
      model,
      messages: [
        { role: 'system', content: this.SYSTEM_MESSAGE },
        { role: 'user', content: prompt }
      ],
      options: { temperature, num_predict: maxTokens },
      format: 'json' as const
    };

    // Ollama 모델 존재 여부 확인
    const modelExists = await this.checkOllamaModel(baseUrl, model);
    if (!modelExists) {
      throw new Error(
        `Ollama 모델 '${model}'이 설치되지 않았습니다. ` +
        `다음 명령어로 모델을 설치하세요: ollama pull ${model}`
      );
    }

    const retryOptions = getRetryOptions();
    const apiUrl = `${baseUrl}/api/chat`;
    const response = await this.retryManager.retry(
      async () => {
        const fetchResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(60000)
        });

        if (!fetchResponse.ok) {
          const errorText = await fetchResponse.text().catch(() => '');
          throw new Error(`Ollama API 호출 실패: ${fetchResponse.status} ${fetchResponse.statusText}${errorText ? ` - ${errorText}` : ''}`);
        }

        return fetchResponse;
      },
      {
        maxAttempts: retryOptions.external_api.maxAttempts,
        baseDelay: retryOptions.external_api.baseDelay,
        shouldRetry: (error: Error) => {
          return this.shouldRetry(error) ||
                 error.message.toLowerCase().includes('econnrefused') ||
                 error.message.toLowerCase().includes('enotfound');
        },
        onRetry: (error: Error, attempt: number, delay: number) => {
          logger.warn('TripleExtractor: Ollama API 호출 재시도', {
            attempt,
            delay,
            error: error.message,
            baseUrl,
            model
          });
        }
      }
    );

    // NDJSON 형식 처리
    const contentType = response.headers.get('content-type') || '';
    const isNDJSON = contentType.includes('application/x-ndjson') || contentType.includes('ndjson');

    let content = '';
    const responseText = await response.text();

    if (isNDJSON) {
      const lines = responseText.trim().split('\n').filter(line => line.trim().length > 0);
      const contentParts: string[] = [];

      for (const line of lines) {
        try {
          const lineData = JSON.parse(line);
          if (lineData.message?.content) {
            contentParts.push(lineData.message.content);
          }
          if (lineData.done === true) {
            break;
          }
        } catch {
          // 라인 파싱 실패 시 무시
        }
      }
      content = contentParts.join('');
    } else {
      const data = JSON.parse(responseText);
      content = data.message?.content || '';
    }

    if (!content) {
      throw new Error('Ollama 응답이 비어있습니다.');
    }

    return content;
  }

  /**
   * LLM 클라이언트 초기화
   * LLMClientInitializer를 사용하여 클라이언트 초기화
   */
  private async initializeClients(): Promise<void> {
    const initializer = new LLMClientInitializer();
    const result: LLMClientInitializationResult = await initializer.initialize();
    
    // LLMClientInitializer 결과를 사용하여 클라이언트 설정
    this.openaiClient = result.openaiClient;
    this.geminiClient = result.geminiClient;
    this.preferredProvider = result.preferredProvider;
    this.initializedProviders = result.initializedProviders;
    
    // 경고 메시지 로깅
    if (result.warnings.length > 0 && result.preferredProvider === null) {
      result.warnings.forEach((warning) => {
        logger.warn('LLM 초기화 경고', { warning });
      });
    }
    
    // 초기화 완료 로깅
    if (result.preferredProvider) {
      logger.info('TripleExtractor: LLM 클라이언트 초기화 완료', {
        preferredProvider: result.preferredProvider,
        initializedProviders: result.initializedProviders
      });
    } else {
      logger.error('TripleExtractor: LLM 클라이언트 초기화 실패 - 모든 provider가 사용 불가능합니다');
    }
  }

  /**
   * Provider 결정
   * 요청된 provider와 초기화 상태를 확인하여 사용 가능한 provider를 반환
   * 
   * @param requestedProvider 요청된 provider
   * @returns 사용 가능한 provider 또는 null
   */
  private determineProvider(
    requestedProvider: 'openai' | 'gemini' | 'ollama' | 'auto'
  ): 'openai' | 'gemini' | 'ollama' | null {
    // 'auto' 모드: 사용 가능한 첫 번째 provider 반환
    if (requestedProvider === 'auto') {
      if (this.openaiClient) return 'openai';
      if (this.geminiClient) return 'gemini';
      // Ollama는 연결 테스트가 필요하므로 여기서는 null 반환
      // (실제 사용 시 extractWithOllama에서 처리)
      return null;
    }
    
    // 요청된 provider가 사용 가능한지 확인
    if (this.isProviderAvailable(requestedProvider)) {
      return requestedProvider;
    }
    
    // Fallback 로직: 요청된 provider가 사용 불가능한 경우 대체 provider 시도
    return this.getFallbackProvider(requestedProvider);
  }

  /**
   * Provider 사용 가능 여부 확인
   */
  private isProviderAvailable(provider: 'openai' | 'gemini' | 'ollama'): boolean {
    switch (provider) {
      case 'openai':
        return this.openaiClient !== null;
      case 'gemini':
        return this.geminiClient !== null;
      case 'ollama':
        return this.initializedProviders.includes('ollama');
      default:
        return false;
    }
  }

  /**
   * Fallback provider 반환
   */
  private getFallbackProvider(
    requestedProvider: 'openai' | 'gemini' | 'ollama'
  ): 'openai' | 'gemini' | 'ollama' | null {
    switch (requestedProvider) {
      case 'openai':
        // OpenAI가 사용 불가능하면 Gemini로 fallback
        return this.geminiClient ? 'gemini' : null;
      case 'gemini':
        // Gemini가 사용 불가능하면 OpenAI로 fallback
        return this.openaiClient ? 'openai' : null;
      case 'ollama':
        // Ollama가 사용 불가능하면 OpenAI -> Gemini 순서로 fallback
        if (this.openaiClient) return 'openai';
        if (this.geminiClient) return 'gemini';
        return null;
      default:
        return null;
    }
  }

  /**
   * 에러 재시도 여부 판단
   */
  private shouldRetry(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('network') ||
           message.includes('timeout') ||
           message.includes('rate limit') ||
           message.includes('server error') ||
           message.includes('503') ||
           message.includes('502') ||
           message.includes('500');
  }

  /**
   * Ollama 모델 존재 여부 확인
   */
  private async checkOllamaModel(baseUrl: string, model: string): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      const models = data.models || [];
      return (models as Array<{ name: string }>).some((m) => m.name === model || m.name.startsWith(`${model}:`));
    } catch {
      return false;
    }
  }

  /**
   * Given: LLM 응답 텍스트가 제공됨
   * When: 응답을 파싱하여 Triple 배열을 추출함
   * Then: 파싱된 Triple 배열과 파싱 결과를 반환함
   */
  private parseLLMResponse(responseText: string): {
    success: boolean;
    triples: Triple[];
    error?: string;
    errorType?: 'parse' | 'structure' | 'no_triple';
  } {
    try {
      const jsonText = this.extractJSON(responseText) || responseText.trim();
      const parsed = JSON.parse(jsonText);
      if (!parsed.triples || !Array.isArray(parsed.triples)) {
        return { success: false, triples: [], error: 'triples 배열이 없거나 유효하지 않습니다.', errorType: 'parse' };
      }
      const validTriples = parsed.triples
        .filter((t: unknown) => this.isValidTriple(t))
        .map((t: unknown) => ({
          subject: String((t as Record<string, unknown>)['subject']).trim(),
          predicate: String((t as Record<string, unknown>)['predicate']).trim(),
          object: String((t as Record<string, unknown>)['object']).trim()
        }));
      if (validTriples.length === 0 && parsed.triples.length > 0) {
        return { success: false, triples: [], error: '모든 triple이 유효하지 않습니다.', errorType: 'no_triple' };
      }
      const invalidRatio = (parsed.triples.length - validTriples.length) / parsed.triples.length;
      if (invalidRatio > 0.5 && parsed.triples.length > 1) {
        return {
          success: true,
          triples: validTriples,
          error: `일부 triple이 유효하지 않습니다. (유효: ${validTriples.length}/${parsed.triples.length})`,
          errorType: 'structure'
        };
      }
      return { success: true, triples: validTriples };
    } catch (error) {
      return {
        success: false,
        triples: [],
        error: error instanceof Error ? error.message : 'JSON 파싱 실패',
        errorType: 'parse'
      };
    }
  }

  /**
   * Given: 텍스트가 제공됨
   * When: JSON 부분을 추출함
   * Then: 추출된 JSON 문자열을 반환함
   */
  private extractJSON(text: string): string | null {
    if (!text || typeof text !== 'string') return null;
    let jsonText = text.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```.*$/s, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```.*$/s, '');
    }
    const firstBrace = jsonText.indexOf('{');
    const lastBrace = jsonText.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    return jsonText.substring(firstBrace, lastBrace + 1).trim();
  }

  /**
   * Given: Triple 객체가 제공됨
   * When: Triple의 유효성을 검증함
   * Then: 유효성 검증 결과를 반환함
   */
  private isValidTriple(triple: unknown): boolean {
    if (!triple || typeof triple !== 'object') return false;
    const t = triple as Record<string, unknown>;
    return (
      typeof t['subject'] === 'string' &&
      typeof t['predicate'] === 'string' &&
      typeof t['object'] === 'string' &&
      t['subject'].trim().length > 0 &&
      t['predicate'].trim().length > 0 &&
      t['object'].trim().length > 0
    );
  }
}

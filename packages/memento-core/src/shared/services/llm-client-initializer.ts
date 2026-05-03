/**
 * LLM 클라이언트 초기화 공통 모듈
 * 
 * 모든 LLM 서비스에서 일관된 초기화 로직과 fallback 전략을 제공합니다.
 * 
 * 환경 변수 우선순위:
 * 1. process.env['LLM_PROVIDER'] (최우선)
 * 2. mementoConfig.llmProvider (차순위)
 * 3. 'auto' (최종 기본값)
 */

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { mementoConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { getRawEnvValue } from '../config/environment.js';
import type { LLMProvider } from '../types/index.js';
import { RetryManager } from '../../infrastructure/scheduler/retry-manager.js';
import type { RetryConfig } from '../../infrastructure/scheduler/retry-manager.js';
import { getRetryOptions } from '../config/retry-options-loader.js';

/**
 * LLM 클라이언트 초기화 결과
 */
export interface LLMClientInitializationResult {
  /** 선택된 provider (null이면 사용 가능한 provider 없음) */
  preferredProvider: 'openai' | 'gemini' | 'ollama' | null;
  /** OpenAI 클라이언트 인스턴스 (초기화 실패 시 null) */
  openaiClient: OpenAI | null;
  /** Gemini 클라이언트 인스턴스 (초기화 실패 시 null) */
  geminiClient: GoogleGenerativeAI | null;
  /** 성공적으로 초기화된 provider 목록 */
  initializedProviders: ('openai' | 'gemini' | 'ollama')[];
  /** 초기화 과정에서 발생한 경고 메시지 목록 */
  warnings: string[];
}

/**
 * LLM 클라이언트 초기화기
 * 
 * 환경 변수 설정에 따라 LLM provider를 초기화하고,
 * 실패 시 자동으로 fallback을 수행합니다.
 */
export class LLMClientInitializer {
  private readonly retryManager: RetryManager;

  /**
   * 생성자
   * RetryManager를 초기화합니다.
   */
  constructor() {
    const retryOptions = getRetryOptions();
    const retryConfig: RetryConfig = {
      ...retryOptions.external_api,
      maxErrorCount: retryOptions.default.maxErrorCount
    };
    this.retryManager = new RetryManager(retryConfig);
  }

  /**
   * LLM 클라이언트 초기화
   * 
   * 환경 변수 우선순위에 따라 provider를 선택하고 초기화합니다.
   * 
   * 환경 변수 우선순위:
   * 1. process.env['LLM_PROVIDER'] (최우선) - getRawEnvValue('LLM_PROVIDER') 사용
   * 2. mementoConfig.llmProvider (차순위)
   * 3. 'auto' (최종 기본값)
   * 
   * @returns LLMClientInitializationResult 초기화 결과
   */
  async initialize(): Promise<LLMClientInitializationResult> {
    // 기본값 설정
    const result: LLMClientInitializationResult = {
      preferredProvider: null,
      openaiClient: null,
      geminiClient: null,
      initializedProviders: [],
      warnings: []
    };

    // 환경 변수 우선순위에 따라 provider 선택
    const selectedProvider = this.getSelectedProvider();

    // 클라이언트 초기화
    result.openaiClient = this.initializeOpenAI(result, selectedProvider);
    result.geminiClient = this.initializeGemini(result, selectedProvider);

    // Ollama 연결 테스트 (필요한 경우에만)
    if (selectedProvider === 'ollama' || selectedProvider === 'auto') {
      await this.testOllamaConnection(result, selectedProvider);
    }

    // preferredProvider 설정
    result.preferredProvider = this.determinePreferredProvider(
      result,
      selectedProvider
    );

    logger.info('LLM provider initialized', {
      preferredProvider: result.preferredProvider,
      llmModel: this.resolveLlmModelLabel(result.preferredProvider),
      initializedProviders: result.initializedProviders,
    });

    return result;
  }

  /**
   * 각 provider의 API 키 존재 여부를 확인
   * 
   * @returns 각 provider의 API 키 존재 여부를 나타내는 boolean 객체
   */
  validateApiKeys(): { openai: boolean; gemini: boolean } {
    return {
      openai: !!mementoConfig.openaiApiKey,
      gemini: !!mementoConfig.geminiApiKey
    };
  }

  /**
   * 명시 LLM_PROVIDER일 때만 해당 클라우드 키 부재를 경고한다.
   * ollama 전용 등으로 다른 provider를 쓰지 않는 경우 불필요한 WARN 로그를 막는다. auto는 탐색 목적상 기존과 같이 경고.
   */
  private shouldWarnMissingOpenaiKey(selectedProvider: LLMProvider): boolean {
    return selectedProvider === 'openai' || selectedProvider === 'auto';
  }

  private shouldWarnMissingGeminiKey(selectedProvider: LLMProvider): boolean {
    return selectedProvider === 'gemini' || selectedProvider === 'auto';
  }

  private resolveLlmModelLabel(provider: LLMClientInitializationResult['preferredProvider']): string {
    if (provider === 'openai') return mementoConfig.openaiLlmModel ?? 'gpt-4o-mini';
    if (provider === 'ollama') return mementoConfig.ollamaModel;
    if (provider === 'gemini') return 'gemini (API key only)';
    return 'none';
  }

  /**
   * 환경 변수 우선순위에 따라 provider 선택
   *
   * @returns 선택된 provider
   */
  private getSelectedProvider(): LLMProvider {
    const envProvider = getRawEnvValue('LLM_PROVIDER');
    return (envProvider as LLMProvider) || mementoConfig.llmProvider || 'auto';
  }

  /**
   * 에러 메시지 추출
   * 
   * @param error 에러 객체
   * @returns 에러 메시지 문자열
   */
  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * 경고 메시지 추가 및 로깅
   * 
   * @param result 초기화 결과 객체
   * @param warningMessage 경고 메시지
   * @param logMessage 로그 메시지
   * @param metadata 로그 메타데이터
   */
  private addWarning(
    result: LLMClientInitializationResult,
    warningMessage: string,
    logMessage: string,
    metadata: Record<string, unknown>
  ): void {
    result.warnings.push(warningMessage);
    logger.warn(logMessage, metadata);
  }

  /**
   * OpenAI 클라이언트 초기화
   * 
   * @param result 초기화 결과 객체
   * @param selectedProvider 선택된 provider
   * @returns OpenAI 클라이언트 인스턴스 또는 null
   */
  private initializeOpenAI(
    result: LLMClientInitializationResult,
    selectedProvider: LLMProvider
  ): OpenAI | null {
    if (!mementoConfig.openaiApiKey) {
      if (this.shouldWarnMissingOpenaiKey(selectedProvider)) {
        const warningMessage = 'OPENAI_API_KEY가 없습니다.';
        this.addWarning(
          result,
          warningMessage,
          'OpenAI API 키가 없어 초기화를 건너뜁니다.',
          {
            requestedProvider: selectedProvider,
            reason: warningMessage
          }
        );
      }
      return null;
    }

    try {
      const client = new OpenAI({ apiKey: mementoConfig.openaiApiKey });
      result.initializedProviders.push('openai');
      return client;
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      const warningMessage = `OpenAI 클라이언트 초기화 실패: ${errorMessage}`;
      this.addWarning(
        result,
        warningMessage,
        'OpenAI 클라이언트 초기화 중 오류가 발생했습니다.',
        {
          requestedProvider: selectedProvider,
          reason: errorMessage
        }
      );
      return null;
    }
  }

  /**
   * Gemini 클라이언트 초기화
   * 
   * @param result 초기화 결과 객체
   * @param selectedProvider 선택된 provider
   * @returns Gemini 클라이언트 인스턴스 또는 null
   * 
   * @note
   * - `@google/generative-ai` 라이브러리를 사용합니다 (LLM completion용)
   * - 생성자에 API 키를 직접 전달하는 방식을 사용합니다: `new GoogleGenerativeAI(apiKey)`
   * - 참고: `gemini-embedding-service.ts`는 `@google/genai`를 사용하며 객체 전달 방식을 사용합니다
   * - 향후 `@google/genai`로 마이그레이션 검토 필요 (deprecated 예정: 2025-08-31)
   */
  private initializeGemini(
    result: LLMClientInitializationResult,
    selectedProvider: LLMProvider
  ): GoogleGenerativeAI | null {
    if (!mementoConfig.geminiApiKey) {
      if (this.shouldWarnMissingGeminiKey(selectedProvider)) {
        const warningMessage = 'GEMINI_API_KEY가 없습니다.';
        this.addWarning(
          result,
          warningMessage,
          'Gemini API 키가 없어 초기화를 건너뜁니다.',
          {
            requestedProvider: selectedProvider,
            reason: warningMessage
          }
        );
      }
      return null;
    }

    // 이 시점에서 geminiApiKey는 string 타입이 보장됨
    const apiKey: string = mementoConfig.geminiApiKey;

    try {
      const client = new GoogleGenerativeAI(apiKey);
      result.initializedProviders.push('gemini');
      return client;
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      const warningMessage = `Gemini 클라이언트 초기화 실패: ${errorMessage}`;
      this.addWarning(
        result,
        warningMessage,
        'Gemini 클라이언트 초기화 중 오류가 발생했습니다.',
        {
          requestedProvider: selectedProvider,
          reason: errorMessage
        }
      );
      return null;
    }
  }

  /**
   * Ollama 응답 처리
   * 
   * @param response HTTP 응답 객체
   * @param result 초기화 결과 객체
   * @param selectedProvider 선택된 provider
   * @param baseUrl Ollama base URL
   */
  private async handleOllamaResponse(
    response: Response,
    result: LLMClientInitializationResult,
    selectedProvider: LLMProvider,
    baseUrl: string
  ): Promise<void> {
    if (response.ok) {
      // JSON 파싱 시도
      try {
        await response.json();
        result.initializedProviders.push('ollama');
      } catch (jsonError) {
        const errorMessage = this.getErrorMessage(jsonError);
        const warningMessage = `Ollama 응답 JSON 파싱 실패: ${errorMessage}`;
        this.addWarning(
          result,
          warningMessage,
          'Ollama 응답 JSON 파싱 중 오류가 발생했습니다.',
          {
            requestedProvider: selectedProvider,
            baseUrl,
            reason: errorMessage
          }
        );
      }
    } else {
      // HTTP 비-200 응답 (4xx 에러는 재시도하지 않음)
      const warningMessage = `Ollama 서버 연결 실패: HTTP ${response.status} ${response.statusText}`;
      this.addWarning(
        result,
        warningMessage,
        'Ollama 서버 연결 실패',
        {
          requestedProvider: selectedProvider,
          baseUrl,
          status: response.status,
          statusText: response.statusText
        }
      );
    }
  }

  /**
   * Ollama 연결 테스트
   * 
   * @param result 초기화 결과 객체
   * @param selectedProvider 선택된 provider
   */
  private async testOllamaConnection(
    result: LLMClientInitializationResult,
    selectedProvider: LLMProvider
  ): Promise<void> {
    const baseUrl = mementoConfig.ollamaBaseUrl || 'http://localhost:11434';
    const retryOptions = getRetryOptions();

    try {
      const response = await this.retryManager.retry(
        async () => {
          const fetchResponse = await fetch(`${baseUrl}/api/tags`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000) // 5초 타임아웃
          });

          // HTTP 5xx 에러는 재시도, 4xx 에러는 재시도하지 않음
          if (!fetchResponse.ok && fetchResponse.status >= 500) {
            const errorText = await fetchResponse.text().catch(() => '');
            throw new Error(`Ollama 서버 에러: HTTP ${fetchResponse.status} ${fetchResponse.statusText}${errorText ? ` - ${errorText}` : ''}`);
          }

          return fetchResponse;
        },
        {
          maxAttempts: retryOptions.external_api.maxAttempts,
          baseDelay: retryOptions.external_api.baseDelay,
          shouldRetry: (error: Error) => this.shouldRetryOllamaConnection(error),
          onRetry: (error: Error, attempt: number, delay: number) => {
            logger.warn('LLMClientInitializer: Ollama 연결 테스트 재시도', {
              attempt,
              delay,
              error: error.message,
              baseUrl,
              requestedProvider: selectedProvider
            });
          }
        }
      );

      await this.handleOllamaResponse(response, result, selectedProvider, baseUrl);
    } catch (error) {
      // 타임아웃 또는 네트워크 에러 (재시도 실패)
      const errorMessage = this.getErrorMessage(error);
      const warningMessage = this.getOllamaErrorMessage(errorMessage);
      
      this.addWarning(
        result,
        warningMessage,
        'Ollama 연결 테스트 중 오류가 발생했습니다.',
        {
          requestedProvider: selectedProvider,
          baseUrl,
          reason: errorMessage
        }
      );
    }
  }

  /**
   * Ollama 연결 재시도 여부 결정
   * 
   * @param error 에러 객체
   * @returns 재시도 여부
   */
  private shouldRetryOllamaConnection(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    // 네트워크 에러 재시도
    const isNetworkError = errorMessage.includes('fetch failed') ||
                         errorMessage.includes('econnrefused') ||
                         errorMessage.includes('enotfound');
    // 타임아웃 에러 재시도
    const isTimeout = errorMessage.includes('aborted') ||
                     errorMessage.includes('timeout');
    // HTTP 5xx 에러 재시도
    const isServerError = errorMessage.includes('http 5') ||
                        errorMessage.includes('server error');
    
    return isNetworkError || isTimeout || isServerError;
  }

  /**
   * Ollama 에러 메시지 생성
   * 
   * @param errorMessage 에러 메시지
   * @returns 포맷된 경고 메시지
   */
  private getOllamaErrorMessage(errorMessage: string): string {
    const isTimeout = errorMessage.includes('aborted') || errorMessage.includes('timeout');
    const isNetworkError = errorMessage.includes('fetch failed') || 
                           errorMessage.includes('ECONNREFUSED') || 
                           errorMessage.includes('ENOTFOUND');
    
    if (isTimeout) {
      return 'Ollama 연결 타임아웃 (5초)';
    } else if (isNetworkError) {
      return `Ollama 네트워크 에러: ${errorMessage}`;
    } else {
      return `Ollama 연결 테스트 실패: ${errorMessage}`;
    }
  }

  /**
   * preferredProvider 결정
   * 
   * @param result 초기화 결과 객체
   * @param selectedProvider 선택된 provider
   * @returns preferredProvider 또는 null
   */
  private determinePreferredProvider(
    result: LLMClientInitializationResult,
    selectedProvider: LLMProvider
  ): 'openai' | 'gemini' | 'ollama' | null {
    if (selectedProvider === 'openai') {
      return this.determineProviderForOpenAI(result, selectedProvider);
    } else if (selectedProvider === 'gemini') {
      return this.determineProviderForGemini(result, selectedProvider);
    } else if (selectedProvider === 'ollama') {
      return this.determineProviderForOllama(result, selectedProvider);
    } else {
      // 'auto' 모드: OpenAI -> Gemini -> Ollama 순서로 사용 가능한 첫 번째 provider 선택
      return this.determineProviderForAuto(result);
    }
  }

  /**
   * OpenAI provider에 대한 preferredProvider 결정
   * 
   * @param result 초기화 결과 객체
   * @param selectedProvider 선택된 provider
   * @returns preferredProvider 또는 null
   */
  private determineProviderForOpenAI(
    result: LLMClientInitializationResult,
    selectedProvider: LLMProvider
  ): 'openai' | 'gemini' | null {
    if (result.openaiClient !== null) {
      return 'openai';
    } else if (result.geminiClient !== null) {
      logger.warn('OpenAI를 사용할 수 없어 Gemini로 fallback합니다.', {
        requestedProvider: selectedProvider,
        fallbackProvider: 'gemini'
      });
      return 'gemini';
    } else {
      logger.error('LLM_PROVIDER="openai"로 설정되었지만 OpenAI와 Gemini 모두 사용할 수 없습니다.', {
        requestedProvider: selectedProvider,
        initializedProviders: result.initializedProviders,
        warnings: result.warnings
      });
      return null;
    }
  }

  /**
   * Gemini provider에 대한 preferredProvider 결정
   * 
   * @param result 초기화 결과 객체
   * @param selectedProvider 선택된 provider
   * @returns preferredProvider 또는 null
   */
  private determineProviderForGemini(
    result: LLMClientInitializationResult,
    selectedProvider: LLMProvider
  ): 'openai' | 'gemini' | null {
    if (result.geminiClient !== null) {
      return 'gemini';
    } else if (result.openaiClient !== null) {
      logger.warn('Gemini를 사용할 수 없어 OpenAI로 fallback합니다.', {
        requestedProvider: selectedProvider,
        fallbackProvider: 'openai'
      });
      return 'openai';
    } else {
      logger.error('LLM_PROVIDER="gemini"로 설정되었지만 Gemini와 OpenAI 모두 사용할 수 없습니다.', {
        requestedProvider: selectedProvider,
        initializedProviders: result.initializedProviders,
        warnings: result.warnings
      });
      return null;
    }
  }

  /**
   * Ollama provider에 대한 preferredProvider 결정
   * 
   * @param result 초기화 결과 객체
   * @param selectedProvider 선택된 provider
   * @returns preferredProvider 또는 null
   */
  private determineProviderForOllama(
    result: LLMClientInitializationResult,
    selectedProvider: LLMProvider
  ): 'openai' | 'gemini' | 'ollama' | null {
    if (result.initializedProviders.includes('ollama')) {
      return 'ollama';
    } else if (result.openaiClient !== null) {
      logger.warn('Ollama를 사용할 수 없어 OpenAI로 fallback합니다.', {
        requestedProvider: selectedProvider,
        fallbackProvider: 'openai'
      });
      return 'openai';
    } else if (result.geminiClient !== null) {
      logger.warn('Ollama와 OpenAI를 사용할 수 없어 Gemini로 fallback합니다.', {
        requestedProvider: selectedProvider,
        fallbackProvider: 'gemini'
      });
      return 'gemini';
    } else {
      logger.error('LLM_PROVIDER="ollama"로 설정되었지만 Ollama, OpenAI, Gemini 모두 사용할 수 없습니다.', {
        requestedProvider: selectedProvider,
        initializedProviders: result.initializedProviders,
        warnings: result.warnings
      });
      return null;
    }
  }

  /**
   * Auto 모드에 대한 preferredProvider 결정
   * 
   * @param result 초기화 결과 객체
   * @returns preferredProvider 또는 null
   */
  private determineProviderForAuto(
    result: LLMClientInitializationResult
  ): 'openai' | 'gemini' | 'ollama' | null {
    if (result.openaiClient !== null) {
      return 'openai';
    } else if (result.geminiClient !== null) {
      return 'gemini';
    } else if (result.initializedProviders.includes('ollama')) {
      return 'ollama';
    } else {
      return null;
    }
  }
}

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

import { mementoConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { RetryManager } from '../../infrastructure/scheduler/retry-manager.js';
import type { RetryConfig } from '../../infrastructure/scheduler/retry-manager.js';
import { getRetryOptions } from '../config/retry-options-loader.js';
import { getSelectedProvider, resolveLlmModelLabel } from './llm-client-initializer/shared-helpers.js';
import { initializeOpenAI } from './llm-client-initializer/openai.js';
import { initializeGemini } from './llm-client-initializer/gemini.js';
import { testOllamaConnection } from './llm-client-initializer/ollama.js';
import { determinePreferredProvider } from './llm-client-initializer/provider-resolution.js';
import type { LLMClientInitializationResult } from './llm-client-initializer/types.js';

export type { LLMClientInitializationResult } from './llm-client-initializer/types.js';

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
    const selectedProvider = getSelectedProvider();

    // 클라이언트 초기화
    result.openaiClient = initializeOpenAI(result, selectedProvider);
    result.geminiClient = initializeGemini(result, selectedProvider);

    // Ollama 연결 테스트: ollama 모드는 항상; auto는 클라우드 클라이언트가 없을 때만 (이슈 #261)
    if (selectedProvider === 'ollama') {
      await testOllamaConnection(result, selectedProvider, this.retryManager);
    } else if (selectedProvider === 'auto') {
      if (result.openaiClient === null && result.geminiClient === null) {
        await testOllamaConnection(result, selectedProvider, this.retryManager);
      }
    }

    // preferredProvider 설정
    result.preferredProvider = determinePreferredProvider(
      result,
      selectedProvider
    );

    logger.info('LLM provider initialized', {
      preferredProvider: result.preferredProvider,
      llmModel: resolveLlmModelLabel(result.preferredProvider),
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
}

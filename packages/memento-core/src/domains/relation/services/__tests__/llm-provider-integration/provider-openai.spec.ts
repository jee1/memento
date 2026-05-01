/**
 * LLM Provider integration — openai
 */
import { resetLlmProviderIntegrationTestEnv, getMockMementoConfig } from './llm-provider-integration.test-setup.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LLMClientInitializer } from '../../../../../shared/services/llm-client-initializer.js';
import type { LLMClientInitializationResult } from '../../../../../shared/services/llm-client-initializer.js';

const mockMementoConfig = getMockMementoConfig();

describe('LLM Provider 통합 테스트', () => {
  let originalFetch: typeof global.fetch;
  let originalAbortSignal: typeof AbortSignal;

  beforeEach(() => {
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    mockMementoConfig.llmProvider = 'auto';
    mockMementoConfig.openaiApiKey = undefined;
    mockMementoConfig.geminiApiKey = undefined;
    mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
    originalFetch = global.fetch;
    originalAbortSignal = global.AbortSignal;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.AbortSignal = originalAbortSignal;
  });

  describe("LLM_PROVIDER='openai' 통합 테스트", () => {
    /**
     * Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 설정되어 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'openai'로 설정되고 openaiClient가 초기화되어야 함
     */
    it('should initialize OpenAI client when LLM_PROVIDER is set to "openai" and API key is available', async () => {
      // Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 설정되어 있음
      process.env.LLM_PROVIDER = 'openai';
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      mockMementoConfig.geminiApiKey = undefined;
      
      // Ollama fetch 모킹 - 실패 (연결 안 됨)
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      global.fetch = mockFetch as typeof global.fetch;
      
      // AbortSignal.timeout 모킹
      const mockAbortSignal = new EventTarget() as AbortSignal;
      const mockTimeout = vi.fn((ms: number) => mockAbortSignal);
      global.AbortSignal = {
        ...originalAbortSignal,
        timeout: mockTimeout
      } as typeof AbortSignal;
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 'openai'로 설정되고 openaiClient가 초기화되어야 함
      expect(result.preferredProvider).toBe('openai');
      expect(result.openaiClient).not.toBeNull();
      expect(result.initializedProviders).toContain('openai');
    });

    /**
     * Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 없지만 Gemini API 키가 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'gemini'로 설정되고 fallback이 발생해야 함
     */
    it('should fallback to Gemini when LLM_PROVIDER is "openai" but OpenAI API key is not available', async () => {
      // Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 없지만 Gemini API 키가 있음
      process.env.LLM_PROVIDER = 'openai';
      mockMementoConfig.openaiApiKey = undefined;
      mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
      
      // Ollama fetch 모킹 - 실패 (연결 안 됨)
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      global.fetch = mockFetch as typeof global.fetch;
      
      // AbortSignal.timeout 모킹
      const mockAbortSignal = new EventTarget() as AbortSignal;
      const mockTimeout = vi.fn((ms: number) => mockAbortSignal);
      global.AbortSignal = {
        ...originalAbortSignal,
        timeout: mockTimeout
      } as typeof AbortSignal;
      
      // Logger 모킹
      const loggerModule = await import('../../../../../shared/utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 'gemini'로 설정되고 fallback이 발생해야 함
      expect(result.preferredProvider).toBe('gemini');
      expect(result.openaiClient).toBeNull();
      expect(result.geminiClient).not.toBeNull();
      expect(loggerWarnSpy).toHaveBeenCalled();
      
      loggerWarnSpy.mockRestore();
    });
  });
});

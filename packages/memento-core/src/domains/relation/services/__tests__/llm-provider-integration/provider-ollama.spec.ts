/**
 * LLM Provider integration — ollama
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

  describe("LLM_PROVIDER='ollama' 통합 테스트", () => {
    /**
     * Given: LLM_PROVIDER='ollama'이고 Ollama 서버가 정상적으로 응답함 (HTTP 200 + JSON)
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'ollama'로 설정되고 initializedProviders에 'ollama'가 추가되어야 함
     */
    it('should initialize Ollama when LLM_PROVIDER is set to "ollama" and server responds successfully', async () => {
      // Given: LLM_PROVIDER='ollama'이고 Ollama 서버가 정상적으로 응답함
      process.env.LLM_PROVIDER = 'ollama';
      mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
      
      // Ollama fetch 모킹 - 성공 응답
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ models: [] })
      });
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

      // Then: preferredProvider가 'ollama'로 설정되고 initializedProviders에 'ollama'가 추가되어야 함
      expect(result.preferredProvider).toBe('ollama');
      expect(result.initializedProviders).toContain('ollama');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({
          method: 'GET',
          signal: expect.any(EventTarget)
        })
      );
      expect(mockTimeout).toHaveBeenCalledWith(5000);
    });

    /**
     * Given: LLM_PROVIDER='ollama'이고 Ollama 연결 실패하지만 OpenAI API 키가 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'openai'로 설정되고 fallback이 발생해야 함
     */
    it('should fallback to OpenAI when LLM_PROVIDER is "ollama" but Ollama connection fails', async () => {
      // Given: LLM_PROVIDER='ollama'이고 Ollama 연결 실패하지만 OpenAI API 키가 있음
      process.env.LLM_PROVIDER = 'ollama';
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      mockMementoConfig.geminiApiKey = undefined;
      mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
      
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

      // Then: preferredProvider가 'openai'로 설정되고 fallback이 발생해야 함
      expect(result.preferredProvider).toBe('openai');
      expect(result.initializedProviders).not.toContain('ollama');
      expect(result.openaiClient).not.toBeNull();
      expect(loggerWarnSpy).toHaveBeenCalled();
      
      loggerWarnSpy.mockRestore();
    });
  });
});

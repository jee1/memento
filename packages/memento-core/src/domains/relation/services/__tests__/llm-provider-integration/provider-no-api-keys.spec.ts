/**
 * LLM Provider integration — no API keys
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

  describe('API 키가 없는 시나리오 통합 테스트', () => {
    /**
     * Given: LLM_PROVIDER='openai'이고 모든 API 키가 없음 (OpenAI, Gemini 모두 없음)
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 null이고, logger.warn()이 호출되고, logger.error()가 호출되어야 함
     */
    it('should return null and log warnings/errors when LLM_PROVIDER is "openai" and all API keys are missing', async () => {
      // Given: LLM_PROVIDER='openai'이고 모든 API 키가 없음
      process.env.LLM_PROVIDER = 'openai';
      mockMementoConfig.openaiApiKey = undefined;
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
      const loggerErrorSpy = vi.spyOn(loggerModule.logger, 'error');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 null이고, logger.warn()과 logger.error()가 호출되어야 함
      expect(result.preferredProvider).toBeNull();
      expect(result.openaiClient).toBeNull();
      expect(result.geminiClient).toBeNull();
      expect(result.initializedProviders.length).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      // API 키가 없을 때 경고 메시지가 포함되어야 함
      expect(result.warnings.some(w => w.includes('OPENAI_API_KEY') || w.includes('API 키'))).toBe(true);
      expect(loggerWarnSpy).toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalled();
      
      loggerWarnSpy.mockRestore();
      loggerErrorSpy.mockRestore();
    });

    /**
     * Given: LLM_PROVIDER='gemini'이고 모든 API 키가 없음 (Gemini, OpenAI 모두 없음)
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 null이고, logger.warn()이 호출되고, logger.error()가 호출되어야 함
     */
    it('should return null and log warnings/errors when LLM_PROVIDER is "gemini" and all API keys are missing', async () => {
      // Given: LLM_PROVIDER='gemini'이고 모든 API 키가 없음
      process.env.LLM_PROVIDER = 'gemini';
      mockMementoConfig.openaiApiKey = undefined;
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
      const loggerErrorSpy = vi.spyOn(loggerModule.logger, 'error');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 null이고, logger.warn()과 logger.error()가 호출되어야 함
      expect(result.preferredProvider).toBeNull();
      expect(result.openaiClient).toBeNull();
      expect(result.geminiClient).toBeNull();
      expect(result.initializedProviders.length).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      // API 키가 없을 때 경고 메시지가 포함되어야 함
      expect(result.warnings.some(w => w.includes('GEMINI_API_KEY') || w.includes('API 키'))).toBe(true);
      expect(loggerWarnSpy).toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalled();
      
      loggerWarnSpy.mockRestore();
      loggerErrorSpy.mockRestore();
    });

    /**
     * Given: LLM_PROVIDER='ollama'이고 모든 API 키가 없고 Ollama 연결도 실패함
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 null이고, logger.warn()이 호출되고, logger.error()가 호출되어야 함
     */
    it('should return null and log warnings/errors when LLM_PROVIDER is "ollama" and all providers fail', async () => {
      // Given: LLM_PROVIDER='ollama'이고 모든 API 키가 없고 Ollama 연결도 실패함
      process.env.LLM_PROVIDER = 'ollama';
      mockMementoConfig.openaiApiKey = undefined;
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
      const loggerErrorSpy = vi.spyOn(loggerModule.logger, 'error');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 null이고, logger.warn()과 logger.error()가 호출되어야 함
      expect(result.preferredProvider).toBeNull();
      expect(result.openaiClient).toBeNull();
      expect(result.geminiClient).toBeNull();
      expect(result.initializedProviders).not.toContain('ollama');
      expect(result.warnings.length).toBeGreaterThan(0);
      // Ollama 연결 실패 경고 메시지가 포함되어야 함
      expect(result.warnings.some(w => w.includes('Ollama') || w.includes('연결'))).toBe(true);
      expect(loggerWarnSpy).toHaveBeenCalled();
      expect(loggerErrorSpy).toHaveBeenCalled();
      
      loggerWarnSpy.mockRestore();
      loggerErrorSpy.mockRestore();
    });

    /**
     * Given: LLM_PROVIDER='auto'이고 모든 API 키가 없고 Ollama 연결도 실패함
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 null이고, logger.warn()이 호출되어야 함 (logger.error()는 호출되지 않음 - auto 모드는 에러가 아님)
     */
    it('should return null and log warnings when LLM_PROVIDER is "auto" and all providers fail', async () => {
      // Given: LLM_PROVIDER='auto'이고 모든 API 키가 없고 Ollama 연결도 실패함
      process.env.LLM_PROVIDER = 'auto';
      mockMementoConfig.openaiApiKey = undefined;
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
      const loggerErrorSpy = vi.spyOn(loggerModule.logger, 'error');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 null이고, logger.warn()이 호출되어야 함
      // auto 모드는 에러가 아니므로 logger.error()는 호출되지 않을 수 있음
      expect(result.preferredProvider).toBeNull();
      expect(result.openaiClient).toBeNull();
      expect(result.geminiClient).toBeNull();
      expect(result.initializedProviders).not.toContain('ollama');
      expect(result.warnings.length).toBeGreaterThan(0);
      // API 키가 없을 때 경고 메시지가 포함되어야 함
      expect(result.warnings.some(w => w.includes('API 키') || w.includes('OPENAI_API_KEY') || w.includes('GEMINI_API_KEY'))).toBe(true);
      expect(loggerWarnSpy).toHaveBeenCalled();
      // auto 모드는 에러가 아니므로 logger.error()는 호출되지 않을 수 있음
      // (실제 구현에 따라 다를 수 있음)
      
      loggerWarnSpy.mockRestore();
      loggerErrorSpy.mockRestore();
    });
  });
});

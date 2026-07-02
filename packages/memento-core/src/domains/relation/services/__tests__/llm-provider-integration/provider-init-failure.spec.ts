/**
 * LLM Provider integration — init failure
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

  describe('설정된 provider가 실패하는 시나리오 통합 테스트', () => {
    /**
     * Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 있지만 OpenAI 클라이언트 초기화가 실패함
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: Gemini로 자동 전환되고 logger.warn()이 호출되어야 함
     */
    it('should automatically switch to Gemini when LLM_PROVIDER is "openai" but OpenAI initialization fails', async () => {
      // Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 있지만 OpenAI 클라이언트 초기화가 실패함
      process.env.LLM_PROVIDER = 'openai';
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
      
      // OpenAI 모킹 - 초기화 실패
      const openaiModule = await import('openai');
      const MockOpenAI = (openaiModule as any).__MockOpenAI;
      MockOpenAI.mockImplementation(() => {
        throw new Error('OpenAI initialization failed');
      });
      
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

      // Then: Gemini로 자동 전환되고 logger.warn()이 호출되어야 함
      expect(result.preferredProvider).toBe('gemini');
      expect(result.openaiClient).toBeNull();
      expect(result.geminiClient).not.toBeNull();
      expect(result.initializedProviders).toContain('gemini');
      expect(result.warnings.length).toBeGreaterThan(0);
      // OpenAI 초기화 실패 경고 메시지가 포함되어야 함
      expect(result.warnings.some(w => w.includes('OpenAI') || w.includes('초기화 실패'))).toBe(true);
      // Fallback 경고 메시지가 포함되어야 함
      expect(loggerWarnSpy).toHaveBeenCalled();
      // Fallback 메시지 확인
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('fallback'),
        expect.any(Object)
      );
      
      MockOpenAI.mockRestore();
      loggerWarnSpy.mockRestore();
    });

    /**
     * Given: LLM_PROVIDER='gemini'이고 Gemini API 키가 있지만 Gemini 클라이언트 초기화가 실패함
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: OpenAI로 자동 전환되고 logger.warn()이 호출되어야 함
     */
    it('should automatically switch to OpenAI when LLM_PROVIDER is "gemini" but Gemini initialization fails', async () => {
      // Given: LLM_PROVIDER='gemini'이고 Gemini API 키가 있지만 Gemini 클라이언트 초기화가 실패함
      process.env.LLM_PROVIDER = 'gemini';
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
      
      // Gemini 모킹 - 초기화 실패
      const geminiModule = await import('@google/genai');
      const MockGoogleGenAI = geminiModule.GoogleGenAI;
      vi.mocked(MockGoogleGenAI).mockImplementation(() => {
        throw new Error('Gemini initialization failed');
      });
      
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

      // Then: OpenAI로 자동 전환되고 logger.warn()이 호출되어야 함
      expect(result.preferredProvider).toBe('openai');
      expect(result.geminiClient).toBeNull();
      expect(result.openaiClient).not.toBeNull();
      expect(result.initializedProviders).toContain('openai');
      expect(result.warnings.length).toBeGreaterThan(0);
      // Gemini 초기화 실패 경고 메시지가 포함되어야 함
      expect(result.warnings.some(w => w.includes('Gemini') || w.includes('초기화 실패'))).toBe(true);
      // Fallback 경고 메시지가 포함되어야 함
      expect(loggerWarnSpy).toHaveBeenCalled();
      // Fallback 메시지 확인
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('fallback'),
        expect.any(Object)
      );
      
      vi.mocked(MockGoogleGenAI).mockRestore();
      loggerWarnSpy.mockRestore();
    });

    /**
     * Given: LLM_PROVIDER='ollama'이고 Ollama 연결이 실패함 (HTTP 비-200 응답)
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: OpenAI로 자동 전환되고 logger.warn()이 호출되어야 함
     */
    it('should automatically switch to OpenAI when LLM_PROVIDER is "ollama" but Ollama connection fails with non-200 response', async () => {
      // Given: LLM_PROVIDER='ollama'이고 Ollama 연결이 실패함
      process.env.LLM_PROVIDER = 'ollama';
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      mockMementoConfig.geminiApiKey = undefined;
      mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
      
      // Ollama fetch 모킹 - HTTP 비-200 응답
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });
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

      // Then: OpenAI로 자동 전환되고 logger.warn()이 호출되어야 함
      expect(result.preferredProvider).toBe('openai');
      expect(result.initializedProviders).not.toContain('ollama');
      expect(result.openaiClient).not.toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
      // Ollama 연결 실패 경고 메시지가 포함되어야 함
      expect(result.warnings.some(w => w.includes('Ollama') || w.includes('연결 실패'))).toBe(true);
      // Fallback 경고 메시지가 포함되어야 함
      expect(loggerWarnSpy).toHaveBeenCalled();
      // Fallback 메시지 확인
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('fallback'),
        expect.any(Object)
      );
      
      loggerWarnSpy.mockRestore();
    });

    /**
     * Given: LLM_PROVIDER='ollama'이고 Ollama 연결이 타임아웃됨
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: OpenAI로 자동 전환되고 logger.warn()이 호출되어야 함
     */
    it('should automatically switch to OpenAI when LLM_PROVIDER is "ollama" but Ollama connection times out', async () => {
      // Given: LLM_PROVIDER='ollama'이고 Ollama 연결이 타임아웃됨
      process.env.LLM_PROVIDER = 'ollama';
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      mockMementoConfig.geminiApiKey = undefined;
      mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
      
      // Ollama fetch 모킹 - 타임아웃 에러
      const timeoutError = new Error('The operation was aborted');
      timeoutError.name = 'AbortError';
      const mockFetch = vi.fn().mockRejectedValue(timeoutError);
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

      // Then: OpenAI로 자동 전환되고 logger.warn()이 호출되어야 함
      expect(result.preferredProvider).toBe('openai');
      expect(result.initializedProviders).not.toContain('ollama');
      expect(result.openaiClient).not.toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
      // Ollama 타임아웃 경고 메시지가 포함되어야 함
      expect(result.warnings.some(w => w.includes('Ollama') || w.includes('타임아웃') || w.includes('timeout'))).toBe(true);
      // Fallback 경고 메시지가 포함되어야 함
      expect(loggerWarnSpy).toHaveBeenCalled();
      // Fallback 메시지 확인
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('fallback'),
        expect.any(Object)
      );
      
      loggerWarnSpy.mockRestore();
    });

    /**
     * Given: LLM_PROVIDER='ollama'이고 Ollama 연결이 실패하고 OpenAI도 없지만 Gemini API 키가 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: Gemini로 자동 전환되고 logger.warn()이 호출되어야 함
     */
    it('should automatically switch to Gemini when LLM_PROVIDER is "ollama" but Ollama fails and OpenAI is not available', async () => {
      // Given: LLM_PROVIDER='ollama'이고 Ollama 연결이 실패하고 OpenAI도 없지만 Gemini API 키가 있음
      process.env.LLM_PROVIDER = 'ollama';
      mockMementoConfig.openaiApiKey = undefined;
      mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
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

      // Then: Gemini로 자동 전환되고 logger.warn()이 호출되어야 함
      expect(result.preferredProvider).toBe('gemini');
      expect(result.initializedProviders).not.toContain('ollama');
      expect(result.openaiClient).toBeNull();
      expect(result.geminiClient).not.toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
      // Ollama 연결 실패 경고 메시지가 포함되어야 함
      expect(result.warnings.some(w => w.includes('Ollama') || w.includes('연결'))).toBe(true);
      // Fallback 경고 메시지가 포함되어야 함
      expect(loggerWarnSpy).toHaveBeenCalled();
      // Fallback 메시지 확인
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('fallback'),
        expect.any(Object)
      );
      
      loggerWarnSpy.mockRestore();
    });
  });
});

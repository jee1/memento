/**
 * LLM Provider integration — auto
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

  describe("LLM_PROVIDER='auto' 통합 테스트", () => {
    /**
     * Given: LLM_PROVIDER='auto'이고 OpenAI API 키가 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'openai'로 설정되어야 함 (첫 번째 우선순위)
     * And: Ollama 프로브는 생략되어 fetch가 호출되지 않아야 함 (#261)
     */
    it('should select OpenAI as preferredProvider when LLM_PROVIDER is "auto" and OpenAI is available', async () => {
      // Given: LLM_PROVIDER='auto'이고 OpenAI API 키가 있음
      process.env.LLM_PROVIDER = 'auto';
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
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 'openai'로 설정되어야 함 (첫 번째 우선순위)
      expect(result.preferredProvider).toBe('openai');
      expect(result.openaiClient).not.toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    /**
     * Given: LLM_PROVIDER='auto'이고 OpenAI API 키가 없지만 Gemini API 키가 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'gemini'로 설정되어야 함 (두 번째 우선순위)
     * And: Ollama 프로브는 생략되어 fetch가 호출되지 않아야 함 (#261)
     */
    it('should select Gemini as preferredProvider when LLM_PROVIDER is "auto" and OpenAI is not available but Gemini is available', async () => {
      // Given: LLM_PROVIDER='auto'이고 OpenAI API 키가 없지만 Gemini API 키가 있음
      process.env.LLM_PROVIDER = 'auto';
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
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 'gemini'로 설정되어야 함 (두 번째 우선순위)
      expect(result.preferredProvider).toBe('gemini');
      expect(result.openaiClient).toBeNull();
      expect(result.geminiClient).not.toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    /**
     * Given: LLM_PROVIDER='auto'이고 OpenAI와 Gemini API 키가 없지만 Ollama 서버가 정상적으로 응답함
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'ollama'로 설정되어야 함 (세 번째 우선순위)
     */
    it('should select Ollama as preferredProvider when LLM_PROVIDER is "auto" and OpenAI and Gemini are not available but Ollama is available', async () => {
      // Given: LLM_PROVIDER='auto'이고 OpenAI와 Gemini API 키가 없지만 Ollama 서버가 정상적으로 응답함
      process.env.LLM_PROVIDER = 'auto';
      mockMementoConfig.openaiApiKey = undefined;
      mockMementoConfig.geminiApiKey = undefined;
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

      // Then: preferredProvider가 'ollama'로 설정되어야 함 (세 번째 우선순위)
      expect(result.preferredProvider).toBe('ollama');
      expect(result.openaiClient).toBeNull();
      expect(result.geminiClient).toBeNull();
      expect(result.initializedProviders).toContain('ollama');
    });

    /**
     * Given: LLM_PROVIDER='auto'이고 OpenAI, Gemini, Ollama 모두 사용 불가능함
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 null이어야 함
     */
    it('should return null when LLM_PROVIDER is "auto" and all providers are unavailable', async () => {
      // Given: LLM_PROVIDER='auto'이고 OpenAI, Gemini, Ollama 모두 사용 불가능함
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
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 null이어야 함
      expect(result.preferredProvider).toBeNull();
      expect(result.openaiClient).toBeNull();
      expect(result.geminiClient).toBeNull();
      expect(result.initializedProviders).not.toContain('ollama');
    });
  });
});

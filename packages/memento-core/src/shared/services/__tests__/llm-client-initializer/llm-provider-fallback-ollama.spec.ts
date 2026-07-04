/**
 * LLMClientInitializer unit tests — LLM_PROVIDER fallback (ollama)
 */
import { resetLlmClientInitializerTestEnv, getMockMementoConfig } from './llm-client-initializer.test-setup.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMClientInitializer } from '../../llm-client-initializer.js';
import type { LLMClientInitializationResult } from '../../llm-client-initializer.js';

const mockMementoConfig = getMockMementoConfig();

describe('LLMClientInitializer', () => {
  beforeEach(() => {
    resetLlmClientInitializerTestEnv();
  });

  describe('LLM_PROVIDER fallback logic', () => {
    describe("LLM_PROVIDER='ollama'", () => {
      /**
       * Given: LLM_PROVIDER='ollama'이고 Ollama 서버가 정상적으로 응답함 (HTTP 200 + JSON)
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'ollama'로 설정되어야 함
       * 
       * Note: 현재 구현에서는 Ollama fallback 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should set preferredProvider to "ollama" when Ollama is available', async () => {
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
        const originalAbortSignal = global.AbortSignal;
        const mockAbortSignal = new EventTarget() as AbortSignal;
        const mockTimeout = vi.fn((ms: number) => mockAbortSignal);
        global.AbortSignal = {
          ...originalAbortSignal,
          timeout: mockTimeout
        } as typeof AbortSignal;
        
        const initializer = new LLMClientInitializer();

        // When: initialize() 메서드 호출
        const result = await initializer.initialize();

        // Then: preferredProvider가 'ollama'로 설정되어야 함
        // 현재 구현에서는 Ollama fallback 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBe('ollama');
        expect(result.initializedProviders).toContain('ollama');
      });

      /**
       * Given: LLM_PROVIDER='ollama'이고 Ollama 연결 실패하지만 OpenAI API 키가 있음
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'openai'로 설정되어야 함 (fallback)
       * 
       * Note: 현재 구현에서는 Ollama fallback 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should fallback to OpenAI when Ollama is not available but OpenAI is available', async () => {
        // Given: LLM_PROVIDER='ollama'이고 Ollama 연결 실패하지만 OpenAI API 키가 있음
        process.env.LLM_PROVIDER = 'ollama';
        mockMementoConfig.openaiApiKey = 'test-openai-api-key';
        mockMementoConfig.geminiApiKey = undefined;
        mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
        
        // Ollama fetch 모킹 - 실패 (연결 안 됨)
        const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        global.fetch = mockFetch as typeof global.fetch;
        
        // AbortSignal.timeout 모킹
        const originalAbortSignal = global.AbortSignal;
        const mockAbortSignal = new EventTarget() as AbortSignal;
        const mockTimeout = vi.fn((ms: number) => mockAbortSignal);
        global.AbortSignal = {
          ...originalAbortSignal,
          timeout: mockTimeout
        } as typeof AbortSignal;
        
        // Logger 모킹
        const loggerModule = await import('../../../utils/logger.js');
        const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
        
        const initializer = new LLMClientInitializer();

        // When: initialize() 메서드 호출
        const result = await initializer.initialize();

        // Then: preferredProvider가 'openai'로 설정되어야 함 (fallback)
        // 현재 구현에서는 Ollama fallback 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBe('openai');
        expect(result.initializedProviders).not.toContain('ollama');
        expect(result.openaiClient).not.toBeNull();
        expect(loggerWarnSpy).toHaveBeenCalled();
        
        loggerWarnSpy.mockRestore();
      });

      /**
       * Given: LLM_PROVIDER='ollama'이고 Ollama 연결 실패하고 OpenAI도 없지만 Gemini API 키가 있음
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'gemini'로 설정되어야 함 (fallback)
       * 
       * Note: 현재 구현에서는 Ollama fallback 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should fallback to Gemini when Ollama and OpenAI are not available but Gemini is available', async () => {
        // Given: LLM_PROVIDER='ollama'이고 Ollama 연결 실패하고 OpenAI도 없지만 Gemini API 키가 있음
        process.env.LLM_PROVIDER = 'ollama';
        mockMementoConfig.openaiApiKey = undefined;
        mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
        mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
        
        // Ollama fetch 모킹 - 실패 (연결 안 됨)
        const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        global.fetch = mockFetch as typeof global.fetch;
        
        // AbortSignal.timeout 모킹
        const originalAbortSignal = global.AbortSignal;
        const mockAbortSignal = new EventTarget() as AbortSignal;
        const mockTimeout = vi.fn((ms: number) => mockAbortSignal);
        global.AbortSignal = {
          ...originalAbortSignal,
          timeout: mockTimeout
        } as typeof AbortSignal;
        
        // Logger 모킹
        const loggerModule = await import('../../../utils/logger.js');
        const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
        
        const initializer = new LLMClientInitializer();

        // When: initialize() 메서드 호출
        const result = await initializer.initialize();

        // Then: preferredProvider가 'gemini'로 설정되어야 함 (fallback)
        // 현재 구현에서는 Ollama fallback 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBe('gemini');
        expect(result.initializedProviders).not.toContain('ollama');
        expect(result.geminiClient).not.toBeNull();
        expect(loggerWarnSpy).toHaveBeenCalled();
        
        loggerWarnSpy.mockRestore();
      });

      /**
       * Given: LLM_PROVIDER='ollama'이고 Ollama 연결 실패하지만 OpenAI와 Gemini 모두 사용 가능함
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'openai'로 설정되어야 함 (fallback 순서: OpenAI 우선)
       * 
       * Note: 현재 구현에서는 Ollama fallback 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should fallback to OpenAI first when Ollama is not available but both OpenAI and Gemini are available', async () => {
        // Given: LLM_PROVIDER='ollama'이고 Ollama 연결 실패하지만 OpenAI와 Gemini 모두 사용 가능함
        process.env.LLM_PROVIDER = 'ollama';
        mockMementoConfig.openaiApiKey = 'test-openai-api-key';
        mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
        mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
        
        // Ollama fetch 모킹 - 실패 (연결 안 됨)
        const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        global.fetch = mockFetch as typeof global.fetch;
        
        // AbortSignal.timeout 모킹
        const originalAbortSignal = global.AbortSignal;
        const mockAbortSignal = new EventTarget() as AbortSignal;
        const mockTimeout = vi.fn((ms: number) => mockAbortSignal);
        global.AbortSignal = {
          ...originalAbortSignal,
          timeout: mockTimeout
        } as typeof AbortSignal;
        
        // Logger 모킹
        const loggerModule = await import('../../../utils/logger.js');
        const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
        
        const initializer = new LLMClientInitializer();

        // When: initialize() 메서드 호출
        const result = await initializer.initialize();

        // Then: preferredProvider가 'openai'로 설정되어야 함 (fallback 순서: OpenAI 우선)
        // 현재 구현에서는 Ollama fallback 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBe('openai');
        expect(result.initializedProviders).not.toContain('ollama');
        expect(result.openaiClient).not.toBeNull();
        expect(result.geminiClient).not.toBeNull();
        expect(loggerWarnSpy).toHaveBeenCalled();
        
        loggerWarnSpy.mockRestore();
      });

      /**
       * Given: LLM_PROVIDER='ollama'이고 Ollama, OpenAI, Gemini 모두 사용 불가능함
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 null이고 경고 메시지가 추가되어야 함
       * 
       * Note: 현재 구현에서는 Ollama fallback 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should return null and add warning when Ollama, OpenAI, and Gemini are all unavailable', async () => {
        // Given: LLM_PROVIDER='ollama'이고 Ollama, OpenAI, Gemini 모두 사용 불가능함
        process.env.LLM_PROVIDER = 'ollama';
        mockMementoConfig.openaiApiKey = undefined;
        mockMementoConfig.geminiApiKey = undefined;
        mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
        
        // Ollama fetch 모킹 - 실패 (연결 안 됨)
        const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        global.fetch = mockFetch as typeof global.fetch;
        
        // AbortSignal.timeout 모킹
        const originalAbortSignal = global.AbortSignal;
        const mockAbortSignal = new EventTarget() as AbortSignal;
        const mockTimeout = vi.fn((ms: number) => mockAbortSignal);
        global.AbortSignal = {
          ...originalAbortSignal,
          timeout: mockTimeout
        } as typeof AbortSignal;
        
        // Logger 모킹
        const loggerModule = await import('../../../utils/logger.js');
        const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
        const loggerErrorSpy = vi.spyOn(loggerModule.logger, 'error');
        
        const initializer = new LLMClientInitializer();

        // When: initialize() 메서드 호출
        const result = await initializer.initialize();

        // Then: preferredProvider가 null이고 경고 메시지가 추가되어야 함
        // 현재 구현에서는 Ollama fallback 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBeNull();
        expect(result.initializedProviders).not.toContain('ollama');
        expect(result.openaiClient).toBeNull();
        expect(result.geminiClient).toBeNull();
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(loggerErrorSpy).toHaveBeenCalled();
        
        loggerWarnSpy.mockRestore();
        loggerErrorSpy.mockRestore();
      });
    });
  });
});

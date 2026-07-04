/**
 * LLMClientInitializer unit tests — LLM_PROVIDER fallback (gemini)
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
    describe("LLM_PROVIDER='gemini'", () => {
      /**
       * Given: LLM_PROVIDER='gemini'이고 Gemini API 키가 있음
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'gemini'로 설정되어야 함
       * 
       * Note: 현재 구현에서는 Gemini fallback 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should set preferredProvider to "gemini" when Gemini is available', async () => {
        // Given: LLM_PROVIDER='gemini'이고 Gemini API 키가 있음
        process.env.LLM_PROVIDER = 'gemini';
        mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
        mockMementoConfig.openaiApiKey = undefined;
        
        // Ollama fetch 모킹 - 실패 (연결 안 됨)
        const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        global.fetch = mockFetch as typeof global.fetch;
        
        const initializer = new LLMClientInitializer();

        // When: initialize() 메서드 호출
        const result = await initializer.initialize();

        // Then: preferredProvider가 'gemini'로 설정되어야 함
        // 현재 구현에서는 Gemini fallback 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBe('gemini');
        expect(result.geminiClient).not.toBeNull();
      });

      /**
       * Given: LLM_PROVIDER='gemini'이고 Gemini API 키가 없지만 OpenAI API 키가 있음
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'openai'로 설정되어야 함 (fallback)
       * 
       * Note: 현재 구현에서는 Gemini fallback 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should fallback to OpenAI when Gemini is not available but OpenAI is available', async () => {
        // Given: LLM_PROVIDER='gemini'이고 Gemini API 키가 없지만 OpenAI API 키가 있음
        process.env.LLM_PROVIDER = 'gemini';
        mockMementoConfig.geminiApiKey = undefined;
        mockMementoConfig.openaiApiKey = 'test-openai-api-key';
        
        // Ollama fetch 모킹 - 실패 (연결 안 됨)
        const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        global.fetch = mockFetch as typeof global.fetch;
        
        // Logger 모킹
        const loggerModule = await import('../../../utils/logger.js');
        const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
        
        const initializer = new LLMClientInitializer();

        // When: initialize() 메서드 호출
        const result = await initializer.initialize();

        // Then: preferredProvider가 'openai'로 설정되어야 함 (fallback)
        // 현재 구현에서는 Gemini fallback 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBe('openai');
        expect(result.geminiClient).toBeNull();
        expect(result.openaiClient).not.toBeNull();
        expect(loggerWarnSpy).toHaveBeenCalled();
        
        loggerWarnSpy.mockRestore();
      });

      /**
       * Given: LLM_PROVIDER='gemini'이고 Gemini와 OpenAI 모두 사용 불가능함
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 null이고 경고 메시지가 추가되어야 함
       * 
       * Note: 현재 구현에서는 Gemini fallback 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should return null and add warning when both Gemini and OpenAI are unavailable', async () => {
        // Given: LLM_PROVIDER='gemini'이고 Gemini와 OpenAI 모두 사용 불가능함
        process.env.LLM_PROVIDER = 'gemini';
        mockMementoConfig.geminiApiKey = undefined;
        mockMementoConfig.openaiApiKey = undefined;
        
        // Ollama fetch 모킹 - 실패 (연결 안 됨)
        const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        global.fetch = mockFetch as typeof global.fetch;
        
        // Logger 모킹
        const loggerModule = await import('../../../utils/logger.js');
        const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
        const loggerErrorSpy = vi.spyOn(loggerModule.logger, 'error');
        
        const initializer = new LLMClientInitializer();

        // When: initialize() 메서드 호출
        const result = await initializer.initialize();

        // Then: preferredProvider가 null이고 경고 메시지가 추가되어야 함
        // 현재 구현에서는 Gemini fallback 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBeNull();
        expect(result.geminiClient).toBeNull();
        expect(result.openaiClient).toBeNull();
        expect(result.initializedProviders.length).toBe(0);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(loggerErrorSpy).toHaveBeenCalled();
        
        loggerWarnSpy.mockRestore();
        loggerErrorSpy.mockRestore();
      });
    });
  });
});

/**
 * LLMClientInitializer unit tests — LLM_PROVIDER fallback (openai)
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
    describe("LLM_PROVIDER='openai'", () => {
      /**
       * Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 있음
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'openai'로 설정되어야 함
       * 
       * Note: 현재 구현에서는 preferredProvider 설정 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should set preferredProvider to "openai" when OpenAI is available', async () => {
        // Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 있음
        process.env.LLM_PROVIDER = 'openai';
        mockMementoConfig.openaiApiKey = 'test-openai-api-key';
        mockMementoConfig.geminiApiKey = undefined;
        
        // Ollama fetch 모킹 - 실패 (연결 안 됨)
        const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        global.fetch = mockFetch as typeof global.fetch;
        
        const initializer = new LLMClientInitializer();

        // When: initialize() 메서드 호출
        const result = await initializer.initialize();

        // Then: preferredProvider가 'openai'로 설정되어야 함
        // 현재 구현에서는 preferredProvider 설정 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBe('openai');
        expect(result.openaiClient).not.toBeNull();
      });

      /**
       * Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 없지만 Gemini API 키가 있음
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'gemini'로 설정되어야 함 (fallback)
       * 
       * Note: 현재 구현에서는 preferredProvider 설정 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should fallback to Gemini when OpenAI is not available but Gemini is available', async () => {
        // Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 없지만 Gemini API 키가 있음
        process.env.LLM_PROVIDER = 'openai';
        mockMementoConfig.openaiApiKey = undefined;
        mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
        
        // Ollama fetch 모킹 - 실패 (연결 안 됨)
        const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        global.fetch = mockFetch as typeof global.fetch;
        
        // Logger 모킹
        const loggerModule = await import('../../../utils/logger.js');
        const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
        
        const initializer = new LLMClientInitializer();

        // When: initialize() 메서드 호출
        const result = await initializer.initialize();

        // Then: preferredProvider가 'gemini'로 설정되어야 함 (fallback)
        // 현재 구현에서는 preferredProvider 설정 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBe('gemini');
        expect(result.openaiClient).toBeNull();
        expect(result.geminiClient).not.toBeNull();
        expect(loggerWarnSpy).toHaveBeenCalled();
        
        loggerWarnSpy.mockRestore();
      });

      /**
       * Given: LLM_PROVIDER='openai'이고 OpenAI와 Gemini 모두 사용 불가능함
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 null이고 경고 메시지가 추가되어야 함
       * 
       * Note: 현재 구현에서는 preferredProvider 설정 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should return null and add warning when both OpenAI and Gemini are unavailable', async () => {
        // Given: LLM_PROVIDER='openai'이고 OpenAI와 Gemini 모두 사용 불가능함
        process.env.LLM_PROVIDER = 'openai';
        mockMementoConfig.openaiApiKey = undefined;
        mockMementoConfig.geminiApiKey = undefined;
        
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
        // 현재 구현에서는 preferredProvider 설정 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBeNull();
        expect(result.openaiClient).toBeNull();
        expect(result.geminiClient).toBeNull();
        expect(result.initializedProviders.length).toBe(0);
        expect(result.warnings.length).toBeGreaterThan(0);
        // TODO: 실제 구현 후에는 모든 provider 실패 시 logger.error()가 호출되어야 함
        // expect(loggerErrorSpy).toHaveBeenCalled();
        
        loggerWarnSpy.mockRestore();
        loggerErrorSpy.mockRestore();
      });
    });
  });
});

/**
 * LLMClientInitializer unit tests — LLM_PROVIDER fallback (auto)
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
    describe("LLM_PROVIDER='auto'", () => {
      /**
       * Given: LLM_PROVIDER='auto'이고 OpenAI API 키가 있음
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'openai'로 설정되어야 함 (첫 번째 우선순위)
       * And: Ollama 프로브는 생략되어 fetch가 호출되지 않아야 함 (#261)
       */
      it('should select OpenAI as preferredProvider when OpenAI is available (first priority)', async () => {
        // Given: LLM_PROVIDER='auto'이고 OpenAI API 키가 있음
        process.env.LLM_PROVIDER = 'auto';
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
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'gemini'로 설정되어야 함 (두 번째 우선순위)
       * And: Ollama 프로브는 생략되어 fetch가 호출되지 않아야 함 (#261)
       */
      it('should select Gemini as preferredProvider when OpenAI is not available but Gemini is available (second priority)', async () => {
        // Given: LLM_PROVIDER='auto'이고 OpenAI API 키가 없지만 Gemini API 키가 있음
        process.env.LLM_PROVIDER = 'auto';
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
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'ollama'로 설정되어야 함 (세 번째 우선순위)
       * 
       * Note: 현재 구현에서는 'auto' provider 선택 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should select Ollama as preferredProvider when OpenAI and Gemini are not available but Ollama is available (third priority)', async () => {
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

        // Then: preferredProvider가 'ollama'로 설정되어야 함 (세 번째 우선순위)
        // 현재 구현에서는 'auto' provider 선택 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBe('ollama');
        expect(result.openaiClient).toBeNull();
        expect(result.geminiClient).toBeNull();
        expect(result.initializedProviders).toContain('ollama');
      });

      /**
       * Given: LLM_PROVIDER='auto'이고 OpenAI, Gemini, Ollama 모두 사용 불가능함
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 null이어야 함
       * 
       * Note: 현재 구현에서는 'auto' provider 선택 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
       */
      it('should return null when all providers (OpenAI, Gemini, Ollama) are unavailable', async () => {
        // Given: LLM_PROVIDER='auto'이고 OpenAI, Gemini, Ollama 모두 사용 불가능함
        process.env.LLM_PROVIDER = 'auto';
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
        
        const initializer = new LLMClientInitializer();

        // When: initialize() 메서드 호출
        const result = await initializer.initialize();

        // Then: preferredProvider가 null이어야 함
        // 현재 구현에서는 'auto' provider 선택 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBeNull();
        expect(result.openaiClient).toBeNull();
        expect(result.geminiClient).toBeNull();
        expect(result.initializedProviders).not.toContain('ollama');
      });
    });
  });
});

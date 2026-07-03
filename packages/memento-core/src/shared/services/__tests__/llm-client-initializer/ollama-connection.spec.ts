/**
 * LLMClientInitializer unit tests — Ollama connection test
 */
import { resetLlmClientInitializerTestEnv, getMockMementoConfig } from './llm-client-initializer.test-setup.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMClientInitializer } from '../../llm-client-initializer.js';

const mockMementoConfig = getMockMementoConfig();

describe('LLMClientInitializer', () => {
  beforeEach(() => {
    resetLlmClientInitializerTestEnv();
  });

  describe('Ollama connection test', () => {
    let originalFetch: typeof global.fetch;
    let originalAbortSignal: typeof AbortSignal;

    beforeEach(() => {
      process.env.LLM_PROVIDER = 'ollama';
      originalFetch = global.fetch;
      originalAbortSignal = AbortSignal;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      global.AbortSignal = originalAbortSignal;
    });

    /**
     * Given: OLLAMA_BASE_URL이 설정되어 있고 Ollama 서버가 정상적으로 응답함 (HTTP 200 + JSON)
     * When: initialize() 메서드를 호출함
     * Then: GET {OLLAMA_BASE_URL}/api/tags 요청이 5초 타임아웃으로 실행되고, initializedProviders에 'ollama'가 추가되어야 함
     */
    it('should test Ollama connection and return "ollama" when HTTP 200 and JSON parsing succeeds', async () => {
      mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ models: [] })
      });
      global.fetch = mockFetch as typeof global.fetch;

      const mockAbortSignal = new EventTarget() as AbortSignal;
      const mockTimeout = vi.fn((ms: number) => mockAbortSignal);
      global.AbortSignal = {
        ...originalAbortSignal,
        timeout: mockTimeout
      } as typeof AbortSignal;

      const initializer = new LLMClientInitializer();
      const result = await initializer.initialize();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({
          method: 'GET',
          signal: expect.any(EventTarget)
        })
      );
      expect(mockTimeout).toHaveBeenCalledWith(5000);
      expect(result.initializedProviders).toContain('ollama');
    });

    /**
     * Given: OLLAMA_BASE_URL이 설정되어 있지만 Ollama 서버가 비-200 응답을 반환함
     * When: initialize() 메서드를 호출함
     * Then: initializedProviders에 'ollama'가 없고 warnings에 경고 메시지가 추가되어야 함
     */
    it('should return null and add warning when Ollama server returns non-200 response', async () => {
      mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });
      global.fetch = mockFetch as typeof global.fetch;

      const loggerModule = await import('../../../utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');

      const mockAbortSignal = new EventTarget() as AbortSignal;
      const mockTimeout = vi.fn((ms: number) => mockAbortSignal);
      global.AbortSignal = {
        ...originalAbortSignal,
        timeout: mockTimeout
      } as typeof AbortSignal;

      const initializer = new LLMClientInitializer();
      const result = await initializer.initialize();

      expect(result.initializedProviders).not.toContain('ollama');
      expect(loggerWarnSpy).toHaveBeenCalled();
      expect(result.warnings).toContain('Ollama 서버 연결 실패: HTTP 404 Not Found');

      loggerWarnSpy.mockRestore();
    });

    /**
     * Given: OLLAMA_BASE_URL이 설정되어 있지만 타임아웃(5초)이 발생함
     * When: initialize() 메서드를 호출함
     * Then: initializedProviders에 'ollama'가 없고 warnings에 경고 메시지가 추가되어야 함
     */
    it('should return null and add warning when Ollama connection times out (5 seconds)', async () => {
      mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';

      const mockAbortSignal = new EventTarget() as AbortSignal;
      Object.defineProperty(mockAbortSignal, 'aborted', { value: true });
      const mockTimeout = vi.fn((ms: number) => {
        setTimeout(() => {
          mockAbortSignal.dispatchEvent(new Event('abort'));
        }, 0);
        return mockAbortSignal;
      });
      global.AbortSignal = {
        ...originalAbortSignal,
        timeout: mockTimeout
      } as typeof AbortSignal;

      const timeoutError = new Error('The operation was aborted');
      timeoutError.name = 'AbortError';
      const mockFetch = vi.fn().mockRejectedValue(timeoutError);
      global.fetch = mockFetch as typeof global.fetch;

      const loggerModule = await import('../../../utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');

      const initializer = new LLMClientInitializer();
      const result = await initializer.initialize();

      expect(result.initializedProviders).not.toContain('ollama');
      expect(loggerWarnSpy).toHaveBeenCalled();
      expect(result.warnings).toContain('Ollama 연결 타임아웃 (5초)');

      loggerWarnSpy.mockRestore();
    });

    /**
     * Given: OLLAMA_BASE_URL이 설정되어 있지만 네트워크 에러가 발생함 (ECONNREFUSED, ENOTFOUND, fetch failed)
     * When: initialize() 메서드를 호출함
     * Then: initializedProviders에 'ollama'가 없고 warnings에 경고 메시지가 추가되어야 함
     */
    it('should return null and add warning when network error occurs (ECONNREFUSED, ENOTFOUND, fetch failed)', async () => {
      mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';

      const networkError = new Error('fetch failed');
      networkError.cause = { code: 'ECONNREFUSED' };
      const mockFetch = vi.fn().mockRejectedValue(networkError);
      global.fetch = mockFetch as typeof global.fetch;

      const mockAbortSignal = new EventTarget() as AbortSignal;
      const mockTimeout = vi.fn((ms: number) => mockAbortSignal);
      global.AbortSignal = {
        ...originalAbortSignal,
        timeout: mockTimeout
      } as typeof AbortSignal;

      const loggerModule = await import('../../../utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');

      const initializer = new LLMClientInitializer();
      const result = await initializer.initialize();

      expect(result.initializedProviders).not.toContain('ollama');
      expect(loggerWarnSpy).toHaveBeenCalled();
      expect(result.warnings).toContain('Ollama 네트워크 에러: fetch failed');

      loggerWarnSpy.mockRestore();
    });
  });
});

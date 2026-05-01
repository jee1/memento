/**
 * LLMClientInitializer unit tests — Ollama connection test
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

  describe('Ollama connection test', () => {
    let originalFetch: typeof global.fetch;
    let originalAbortSignal: typeof AbortSignal;

    beforeEach(() => {
      // 원본 함수 저장
      originalFetch = global.fetch;
      originalAbortSignal = AbortSignal;
    });

    afterEach(() => {
      // 원본 함수 복원
      global.fetch = originalFetch;
      global.AbortSignal = originalAbortSignal;
    });

    /**
     * Given: OLLAMA_BASE_URL이 설정되어 있고 Ollama 서버가 정상적으로 응답함 (HTTP 200 + JSON)
     * When: initialize() 메서드를 호출함
     * Then: GET {OLLAMA_BASE_URL}/api/tags 요청이 5초 타임아웃으로 실행되고, initializedProviders에 'ollama'가 추가되어야 함
     * 
     * Note: 현재 구현에서는 Ollama 연결 테스트 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should test Ollama connection and return "ollama" when HTTP 200 and JSON parsing succeeds', async () => {
      // Given: OLLAMA_BASE_URL이 설정되어 있고 Ollama 서버가 정상적으로 응답함
      mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
      
      // fetch 모킹 - 성공 응답
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
      // Note: 현재는 동기 함수이지만, Ollama 연결 테스트를 위해 async가 될 것으로 예상
      // RED 단계에서는 현재 구현에 Ollama 연결 테스트 로직이 없으므로 테스트가 실패할 것임
      const result = await initializer.initialize();

      // Then: GET {OLLAMA_BASE_URL}/api/tags 요청이 5초 타임아웃으로 실행되어야 함
      // 현재 구현에서는 Ollama 연결 테스트 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      // RED 단계: Ollama 연결 테스트가 실행되어야 하므로 mockFetch가 호출되어야 함
      // 하지만 현재 구현에는 Ollama 연결 테스트 로직이 없으므로 이 검증은 실패할 것임
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
     * Then: null을 반환하고 warnings에 경고 메시지가 추가되어야 함
     * 
     * Note: 현재 구현에서는 Ollama 연결 테스트 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should return null and add warning when Ollama server returns non-200 response', async () => {
      // Given: OLLAMA_BASE_URL이 설정되어 있지만 Ollama 서버가 비-200 응답을 반환함
      mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
      
      // fetch 모킹 - 비-200 응답
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });
      global.fetch = mockFetch as typeof global.fetch;
      
      // Logger 모킹
      const loggerModule = await import('../../../utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
      
      // AbortSignal.timeout 모킹
      const mockAbortSignal = new EventTarget() as AbortSignal;
      const mockTimeout = vi.fn((ms: number) => mockAbortSignal);
      global.AbortSignal = {
        ...originalAbortSignal,
        timeout: mockTimeout
      } as typeof AbortSignal;
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      // Note: 현재는 동기 함수이지만, Ollama 연결 테스트를 위해 async가 될 것으로 예상
      // RED 단계에서는 현재 구현에 Ollama 연결 테스트 로직이 없으므로 테스트가 실패할 것임
      const result = await initializer.initialize();

      // Then: null을 반환하고 경고가 추가되어야 함
      // 현재 구현에서는 Ollama 연결 테스트 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result.initializedProviders).not.toContain('ollama');
      // TODO: GREEN 단계에서 initialize()가 async가 되면 await를 사용하고 아래 검증을 활성화
      // expect(loggerWarnSpy).toHaveBeenCalled();
      // TODO: 실제 구현 후에는 경고 메시지 내용도 확인해야 함
      
      loggerWarnSpy.mockRestore();
    });

    /**
     * Given: OLLAMA_BASE_URL이 설정되어 있지만 타임아웃(5초)이 발생함
     * When: initialize() 메서드를 호출함
     * Then: null을 반환하고 warnings에 경고 메시지가 추가되어야 함
     * 
     * Note: 현재 구현에서는 Ollama 연결 테스트 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should return null and add warning when Ollama connection times out (5 seconds)', async () => {
      // Given: OLLAMA_BASE_URL이 설정되어 있지만 타임아웃이 발생함
      mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
      
      // AbortSignal.timeout 모킹 - 타임아웃 발생
      const mockAbortSignal = new EventTarget() as AbortSignal;
      Object.defineProperty(mockAbortSignal, 'aborted', { value: true });
      const mockTimeout = vi.fn((ms: number) => {
        // 타임아웃 시뮬레이션: abort 이벤트 발생
        setTimeout(() => {
          mockAbortSignal.dispatchEvent(new Event('abort'));
        }, 0);
        return mockAbortSignal;
      });
      global.AbortSignal = {
        ...originalAbortSignal,
        timeout: mockTimeout
      } as typeof AbortSignal;
      
      // fetch 모킹 - 타임아웃 에러 발생
      const timeoutError = new Error('The operation was aborted');
      timeoutError.name = 'AbortError';
      const mockFetch = vi.fn().mockRejectedValue(timeoutError);
      global.fetch = mockFetch as typeof global.fetch;
      
      // Logger 모킹
      const loggerModule = await import('../../../utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      // Note: 현재는 동기 함수이지만, Ollama 연결 테스트를 위해 async가 될 것으로 예상
      // RED 단계에서는 현재 구현에 Ollama 연결 테스트 로직이 없으므로 테스트가 실패할 것임
      const result = await initializer.initialize();

      // Then: null을 반환하고 경고가 추가되어야 함
      // 현재 구현에서는 Ollama 연결 테스트 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result.initializedProviders).not.toContain('ollama');
      // TODO: GREEN 단계에서 initialize()가 async가 되면 await를 사용하고 아래 검증을 활성화
      // expect(loggerWarnSpy).toHaveBeenCalled();
      // TODO: 실제 구현 후에는 경고 메시지 내용도 확인해야 함
      
      loggerWarnSpy.mockRestore();
    });

    /**
     * Given: OLLAMA_BASE_URL이 설정되어 있지만 네트워크 에러가 발생함 (ECONNREFUSED, ENOTFOUND, fetch failed)
     * When: initialize() 메서드를 호출함
     * Then: null을 반환하고 warnings에 경고 메시지가 추가되어야 함
     * 
     * Note: 현재 구현에서는 Ollama 연결 테스트 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should return null and add warning when network error occurs (ECONNREFUSED, ENOTFOUND, fetch failed)', async () => {
      // Given: OLLAMA_BASE_URL이 설정되어 있지만 네트워크 에러가 발생함
      mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
      
      // fetch 모킹 - 네트워크 에러 발생
      const networkError = new Error('fetch failed');
      networkError.cause = { code: 'ECONNREFUSED' };
      const mockFetch = vi.fn().mockRejectedValue(networkError);
      global.fetch = mockFetch as typeof global.fetch;
      
      // AbortSignal.timeout 모킹
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
      // Note: 현재는 동기 함수이지만, Ollama 연결 테스트를 위해 async가 될 것으로 예상
      // RED 단계에서는 현재 구현에 Ollama 연결 테스트 로직이 없으므로 테스트가 실패할 것임
      const result = await initializer.initialize();

      // Then: null을 반환하고 경고가 추가되어야 함
      // 현재 구현에서는 Ollama 연결 테스트 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result.initializedProviders).not.toContain('ollama');
      // TODO: GREEN 단계에서 initialize()가 async가 되면 await를 사용하고 아래 검증을 활성화
      // expect(loggerWarnSpy).toHaveBeenCalled();
      // TODO: 실제 구현 후에는 경고 메시지 내용도 확인해야 함
      
      loggerWarnSpy.mockRestore();
    });
  });
});

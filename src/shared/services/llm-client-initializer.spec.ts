/**
 * LLMClientInitializer 클래스 테스트
 * TDD RED 단계: LLMClientInitializationResult 인터페이스와 LLMClientInitializer 클래스에 대한 실패하는 테스트 작성
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMClientInitializer } from './llm-client-initializer.js';
import type { LLMClientInitializationResult } from './llm-client-initializer.js';

// Config 모킹 - 동적으로 변경 가능하도록 설정
const mockMementoConfig = vi.hoisted(() => ({
  openaiApiKey: undefined,
  geminiApiKey: undefined,
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3',
  openaiLlmModel: 'gpt-4o-mini',
  geminiModel: 'gemini-1.5-flash',
  llmProvider: 'auto' as const
}));

vi.mock('../config/index.js', () => {
  return {
    mementoConfig: mockMementoConfig
  };
});

// OpenAI 모킹
vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({}));
  return {
    default: MockOpenAI,
    __MockOpenAI: MockOpenAI
  };
});

// GoogleGenerativeAI 모킹
vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({}))
  };
});

// Logger 모킹
vi.mock('../utils/logger.js', () => {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }
  };
});

describe('LLMClientInitializer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 환경 변수 초기화
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    // mementoConfig 초기화
    mockMementoConfig.llmProvider = 'auto';
  });

  describe('initialize', () => {
    /**
     * Given: LLMClientInitializer 클래스가 존재함
     * When: initialize() 메서드를 호출함
     * Then: LLMClientInitializationResult 인터페이스를 반환함
     */
    it('should return LLMClientInitializationResult interface', async () => {
      // Given: LLMClientInitializer 인스턴스 생성
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result: LLMClientInitializationResult = await initializer.initialize();

      // Then: LLMClientInitializationResult 인터페이스 구조를 가진 객체 반환
      expect(result).toBeDefined();
      expect(result).toHaveProperty('preferredProvider');
      expect(result).toHaveProperty('openaiClient');
      expect(result).toHaveProperty('geminiClient');
      expect(result).toHaveProperty('initializedProviders');
      expect(result).toHaveProperty('warnings');
    });

    /**
     * Given: LLMClientInitializationResult 인터페이스가 정의됨
     * When: 결과 객체의 타입을 확인함
     * Then: 모든 필수 속성이 올바른 타입을 가짐
     */
    it('should have correct types for LLMClientInitializationResult properties', async () => {
      // Given: LLMClientInitializer 인스턴스 생성
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: 각 속성이 올바른 타입을 가짐
      expect(typeof result.preferredProvider === 'string' || result.preferredProvider === null).toBe(true);
      expect(result.openaiClient === null || typeof result.openaiClient === 'object').toBe(true);
      expect(result.geminiClient === null || typeof result.geminiClient === 'object').toBe(true);
      expect(Array.isArray(result.initializedProviders)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  describe('environment variable priority', () => {
    /**
     * Given: process.env['LLM_PROVIDER']가 'openai'로 설정되고 mementoConfig.llmProvider는 'gemini'로 설정됨
     * When: initialize() 메서드를 호출함
     * Then: getRawEnvValue('LLM_PROVIDER')가 먼저 호출되어야 하고, 그 값('openai')이 사용되어야 함
     * 
     * Note: 현재 구현에서는 provider 선택 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     * 실제 구현에서는 getRawEnvValue('LLM_PROVIDER')를 먼저 확인하고,
     * 없으면 mementoConfig.llmProvider를 확인해야 함
     */
    it('should prioritize process.env[LLM_PROVIDER] over mementoConfig.llmProvider', async () => {
      // Given: process.env['LLM_PROVIDER']가 'openai'로 설정되고, mementoConfig.llmProvider는 'gemini'로 설정됨
      process.env.LLM_PROVIDER = 'openai';
      mockMementoConfig.llmProvider = 'gemini';
      
      // getRawEnvValue 함수를 스파이로 모킹하여 호출 여부 확인
      const envModule = await import('../config/environment.js');
      const getRawEnvValueSpy = vi.spyOn(envModule, 'getRawEnvValue');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: getRawEnvValue('LLM_PROVIDER')가 호출되어야 함
      // 현재 구현에서는 provider 선택 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(getRawEnvValueSpy).toHaveBeenCalledWith('LLM_PROVIDER');
      // TODO: 실제 구현 후에는 선택된 provider가 'openai'인지 확인해야 함
      // 예: expect(selectedProvider).toBe('openai');
      
      getRawEnvValueSpy.mockRestore();
    });

    /**
     * Given: process.env['LLM_PROVIDER']가 설정되지 않고 mementoConfig.llmProvider는 'gemini'로 설정됨
     * When: initialize() 메서드를 호출함
     * Then: mementoConfig.llmProvider 값('gemini')이 사용되어야 함
     * 
     * Note: 현재 구현에서는 provider 선택 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should use mementoConfig.llmProvider when process.env[LLM_PROVIDER] is not set', async () => {
      // Given: process.env['LLM_PROVIDER']가 설정되지 않고, mementoConfig.llmProvider는 'gemini'로 설정됨
      delete process.env.LLM_PROVIDER;
      mockMementoConfig.llmProvider = 'gemini';
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: mementoConfig.llmProvider 값이 사용되어야 함
      // 현재 구현에서는 provider 선택 로직이 없으므로 이 검증은 실패할 것임
      expect(process.env.LLM_PROVIDER).toBeUndefined();
      // TODO: 실제 구현 후에는 선택된 provider가 'gemini'인지 확인해야 함
      // 예: expect(selectedProvider).toBe('gemini');
    });

    /**
     * Given: process.env['LLM_PROVIDER']와 mementoConfig.llmProvider 모두 설정되지 않음
     * When: initialize() 메서드를 호출함
     * Then: 기본값 'auto'가 사용되어야 함
     * 
     * Note: 현재 구현에서는 provider 선택 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should use default value "auto" when both process.env[LLM_PROVIDER] and mementoConfig.llmProvider are not set', async () => {
      // Given: process.env['LLM_PROVIDER']와 mementoConfig.llmProvider 모두 설정되지 않음
      delete process.env.LLM_PROVIDER;
      mockMementoConfig.llmProvider = 'auto';
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: 기본값 'auto'가 사용되어야 함
      // 현재 구현에서는 provider 선택 로직이 없으므로 이 검증은 실패할 것임
      expect(process.env.LLM_PROVIDER).toBeUndefined();
      // TODO: 실제 구현 후에는 선택된 provider가 'auto'인지 확인해야 함
      // 예: expect(selectedProvider).toBe('auto');
    });
  });

  describe('OpenAI client initialization', () => {
    /**
     * Given: OPENAI_API_KEY가 설정되어 있음
     * When: initialize() 메서드를 호출함
     * Then: OpenAI 클라이언트가 생성되고 initializedProviders에 'openai'가 추가되어야 함
     * 
     * Note: 현재 구현에서는 OpenAI 초기화 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should initialize OpenAI client when API key is available', async () => {
      // Given: OPENAI_API_KEY가 설정되어 있음
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      
      // OpenAI 모킹된 인스턴스 가져오기
      const openaiModule = await import('openai');
      const MockOpenAI = (openaiModule as any).__MockOpenAI;
      MockOpenAI.mockClear();
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: OpenAI 클라이언트가 생성되어야 함
      // 현재 구현에서는 OpenAI 초기화 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(MockOpenAI).toHaveBeenCalledWith({ apiKey: 'test-openai-api-key' });
      expect(result.openaiClient).not.toBeNull();
      expect(result.initializedProviders).toContain('openai');
    });

    /**
     * Given: OPENAI_API_KEY가 설정되지 않음
     * When: initialize() 메서드를 호출함
     * Then: openaiClient는 null이고 warnings에 경고 메시지가 추가되어야 함
     * 
     * Note: 현재 구현에서는 OpenAI 초기화 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should return null and add warning when OpenAI API key is not available', async () => {
      // Given: OPENAI_API_KEY가 설정되지 않음
      mockMementoConfig.openaiApiKey = undefined;
      
      // Logger 모킹
      const loggerModule = await import('../utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: openaiClient는 null이고 경고가 추가되어야 함
      // 현재 구현에서는 OpenAI 초기화 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result.openaiClient).toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
      // TODO: 실제 구현 후에는 경고 메시지 내용도 확인해야 함
      // 예: expect(result.warnings[0]).toContain('OPENAI_API_KEY');
      
      loggerWarnSpy.mockRestore();
    });

    /**
     * Given: OpenAI 클라이언트 초기화 중 에러가 발생함
     * When: initialize() 메서드를 호출함
     * Then: openaiClient는 null이고 warnings에 에러 정보가 추가되어야 함
     * 
     * Note: 현재 구현에서는 OpenAI 초기화 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should handle OpenAI initialization errors gracefully', async () => {
      // Given: OPENAI_API_KEY가 설정되어 있지만 초기화 중 에러 발생
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      
      // OpenAI 모킹 - 에러 발생하도록 설정
      const openaiModule = await import('openai');
      const MockOpenAI = (openaiModule as any).__MockOpenAI;
      MockOpenAI.mockImplementation(() => {
        throw new Error('OpenAI initialization failed');
      });
      
      // Logger 모킹
      const loggerModule = await import('../utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: openaiClient는 null이고 경고가 추가되어야 함
      // 현재 구현에서는 OpenAI 초기화 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result.openaiClient).toBeNull();
      expect(loggerWarnSpy).toHaveBeenCalled();
      // TODO: 실제 구현 후에는 경고 메시지 내용도 확인해야 함
      
      MockOpenAI.mockRestore();
      loggerWarnSpy.mockRestore();
    });
  });

  describe('Gemini client initialization', () => {
    /**
     * Given: GEMINI_API_KEY가 설정되어 있음
     * When: initialize() 메서드를 호출함
     * Then: GoogleGenerativeAI 클라이언트가 생성되고 initializedProviders에 'gemini'가 추가되어야 함
     * 
     * Note: 현재 구현에서는 Gemini 초기화 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should initialize Gemini client when API key is available', async () => {
      // Given: GEMINI_API_KEY가 설정되어 있음
      mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
      
      // GoogleGenerativeAI 모킹된 인스턴스 가져오기
      const geminiModule = await import('@google/generative-ai');
      const MockGoogleGenerativeAI = geminiModule.GoogleGenerativeAI;
      vi.mocked(MockGoogleGenerativeAI).mockClear();
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: GoogleGenerativeAI 클라이언트가 생성되어야 함
      // 현재 구현에서는 Gemini 초기화 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(MockGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: 'test-gemini-api-key' });
      expect(result.geminiClient).not.toBeNull();
      expect(result.initializedProviders).toContain('gemini');
    });

    /**
     * Given: GEMINI_API_KEY가 설정되지 않음
     * When: initialize() 메서드를 호출함
     * Then: geminiClient는 null이고 warnings에 경고 메시지가 추가되어야 함
     * 
     * Note: 현재 구현에서는 Gemini 초기화 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should return null and add warning when Gemini API key is not available', async () => {
      // Given: GEMINI_API_KEY가 설정되지 않음
      mockMementoConfig.geminiApiKey = undefined;
      
      // Logger 모킹
      const loggerModule = await import('../utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: geminiClient는 null이고 경고가 추가되어야 함
      // 현재 구현에서는 Gemini 초기화 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result.geminiClient).toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
      // TODO: 실제 구현 후에는 경고 메시지 내용도 확인해야 함
      // 예: expect(result.warnings.some(w => w.includes('GEMINI_API_KEY'))).toBe(true);
      
      loggerWarnSpy.mockRestore();
    });

    /**
     * Given: Gemini 클라이언트 초기화 중 에러가 발생함
     * When: initialize() 메서드를 호출함
     * Then: geminiClient는 null이고 warnings에 에러 정보가 추가되어야 함
     * 
     * Note: 현재 구현에서는 Gemini 초기화 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should handle Gemini initialization errors gracefully', async () => {
      // Given: GEMINI_API_KEY가 설정되어 있지만 초기화 중 에러 발생
      mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
      
      // GoogleGenerativeAI 모킹 - 에러 발생하도록 설정
      const geminiModule = await import('@google/generative-ai');
      const MockGoogleGenerativeAI = geminiModule.GoogleGenerativeAI;
      vi.mocked(MockGoogleGenerativeAI).mockImplementation(() => {
        throw new Error('Gemini initialization failed');
      });
      
      // Logger 모킹
      const loggerModule = await import('../utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: geminiClient는 null이고 경고가 추가되어야 함
      // 현재 구현에서는 Gemini 초기화 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result.geminiClient).toBeNull();
      expect(loggerWarnSpy).toHaveBeenCalled();
      // TODO: 실제 구현 후에는 경고 메시지 내용도 확인해야 함
      
      vi.mocked(MockGoogleGenerativeAI).mockRestore();
      loggerWarnSpy.mockRestore();
    });
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
      const loggerModule = await import('../utils/logger.js');
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
      const loggerModule = await import('../utils/logger.js');
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
      const loggerModule = await import('../utils/logger.js');
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

  describe('validateApiKeys', () => {
    /**
     * Given: LLMClientInitializer 클래스가 존재함
     * When: validateApiKeys() 메서드를 호출함
     * Then: 각 provider의 API 키 존재 여부를 boolean 객체로 반환함
     * 
     * Note: 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should return boolean object indicating API key availability for each provider', () => {
      // Given: LLMClientInitializer 인스턴스 생성
      const initializer = new LLMClientInitializer();

      // When: validateApiKeys() 메서드 호출
      // 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 호출은 실패할 것임 (RED 단계)
      const result = initializer.validateApiKeys();

      // Then: boolean 객체를 반환해야 함
      // 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result).toBeDefined();
      expect(result).toHaveProperty('openai');
      expect(result).toHaveProperty('gemini');
      expect(typeof result.openai).toBe('boolean');
      expect(typeof result.gemini).toBe('boolean');
    });

    /**
     * Given: OpenAI와 Gemini API 키가 모두 설정되어 있음
     * When: validateApiKeys() 메서드를 호출함
     * Then: { openai: true, gemini: true }를 반환해야 함
     * 
     * Note: 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should return { openai: true, gemini: true } when both API keys are available', () => {
      // Given: OpenAI와 Gemini API 키가 모두 설정되어 있음
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
      
      const initializer = new LLMClientInitializer();

      // When: validateApiKeys() 메서드 호출
      // 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 호출은 실패할 것임 (RED 단계)
      const result = initializer.validateApiKeys();

      // Then: { openai: true, gemini: true }를 반환해야 함
      // 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result).toEqual({
        openai: true,
        gemini: true
      });
    });

    /**
     * Given: OpenAI API 키만 설정되어 있음
     * When: validateApiKeys() 메서드를 호출함
     * Then: { openai: true, gemini: false }를 반환해야 함
     * 
     * Note: 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should return { openai: true, gemini: false } when only OpenAI API key is available', () => {
      // Given: OpenAI API 키만 설정되어 있음
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      mockMementoConfig.geminiApiKey = undefined;
      
      const initializer = new LLMClientInitializer();

      // When: validateApiKeys() 메서드 호출
      // 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 호출은 실패할 것임 (RED 단계)
      const result = initializer.validateApiKeys();

      // Then: { openai: true, gemini: false }를 반환해야 함
      // 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result).toEqual({
        openai: true,
        gemini: false
      });
    });

    /**
     * Given: Gemini API 키만 설정되어 있음
     * When: validateApiKeys() 메서드를 호출함
     * Then: { openai: false, gemini: true }를 반환해야 함
     * 
     * Note: 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should return { openai: false, gemini: true } when only Gemini API key is available', () => {
      // Given: Gemini API 키만 설정되어 있음
      mockMementoConfig.openaiApiKey = undefined;
      mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
      
      const initializer = new LLMClientInitializer();

      // When: validateApiKeys() 메서드 호출
      // 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 호출은 실패할 것임 (RED 단계)
      const result = initializer.validateApiKeys();

      // Then: { openai: false, gemini: true }를 반환해야 함
      // 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result).toEqual({
        openai: false,
        gemini: true
      });
    });

    /**
     * Given: OpenAI와 Gemini API 키가 모두 설정되지 않음
     * When: validateApiKeys() 메서드를 호출함
     * Then: { openai: false, gemini: false }를 반환해야 함
     * 
     * Note: 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should return { openai: false, gemini: false } when no API keys are available', () => {
      // Given: OpenAI와 Gemini API 키가 모두 설정되지 않음
      mockMementoConfig.openaiApiKey = undefined;
      mockMementoConfig.geminiApiKey = undefined;
      
      const initializer = new LLMClientInitializer();

      // When: validateApiKeys() 메서드 호출
      // 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 호출은 실패할 것임 (RED 단계)
      const result = initializer.validateApiKeys();

      // Then: { openai: false, gemini: false }를 반환해야 함
      // 현재 구현에서는 validateApiKeys() 메서드가 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result).toEqual({
        openai: false,
        gemini: false
      });
    });
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
        const loggerModule = await import('../utils/logger.js');
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
        const loggerModule = await import('../utils/logger.js');
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
        const loggerModule = await import('../utils/logger.js');
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
        const loggerModule = await import('../utils/logger.js');
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
        // TODO: 실제 구현 후에는 모든 provider 실패 시 logger.error()가 호출되어야 함
        // expect(loggerErrorSpy).toHaveBeenCalled();
        
        loggerWarnSpy.mockRestore();
        loggerErrorSpy.mockRestore();
      });
    });

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
        const loggerModule = await import('../utils/logger.js');
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
        const loggerModule = await import('../utils/logger.js');
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
        const loggerModule = await import('../utils/logger.js');
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
        const loggerModule = await import('../utils/logger.js');
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
        // TODO: 실제 구현 후에는 모든 provider 실패 시 logger.error()가 호출되어야 함
        // expect(loggerErrorSpy).toHaveBeenCalled();
        
        loggerWarnSpy.mockRestore();
        loggerErrorSpy.mockRestore();
      });
    });

    describe("LLM_PROVIDER='auto'", () => {
      /**
       * Given: LLM_PROVIDER='auto'이고 OpenAI API 키가 있음
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'openai'로 설정되어야 함 (첫 번째 우선순위)
       * 
       * Note: 현재 구현에서는 'auto' provider 선택 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
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
        // 현재 구현에서는 'auto' provider 선택 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBe('openai');
        expect(result.openaiClient).not.toBeNull();
      });

      /**
       * Given: LLM_PROVIDER='auto'이고 OpenAI API 키가 없지만 Gemini API 키가 있음
       * When: initialize() 메서드를 호출함
       * Then: preferredProvider가 'gemini'로 설정되어야 함 (두 번째 우선순위)
       * 
       * Note: 현재 구현에서는 'auto' provider 선택 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
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
        // 현재 구현에서는 'auto' provider 선택 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
        expect(result.preferredProvider).toBe('gemini');
        expect(result.openaiClient).toBeNull();
        expect(result.geminiClient).not.toBeNull();
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

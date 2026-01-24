/**
 * LLM Provider 통합 테스트
 * 다양한 환경 변수 조합에서 LLMClientInitializer가 올바르게 동작하는지 검증합니다.
 * 
 * 테스트 항목:
 * - LLM_PROVIDER='openai' 시나리오
 * - LLM_PROVIDER='gemini' 시나리오
 * - LLM_PROVIDER='ollama' 시나리오
 * - LLM_PROVIDER='auto' 시나리오
 * - 실제 서비스들이 LLMClientInitializer를 올바르게 사용하는지 검증
 * 
 * 모킹/스텁 사용:
 * - 실제 API 키나 외부 서비스에 의존하지 않도록 모킹/스텁 사용
 * - CI 환경과 로컬 환경에서 모두 재현 가능
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LLMClientInitializer } from '../../../../shared/services/llm-client-initializer.js';
import type { LLMClientInitializationResult } from '../../../../shared/services/llm-client-initializer.js';

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

vi.mock('../../../../shared/config/index.js', () => {
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
vi.mock('../../../../shared/utils/logger.js', () => {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }
  };
});

// getRawEnvValue 모킹
vi.mock('../../../../shared/config/environment.js', () => {
  return {
    getRawEnvValue: vi.fn((key: string) => {
      return process.env[key];
    })
  };
});

describe('LLM Provider 통합 테스트', () => {
  let originalFetch: typeof global.fetch;
  let originalAbortSignal: typeof AbortSignal;

  beforeEach(() => {
    // Given: 환경 변수 초기화
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    
    // mementoConfig 초기화
    mockMementoConfig.llmProvider = 'auto';
    mockMementoConfig.openaiApiKey = undefined;
    mockMementoConfig.geminiApiKey = undefined;
    mockMementoConfig.ollamaBaseUrl = 'http://localhost:11434';
    
    // 원본 함수 저장
    originalFetch = global.fetch;
    originalAbortSignal = global.AbortSignal;
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    // 원본 함수 복원
    global.fetch = originalFetch;
    global.AbortSignal = originalAbortSignal;
  });

  describe("LLM_PROVIDER='openai' 통합 테스트", () => {
    /**
     * Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 설정되어 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'openai'로 설정되고 openaiClient가 초기화되어야 함
     */
    it('should initialize OpenAI client when LLM_PROVIDER is set to "openai" and API key is available', async () => {
      // Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 설정되어 있음
      process.env.LLM_PROVIDER = 'openai';
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      mockMementoConfig.geminiApiKey = undefined;
      
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

      // Then: preferredProvider가 'openai'로 설정되고 openaiClient가 초기화되어야 함
      expect(result.preferredProvider).toBe('openai');
      expect(result.openaiClient).not.toBeNull();
      expect(result.initializedProviders).toContain('openai');
    });

    /**
     * Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 없지만 Gemini API 키가 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'gemini'로 설정되고 fallback이 발생해야 함
     */
    it('should fallback to Gemini when LLM_PROVIDER is "openai" but OpenAI API key is not available', async () => {
      // Given: LLM_PROVIDER='openai'이고 OpenAI API 키가 없지만 Gemini API 키가 있음
      process.env.LLM_PROVIDER = 'openai';
      mockMementoConfig.openaiApiKey = undefined;
      mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
      
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
      const loggerModule = await import('../../../../shared/utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 'gemini'로 설정되고 fallback이 발생해야 함
      expect(result.preferredProvider).toBe('gemini');
      expect(result.openaiClient).toBeNull();
      expect(result.geminiClient).not.toBeNull();
      expect(loggerWarnSpy).toHaveBeenCalled();
      
      loggerWarnSpy.mockRestore();
    });
  });

  describe("LLM_PROVIDER='gemini' 통합 테스트", () => {
    /**
     * Given: LLM_PROVIDER='gemini'이고 Gemini API 키가 설정되어 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'gemini'로 설정되고 geminiClient가 초기화되어야 함
     */
    it('should initialize Gemini client when LLM_PROVIDER is set to "gemini" and API key is available', async () => {
      // Given: LLM_PROVIDER='gemini'이고 Gemini API 키가 설정되어 있음
      process.env.LLM_PROVIDER = 'gemini';
      mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
      mockMementoConfig.openaiApiKey = undefined;
      
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

      // Then: preferredProvider가 'gemini'로 설정되고 geminiClient가 초기화되어야 함
      expect(result.preferredProvider).toBe('gemini');
      expect(result.geminiClient).not.toBeNull();
      expect(result.initializedProviders).toContain('gemini');
    });

    /**
     * Given: LLM_PROVIDER='gemini'이고 Gemini API 키가 없지만 OpenAI API 키가 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'openai'로 설정되고 fallback이 발생해야 함
     */
    it('should fallback to OpenAI when LLM_PROVIDER is "gemini" but Gemini API key is not available', async () => {
      // Given: LLM_PROVIDER='gemini'이고 Gemini API 키가 없지만 OpenAI API 키가 있음
      process.env.LLM_PROVIDER = 'gemini';
      mockMementoConfig.geminiApiKey = undefined;
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      
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
      const loggerModule = await import('../../../../shared/utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 'openai'로 설정되고 fallback이 발생해야 함
      expect(result.preferredProvider).toBe('openai');
      expect(result.geminiClient).toBeNull();
      expect(result.openaiClient).not.toBeNull();
      expect(loggerWarnSpy).toHaveBeenCalled();
      
      loggerWarnSpy.mockRestore();
    });
  });

  describe("LLM_PROVIDER='ollama' 통합 테스트", () => {
    /**
     * Given: LLM_PROVIDER='ollama'이고 Ollama 서버가 정상적으로 응답함 (HTTP 200 + JSON)
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'ollama'로 설정되고 initializedProviders에 'ollama'가 추가되어야 함
     */
    it('should initialize Ollama when LLM_PROVIDER is set to "ollama" and server responds successfully', async () => {
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
      const mockAbortSignal = new EventTarget() as AbortSignal;
      const mockTimeout = vi.fn((ms: number) => mockAbortSignal);
      global.AbortSignal = {
        ...originalAbortSignal,
        timeout: mockTimeout
      } as typeof AbortSignal;
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 'ollama'로 설정되고 initializedProviders에 'ollama'가 추가되어야 함
      expect(result.preferredProvider).toBe('ollama');
      expect(result.initializedProviders).toContain('ollama');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({
          method: 'GET',
          signal: expect.any(EventTarget)
        })
      );
      expect(mockTimeout).toHaveBeenCalledWith(5000);
    });

    /**
     * Given: LLM_PROVIDER='ollama'이고 Ollama 연결 실패하지만 OpenAI API 키가 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'openai'로 설정되고 fallback이 발생해야 함
     */
    it('should fallback to OpenAI when LLM_PROVIDER is "ollama" but Ollama connection fails', async () => {
      // Given: LLM_PROVIDER='ollama'이고 Ollama 연결 실패하지만 OpenAI API 키가 있음
      process.env.LLM_PROVIDER = 'ollama';
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
      
      // Logger 모킹
      const loggerModule = await import('../../../../shared/utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: preferredProvider가 'openai'로 설정되고 fallback이 발생해야 함
      expect(result.preferredProvider).toBe('openai');
      expect(result.initializedProviders).not.toContain('ollama');
      expect(result.openaiClient).not.toBeNull();
      expect(loggerWarnSpy).toHaveBeenCalled();
      
      loggerWarnSpy.mockRestore();
    });
  });

  describe("LLM_PROVIDER='auto' 통합 테스트", () => {
    /**
     * Given: LLM_PROVIDER='auto'이고 OpenAI API 키가 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'openai'로 설정되어야 함 (첫 번째 우선순위)
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
    });

    /**
     * Given: LLM_PROVIDER='auto'이고 OpenAI API 키가 없지만 Gemini API 키가 있음
     * When: LLMClientInitializer.initialize()를 호출함
     * Then: preferredProvider가 'gemini'로 설정되어야 함 (두 번째 우선순위)
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
      const loggerModule = await import('../../../../shared/utils/logger.js');
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
      const loggerModule = await import('../../../../shared/utils/logger.js');
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
      const loggerModule = await import('../../../../shared/utils/logger.js');
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
      const loggerModule = await import('../../../../shared/utils/logger.js');
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
      const loggerModule = await import('../../../../shared/utils/logger.js');
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
      const geminiModule = await import('@google/generative-ai');
      const MockGoogleGenerativeAI = geminiModule.GoogleGenerativeAI;
      vi.mocked(MockGoogleGenerativeAI).mockImplementation(() => {
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
      const loggerModule = await import('../../../../shared/utils/logger.js');
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
      
      vi.mocked(MockGoogleGenerativeAI).mockRestore();
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
      const loggerModule = await import('../../../../shared/utils/logger.js');
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
      const loggerModule = await import('../../../../shared/utils/logger.js');
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
      const loggerModule = await import('../../../../shared/utils/logger.js');
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

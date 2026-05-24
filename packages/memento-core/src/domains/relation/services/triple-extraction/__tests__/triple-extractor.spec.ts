/**
 * TripleExtractor 클래스 테스트
 * TDD GREEN 단계: TripleExtractor 클래스 구현 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TripleExtractor } from '../triple-extractor.js';
import type { TripleExtractionOptions } from '../../../../../shared/types/triple-extraction.js';
import { LLMClientInitializer } from '../../../../../shared/services/llm-client-initializer.js';
import type { LLMClientInitializationResult } from '../../../../../shared/services/llm-client-initializer.js';
import { logger } from '../../../../../shared/utils/logger.js';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Config 모킹
vi.mock('../../../../../shared/config/index.js', () => {
  return {
    mementoConfig: {
      openaiApiKey: 'test-openai-key',
      geminiApiKey: 'test-gemini-key',
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'llama3',
      openaiLlmModel: 'gpt-4o-mini',
      geminiModel: 'gemini-1.5-flash',
      geminiLlmModel: 'gemini-2.0-flash',
      llmModelOverrides: {},
      llmProvider: 'openai'
    }
  };
});

// OpenAI 모킹
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate
      }
    }
  }));
  return {
    default: MockOpenAI,
    __mockCreate: mockCreate,
    __MockOpenAI: MockOpenAI
  };
});

// GoogleGenerativeAI 모킹
vi.mock('@google/generative-ai', () => {
  const mockGenerateContent = vi.fn();
  const mockGetGenerativeModel = vi.fn(() => ({
    generateContent: mockGenerateContent
  }));
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel
    })),
    __mockGenerateContent: mockGenerateContent,
    __mockGetGenerativeModel: mockGetGenerativeModel
  };
});

// Ollama fetch 모킹
global.fetch = vi.fn();

describe('TripleExtractor', () => {
  let mockOpenAICreate: any;
  let mockGeminiGenerateContent: any;
  let mockGeminiGetGenerativeModel: any;

  beforeEach(async () => {
    // 환경 변수 모킹
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    process.env.LLM_PROVIDER = 'openai';

    // 모킹된 함수 가져오기
    const openaiModule = await import('openai');
    mockOpenAICreate = (openaiModule as any).__mockCreate;
    
    const geminiModule = await import('@google/generative-ai');
    mockGeminiGenerateContent = (geminiModule as any).__mockGenerateContent;
    mockGeminiGetGenerativeModel = (geminiModule as any).__mockGetGenerativeModel;

    // 기본 모킹된 응답 설정
    const defaultTripleResponse = JSON.stringify({
      triples: [
        { subject: 'John', predicate: 'is', object: 'developer' }
      ]
    });

    // OpenAI 모킹 응답
    mockOpenAICreate.mockResolvedValue({
      choices: [{
        message: {
          content: defaultTripleResponse
        }
      }]
    });

    // Gemini 모킹 응답
    mockGeminiGetGenerativeModel.mockReturnValue({
      generateContent: mockGeminiGenerateContent
    });
    mockGeminiGenerateContent.mockResolvedValue({
      response: {
        text: () => defaultTripleResponse
      }
    });

    // Ollama 모킹 응답 (모델 존재 여부 확인 및 채팅 응답)
    (global.fetch as any).mockImplementation((url: string) => {
      // 모델 존재 여부 확인 API
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [{ name: 'llama3' }]
          })
        });
      }
      // 채팅 API
      return Promise.resolve({
        ok: true,
        headers: {
          get: () => 'application/json'
        },
        text: async () => JSON.stringify({
          message: {
            content: defaultTripleResponse
          }
        })
      });
    });
  });

  describe('extract 메서드', () => {
    it('Given: 텍스트와 추출 옵션이 제공됨, When: extract 메서드를 호출함, Then: 추출된 Triple 배열과 rawResponse, provider를 반환함', async () => {
      // Given: 텍스트와 추출 옵션이 제공됨
      const text = 'John is a developer.';
      const options: TripleExtractionOptions = {};

      // 모킹된 응답 설정
      const tripleResponse = JSON.stringify({
        triples: [
          { subject: 'John', predicate: 'is', object: 'developer' }
        ]
      });
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: tripleResponse
          }
        }]
      });

      // When: extract 메서드를 호출함
      const extractor = new TripleExtractor();
      const result = await extractor.extract(text, options);

      // Then: 추출된 Triple 배열과 rawResponse, provider를 반환함
      expect(result).toHaveProperty('triples');
      expect(result).toHaveProperty('rawResponse');
      expect(result).toHaveProperty('provider');
      expect(Array.isArray(result.triples)).toBe(true);
      expect(typeof result.rawResponse).toBe('string');
      expect(['openai', 'gemini', 'ollama']).toContain(result.provider);
    });

    it('Given: 텍스트가 제공됨, When: extract 메서드를 호출함, Then: Triple 배열이 반환됨', async () => {
      // Given: 텍스트가 제공됨
      const text = 'Alice works at Google.';

      // 모킹된 응답 설정
      const tripleResponse = JSON.stringify({
        triples: [
          { subject: 'Alice', predicate: 'works at', object: 'Google' }
        ]
      });
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: tripleResponse
          }
        }]
      });

      // When: extract 메서드를 호출함
      const extractor = new TripleExtractor();
      const result = await extractor.extract(text);

      // Then: Triple 배열이 반환됨
      expect(Array.isArray(result.triples)).toBe(true);
      if (result.triples.length > 0) {
        expect(result.triples[0]).toHaveProperty('subject');
        expect(result.triples[0]).toHaveProperty('predicate');
        expect(result.triples[0]).toHaveProperty('object');
      }
    });

    it('Given: 추출 옵션이 제공됨, When: extract 메서드를 호출함, Then: 옵션이 적용된 결과를 반환함', async () => {
      // Given: 추출 옵션이 제공됨
      const text = 'Bob likes programming.';
      const options: TripleExtractionOptions = {
        temperature: 0.5,
        maxTokens: 1000
      };

      // 모킹된 응답 설정
      const tripleResponse = JSON.stringify({
        triples: [
          { subject: 'Bob', predicate: 'likes', object: 'programming' }
        ]
      });
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{
          message: {
            content: tripleResponse
          }
        }]
      });

      // When: extract 메서드를 호출함
      const extractor = new TripleExtractor();
      const result = await extractor.extract(text, options);

      // Then: 옵션이 적용된 결과를 반환함
      expect(result).toHaveProperty('triples');
      expect(result).toHaveProperty('rawResponse');
      expect(result).toHaveProperty('provider');
    });

    it('Given: 모든 provider가 사용 불가능한 상태, When: extract 메서드를 호출함, Then: 명확한 에러 메시지와 함께 에러가 발생해야 함', async () => {
      // Given: 모든 provider가 사용 불가능한 상태
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: null,
        openaiClient: null,
        geminiClient: null,
        initializedProviders: [],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      const extractor = new TripleExtractor();
      // 초기화 완료를 보장하기 위해 initializationPromise 대기
      if (extractor['initializationPromise']) {
        await extractor['initializationPromise'];
      }

      const text = '테스트 텍스트';

      // When: extract 메서드를 호출함
      // Then: 에러가 발생하고, 에러 메시지가 명확해야 함
      await expect(extractor.extract(text)).rejects.toThrow('사용 가능한 LLM Provider가 없습니다.');
      
      // Then: 에러 타입이 Error여야 함
      try {
        await extractor.extract(text);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('사용 가능한 LLM Provider가 없습니다.');
      }
    });
  });

  describe('initializeClients', () => {
    it('Given: TripleExtractor 인스턴스가 생성됨, When: extract 메서드를 호출함, Then: initializeClients()가 LLMClientInitializer.initialize()를 호출해야 함', async () => {
      // Given: LLMClientInitializer를 모킹하고 initialize() 메서드를 모킹
      const mockOpenAIClient = new OpenAI({ apiKey: 'test-openai-key' });
      const mockGeminiClient = new GoogleGenerativeAI('test-gemini-key');
      
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: 'openai',
        openaiClient: mockOpenAIClient,
        geminiClient: mockGeminiClient,
        initializedProviders: ['openai', 'gemini'],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      // When: TripleExtractor 인스턴스 생성 및 extract 메서드 호출
      const extractor = new TripleExtractor();
      await extractor.extract('test');
      
      // Then: LLMClientInitializer.initialize()가 호출되었는지 확인
      expect(mockInitializer.initialize).toHaveBeenCalledTimes(1);
    });

    it('TripleExtractor에서 preferredProvider가 있으면 warnings가 있어도 LLM 초기화 경고를 logger.warn으로 재출력하지 않아야 함', async () => {
      // Given: preferredProvider와 warnings를 함께 반환하는 LLMClientInitializer 결과를 모킹
      const mockOpenAIClient = new OpenAI({ apiKey: 'test-openai-key' });
      const mockGeminiClient = new GoogleGenerativeAI('test-gemini-key');
      const mockWarnings = ['Warning 1', 'Warning 2'];
      
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: 'openai',
        openaiClient: mockOpenAIClient,
        geminiClient: mockGeminiClient,
        initializedProviders: ['openai', 'gemini'],
        warnings: mockWarnings
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );
      
      const loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      // When: TripleExtractor 인스턴스 생성 및 extract 메서드 호출
      const extractor = new TripleExtractor();
      await extractor.extract('test');
      
      // Then: LLMClientInitializer 결과가 사용되어 클라이언트와 preferredProvider가 설정되어야 함
      // openaiClient와 geminiClient는 private이므로 @ts-expect-error를 사용하여 접근
      // @ts-expect-error - private 필드 접근 (테스트 목적)
      expect(extractor.openaiClient).toBe(mockOpenAIClient);
      // @ts-expect-error - private 필드 접근 (테스트 목적)
      expect(extractor.geminiClient).toBe(mockGeminiClient);
      // @ts-expect-error - private 필드 접근 (테스트 목적)
      expect(extractor.preferredProvider).toBe('openai');
      
      // Then: preferredProvider가 있으면 warnings를 relation layer에서 재로깅하지 않아야 함
      const llmInitWarningCalls = loggerWarnSpy.mock.calls.filter(
        (call) => call[0] === 'LLM 초기화 경고',
      );

      expect(llmInitWarningCalls).toHaveLength(0);
    });
  });

  describe('determineProvider', () => {
    it('Given: OpenAI 클라이언트가 초기화된 상태, When: openai provider를 요청함, Then: openai provider를 반환해야 함', async () => {
      // Given: OpenAI 클라이언트가 초기화된 상태
      const mockOpenAIClient = new OpenAI({ apiKey: 'test-openai-key' });
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: 'openai',
        openaiClient: mockOpenAIClient,
        geminiClient: null,
        initializedProviders: ['openai'],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      const extractor = new TripleExtractor();
      // 초기화 완료를 보장하기 위해 extract() 호출
      await extractor.extract('test');

      // When: 'openai' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = extractor.determineProvider('openai');

      // Then: 'openai' provider를 반환해야 함
      expect(result).toBe('openai');
    });

    it('Given: OpenAI 클라이언트가 초기화되지 않고 Gemini 클라이언트만 초기화된 상태, When: openai provider를 요청함, Then: fallback으로 gemini provider를 반환해야 함', async () => {
      // Given: OpenAI 클라이언트가 초기화되지 않고 Gemini 클라이언트만 초기화된 상태
      const mockGeminiClient = new GoogleGenerativeAI('test-gemini-key');
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: 'gemini',
        openaiClient: null,
        geminiClient: mockGeminiClient,
        initializedProviders: ['gemini'],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      const extractor = new TripleExtractor();
      // 초기화 완료를 보장하기 위해 extract() 호출
      await extractor.extract('test');

      // When: 'openai' provider를 요청 (하지만 OpenAI는 사용 불가능)
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = extractor.determineProvider('openai');

      // Then: fallback으로 'gemini' provider를 반환해야 함
      expect(result).toBe('gemini');
    });

    it('Given: 모든 클라이언트가 초기화되지 않은 상태, When: openai provider를 요청함, Then: null을 반환해야 함', async () => {
      // Given: 모든 클라이언트가 초기화되지 않은 상태
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: null,
        openaiClient: null,
        geminiClient: null,
        initializedProviders: [],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      const extractor = new TripleExtractor();
      // 초기화 완료를 보장하기 위해 initializationPromise 대기
      if (extractor['initializationPromise']) {
        await extractor['initializationPromise'];
      }

      // When: 'openai' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = extractor.determineProvider('openai');

      // Then: null을 반환해야 함
      expect(result).toBeNull();
    });

    it("Given: OpenAI 클라이언트가 초기화된 상태, When: 'auto' provider를 요청함, Then: 사용 가능한 첫 번째 provider(openai)를 반환해야 함", async () => {
      // Given: OpenAI 클라이언트가 초기화된 상태
      const mockOpenAIClient = new OpenAI({ apiKey: 'test-openai-key' });
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: 'openai',
        openaiClient: mockOpenAIClient,
        geminiClient: null,
        initializedProviders: ['openai'],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      const extractor = new TripleExtractor();
      // 초기화 완료를 보장하기 위해 extract() 호출
      await extractor.extract('test');

      // When: 'auto' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = extractor.determineProvider('auto');

      // Then: 사용 가능한 첫 번째 provider(openai)를 반환해야 함
      expect(result).toBe('openai');
    });
  });

  describe('fallback 로직', () => {
    it('Given: preferredProvider가 null이고 openaiClient가 null이지만 geminiClient가 사용 가능한 상태, When: auto provider를 요청함, Then: 사용 가능한 gemini provider를 반환해야 함', async () => {
      // Given: preferredProvider가 null이고 openaiClient가 null이지만 geminiClient가 사용 가능한 상태
      const mockGeminiClient = new GoogleGenerativeAI('test-gemini-key');
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: null,
        openaiClient: null,
        geminiClient: mockGeminiClient,
        initializedProviders: ['gemini'],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      const extractor = new TripleExtractor();
      // 초기화 완료를 보장하기 위해 extract() 호출
      await extractor.extract('test');

      // When: 'auto' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = extractor.determineProvider('auto');

      // Then: 사용 가능한 'gemini' provider를 반환해야 함
      expect(result).toBe('gemini');
    });

    it('Given: preferredProvider가 null이고 모든 클라이언트가 null인 상태, When: auto provider를 요청함, Then: null을 반환해야 함', async () => {
      // Given: preferredProvider가 null이고 모든 클라이언트가 null인 상태
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: null,
        openaiClient: null,
        geminiClient: null,
        initializedProviders: [],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      const extractor = new TripleExtractor();
      // 초기화 완료를 보장하기 위해 initializationPromise 대기
      if (extractor['initializationPromise']) {
        await extractor['initializationPromise'];
      }

      // When: 'auto' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = extractor.determineProvider('auto');

      // Then: null을 반환해야 함
      expect(result).toBeNull();
    });

    it("Given: preferredProvider가 'openai'이지만 openaiClient가 null이고 geminiClient가 사용 가능한 상태, When: openai provider를 요청함, Then: fallback으로 gemini provider를 반환해야 함", async () => {
      // Given: preferredProvider가 'openai'이지만 openaiClient가 null이고 geminiClient가 사용 가능한 상태
      const mockGeminiClient = new GoogleGenerativeAI('test-gemini-key');
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: 'openai',
        openaiClient: null,
        geminiClient: mockGeminiClient,
        initializedProviders: ['gemini'],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      const extractor = new TripleExtractor();
      // 초기화 완료를 보장하기 위해 extract() 호출
      await extractor.extract('test');

      // When: 'openai' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = extractor.determineProvider('openai');

      // Then: fallback으로 'gemini' provider를 반환해야 함
      expect(result).toBe('gemini');
    });

    it("Given: preferredProvider가 'gemini'이지만 geminiClient가 null이고 openaiClient가 사용 가능한 상태, When: gemini provider를 요청함, Then: fallback으로 openai provider를 반환해야 함", async () => {
      // Given: preferredProvider가 'gemini'이지만 geminiClient가 null이고 openaiClient가 사용 가능한 상태
      const mockOpenAIClient = new OpenAI({ apiKey: 'test-openai-key' });
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: 'gemini',
        openaiClient: mockOpenAIClient,
        geminiClient: null,
        initializedProviders: ['openai'],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      const extractor = new TripleExtractor();
      // 초기화 완료를 보장하기 위해 extract() 호출
      await extractor.extract('test');

      // When: 'gemini' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = extractor.determineProvider('gemini');

      // Then: fallback으로 'openai' provider를 반환해야 함
      expect(result).toBe('openai');
    });

    it("Given: preferredProvider가 'ollama'이지만 ollama가 초기화되지 않고 openaiClient가 사용 가능한 상태, When: ollama provider를 요청함, Then: fallback으로 openai provider를 반환해야 함", async () => {
      // Given: preferredProvider가 'ollama'이지만 ollama가 초기화되지 않고 openaiClient가 사용 가능한 상태
      const mockOpenAIClient = new OpenAI({ apiKey: 'test-openai-key' });
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: 'ollama',
        openaiClient: mockOpenAIClient,
        geminiClient: null,
        initializedProviders: ['openai'],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      const extractor = new TripleExtractor();
      // 초기화 완료를 보장하기 위해 extract() 호출
      await extractor.extract('test');

      // When: 'ollama' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = extractor.determineProvider('ollama');

      // Then: fallback으로 'openai' provider를 반환해야 함
      expect(result).toBe('openai');
    });

    it("Given: preferredProvider가 'ollama'이지만 ollama가 초기화되지 않고 openaiClient도 null이지만 geminiClient가 사용 가능한 상태, When: ollama provider를 요청함, Then: fallback으로 gemini provider를 반환해야 함", async () => {
      // Given: preferredProvider가 'ollama'이지만 ollama가 초기화되지 않고 openaiClient도 null이지만 geminiClient가 사용 가능한 상태
      const mockGeminiClient = new GoogleGenerativeAI('test-gemini-key');
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: 'ollama',
        openaiClient: null,
        geminiClient: mockGeminiClient,
        initializedProviders: ['gemini'],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      const extractor = new TripleExtractor();
      // 초기화 완료를 보장하기 위해 extract() 호출
      await extractor.extract('test');

      // When: 'ollama' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = extractor.determineProvider('ollama');

      // Then: fallback으로 'gemini' provider를 반환해야 함
      expect(result).toBe('gemini');
    });

    it("Given: preferredProvider가 'ollama'이지만 ollama가 초기화되지 않고 모든 클라이언트가 null인 상태, When: ollama provider를 요청함, Then: null을 반환해야 함", async () => {
      // Given: preferredProvider가 'ollama'이지만 ollama가 초기화되지 않고 모든 클라이언트가 null인 상태
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: 'ollama',
        openaiClient: null,
        geminiClient: null,
        initializedProviders: [],
        warnings: []
      };
      
      const mockInitializer = {
        initialize: vi.fn().mockResolvedValue(mockInitializeResult)
      };
      
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockImplementation(
        mockInitializer.initialize
      );

      const extractor = new TripleExtractor();
      // 초기화 완료를 보장하기 위해 initializationPromise 대기
      if (extractor['initializationPromise']) {
        await extractor['initializationPromise'];
      }

      // When: 'ollama' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = extractor.determineProvider('ollama');

      // Then: null을 반환해야 함
      expect(result).toBeNull();
    });
  });
});

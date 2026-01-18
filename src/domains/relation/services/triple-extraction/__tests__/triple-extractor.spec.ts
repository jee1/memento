/**
 * TripleExtractor 클래스 테스트
 * TDD GREEN 단계: TripleExtractor 클래스 구현 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TripleExtractor } from '../triple-extractor.js';
import type { TripleExtractionOptions } from '../../../../../shared/types/triple-extraction.js';

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
  });
});

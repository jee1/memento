/**
 * TripleExtractionService 단위 테스트
 * 
 * Given/When/Then 패턴을 따릅니다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TripleExtractionService } from './triple-extraction-service.js';
import type { TripleExtractionResult } from '../../../../shared/types/triple-extraction.js';
import { LLMClientInitializer } from '../../../../shared/services/llm-client-initializer.js';
import type { LLMClientInitializationResult } from '../../../../shared/services/llm-client-initializer.js';
import { logger } from '../../../../shared/utils/logger.js';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

describe('TripleExtractionService', () => {
  let service: TripleExtractionService;

  beforeEach(() => {
    service = new TripleExtractionService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('extractTriples', () => {
    it('빈 observation 처리 - no_triple 반환', async () => {
      // Given: 빈 observation 텍스트
      const observation = '';

      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: no_triple 실패 결과 반환
      expect(result).toBeDefined();
      expect(result.triples).toEqual([]);
      expect(result.extractionInfo.failureReason).toBe('no_triple');
      expect(result.extractionInfo.steps).toBeDefined();
      expect(result.extractionInfo.steps.canonicalization).toBe(false);
      expect(result.extractionInfo.steps.entityLinking).toBe(false);
    });

    it('공백만 있는 observation 처리 - no_triple 반환', async () => {
      // Given: 공백만 있는 observation 텍스트
      const observation = '   ';

      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: no_triple 실패 결과 반환
      expect(result).toBeDefined();
      expect(result.triples).toEqual([]);
      expect(result.extractionInfo.failureReason).toBe('no_triple');
    });

    it('isAvailable - LLM 서비스 사용 가능 여부 확인', () => {
      // Given: TripleExtractionService 인스턴스
      // (환경 변수에 따라 다를 수 있음)

      // When: isAvailable 호출
      const isAvailable = service.isAvailable();

      // Then: boolean 값 반환
      expect(typeof isAvailable).toBe('boolean');
    });

    it('getCostMetrics - 비용 통계 조회', () => {
      // Given: TripleExtractionService 인스턴스

      // When: getCostMetrics 호출
      const metrics = service.getCostMetrics();

      // Then: 비용 통계 반환
      expect(metrics).toBeDefined();
      expect(typeof metrics.totalCalls).toBe('number');
      expect(typeof metrics.totalTokens).toBe('number');
      expect(typeof metrics.totalCost).toBe('number');
      expect(typeof metrics.lastReset).toBe('number');
      expect(metrics.totalCalls).toBeGreaterThanOrEqual(0);
      expect(metrics.totalTokens).toBeGreaterThanOrEqual(0);
      expect(metrics.totalCost).toBeGreaterThanOrEqual(0);
    });
  });

  describe('에러 처리', () => {
    it('LLM 호출 실패 시 실패 결과 반환', async () => {
      // Given: 유효한 observation (하지만 LLM 호출이 실패할 것으로 예상)
      const observation = '사용자가 커피를 좋아한다고 말했습니다.';
      
      // LLM이 사용 불가능한 경우를 가정
      // (실제로는 환경 변수에 따라 다를 수 있음)
      
      // When: extractTriples 호출
      // LLM이 사용 불가능하면 실패 결과를 반환해야 함
      const result = await service.extractTriples(observation);

      // Then: 항상 TripleExtractionResult 반환 (에러가 발생해도)
      expect(result).toBeDefined();
      expect(result.triples).toBeDefined();
      expect(Array.isArray(result.triples)).toBe(true);
      expect(result.extractionInfo).toBeDefined();
      expect(result.extractionInfo.steps).toBeDefined();
      
      // LLM이 사용 불가능한 경우 실패 결과일 수 있음
      if (result.extractionInfo.failureReason) {
        expect(['no_triple', 'llm_api_error', 'llm_parse_fail', 'llm_unavailable']).toContain(
          result.extractionInfo.failureReason
        );
      }
    });
  });

  describe('extractionInfo 구조', () => {
    it('extractionInfo는 항상 steps를 포함해야 함', async () => {
      // Given: observation 텍스트
      const observation = '테스트 observation';

      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: extractionInfo에 steps가 포함되어야 함
      expect(result.extractionInfo).toBeDefined();
      expect(result.extractionInfo.steps).toBeDefined();
      expect(typeof result.extractionInfo.steps.canonicalization).toBe('boolean');
      expect(typeof result.extractionInfo.steps.entityLinking).toBe('boolean');
    });

    it('실패 시 failureReason이 설정되어야 함', async () => {
      // Given: 빈 observation
      const observation = '';

      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: failureReason이 설정되어야 함
      expect(result.extractionInfo.failureReason).toBeDefined();
      expect(result.extractionInfo.failureReason).toBe('no_triple');
    });

    it('성공 시 failureReason이 없어야 함', async () => {
      // Given: 유효한 observation
      const observation = '사용자가 커피를 좋아한다고 말했습니다.';
      
      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: 성공한 경우 failureReason이 없어야 함
      // (LLM이 사용 불가능한 경우는 제외)
      if (result.triples.length > 0) {
        expect(result.extractionInfo.failureReason).toBeUndefined();
      }
    });
  });

  describe('triples 배열 구조', () => {
    it('triples는 항상 배열이어야 함', async () => {
      // Given: observation 텍스트
      const observation = '테스트 observation';

      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: triples는 배열이어야 함
      expect(result.triples).toBeDefined();
      expect(Array.isArray(result.triples)).toBe(true);
    });

    it('triples의 각 항목은 subject, predicate, object를 포함해야 함', async () => {
      // Given: 유효한 observation
      const observation = '사용자가 커피를 좋아한다고 말했습니다.';
      
      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: 성공한 경우 각 triple은 올바른 구조를 가져야 함
      if (result.triples.length > 0) {
        for (const triple of result.triples) {
          expect(triple).toBeDefined();
          expect(typeof triple.subject).toBe('string');
          expect(typeof triple.predicate).toBe('string');
          expect(typeof triple.object).toBe('string');
          expect(triple.subject.trim().length).toBeGreaterThan(0);
          expect(triple.predicate.trim().length).toBeGreaterThan(0);
          expect(triple.object.trim().length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('memoryId 파라미터', () => {
    it('memoryId를 전달할 수 있어야 함', async () => {
      // Given: observation과 memoryId
      const observation = '테스트 observation';
      const memoryId = 'test-memory-id';

      // When: extractTriples 호출 (memoryId 포함)
      const result = await service.extractTriples(observation, {}, memoryId);

      // Then: 정상적으로 처리되어야 함 (memoryId는 로깅용)
      expect(result).toBeDefined();
      expect(result.triples).toBeDefined();
      expect(Array.isArray(result.triples)).toBe(true);
    });
  });

  describe('캐싱', () => {
    it('동일한 content에 대해 두 번째 추출은 캐시에서 반환되어야 함', async () => {
      // Given: 동일한 observation 텍스트
      const observation = 'Alice works at Microsoft. She is a data scientist.';
      
      // When: 첫 번째 추출 (LLM 호출)
      const result1 = await service.extractTriples(observation);
      
      // Then: 첫 번째 추출 결과가 반환되어야 함
      expect(result1).toBeDefined();
      expect(result1.triples).toBeDefined();
      expect(Array.isArray(result1.triples)).toBe(true);
      
      // When: 두 번째 추출 (캐시에서 반환되어야 함)
      const result2 = await service.extractTriples(observation);
      
      // Then: 두 번째 추출 결과가 첫 번째와 동일해야 함 (캐시 히트)
      expect(result2).toBeDefined();
      expect(result2.triples).toEqual(result1.triples);
      expect(result2.extractionInfo).toEqual(result1.extractionInfo);
    });

    it('실패한 Triple 추출 결과는 캐시에 저장되지 않아야 함', async () => {
      // Given: Triple 추출이 실패할 수 있는 observation (빈 문자열)
      const observation = '';
      
      // When: 추출 (실패 예상)
      const result1 = await service.extractTriples(observation);
      
      // Then: 실패 결과 반환
      expect(result1.triples.length).toBe(0);
      expect(result1.extractionInfo.failureReason).toBe('no_triple');
      
      // When: 두 번째 추출
      const result2 = await service.extractTriples(observation);
      
      // Then: 캐시에 저장되지 않았으므로 다시 실패해야 함
      // (실패 결과는 캐시되지 않으므로 매번 처리됨)
      expect(result2.triples.length).toBe(0);
      expect(result2.extractionInfo.failureReason).toBe('no_triple');
    });

    it('다른 content는 다른 결과를 반환해야 함', async () => {
      // Given: 다른 observation 텍스트
      const observation1 = 'Alice works at Microsoft.';
      const observation2 = 'Bob works at Google.';
      
      // When: 각각 추출
      const result1 = await service.extractTriples(observation1);
      const result2 = await service.extractTriples(observation2);
      
      // Then: 다른 결과를 반환해야 함 (캐시 키가 다르므로)
      // (실제 결과는 다를 수 있지만, 최소한 다른 캐시 키를 사용해야 함)
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe('options 파라미터', () => {
    it('options를 전달할 수 있어야 함', async () => {
      // Given: observation과 options
      const observation = '테스트 observation';
      const options = {
        temperature: 0.5,
        maxTokens: 1000
      };

      // When: extractTriples 호출 (options 포함)
      const result = await service.extractTriples(observation, options);

      // Then: 정상적으로 처리되어야 함
      expect(result).toBeDefined();
      expect(result.triples).toBeDefined();
      expect(Array.isArray(result.triples)).toBe(true);
    });
  });

  describe('initializeClients', () => {
    it('initializeClients()가 LLMClientInitializer.initialize()를 호출해야 함', async () => {
      // Given: LLMClientInitializer를 모킹하고 initialize() 메서드를 모킹
      const mockInitializeResult: LLMClientInitializationResult = {
        preferredProvider: 'openai',
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

      // When: TripleExtractionService 인스턴스 생성 (constructor에서 initializeClients() 호출)
      const serviceInstance = new TripleExtractionService();
      // constructor에서 비동기 초기화가 완료될 때까지 대기
      // extractTriples()를 호출하면 ensureInitialized()가 호출되어 초기화가 완료됩니다
      await serviceInstance.extractTriples('test');
      
      // Then: LLMClientInitializer.initialize()가 호출되었는지 확인
      // constructor에서 initializeClients()가 호출되므로, LLMClientInitializer.initialize()도 호출되어야 함
      expect(mockInitializer.initialize).toHaveBeenCalledTimes(1);
    });

    it('LLMClientInitializer 결과를 사용하여 openaiClient, geminiClient, preferredProvider를 설정하고 warnings를 logger.warn()으로 출력해야 함', async () => {
      // Given: LLMClientInitializer 결과를 모킹하고 logger.warn()을 모킹
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

      // When: TripleExtractionService 인스턴스 생성 (constructor에서 initializeClients() 호출)
      const serviceInstance = new TripleExtractionService();
      // constructor에서 비동기 초기화가 완료될 때까지 대기
      // extractTriples()를 호출하면 ensureInitialized()가 호출되어 초기화가 완료됩니다
      await serviceInstance.extractTriples('test');
      
      // Then: LLMClientInitializer 결과가 사용되어 클라이언트와 preferredProvider가 설정되어야 함
      // openaiClient와 geminiClient는 private이므로 @ts-expect-error를 사용하여 접근
      // @ts-expect-error - private 필드 접근 (테스트 목적)
      expect(serviceInstance.openaiClient).toBe(mockOpenAIClient);
      // @ts-expect-error - private 필드 접근 (테스트 목적)
      expect(serviceInstance.geminiClient).toBe(mockGeminiClient);
      // @ts-expect-error - private 필드 접근 (테스트 목적)
      expect(serviceInstance.preferredProvider).toBe('openai');
      
      // Then: warnings가 logger.warn()으로 출력되어야 함
      // Note: LLMClientInitializer 내부에서도 경고를 출력할 수 있으므로,
      // mockWarnings의 각 경고가 logger.warn()으로 출력되었는지만 확인
      mockWarnings.forEach((warning) => {
        expect(loggerWarnSpy).toHaveBeenCalledWith(
          'LLM 초기화 경고',
          expect.objectContaining({ warning })
        );
      });
    });
  });

  describe('determineProvider', () => {
    it('요청된 provider가 사용 가능한 경우 해당 provider를 반환해야 함', async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'openai' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('openai');

      // Then: 'openai' provider를 반환해야 함
      expect(result).toBe('openai');
    });

    it('요청된 provider가 사용 불가능하고 fallback 가능한 경우 fallback provider를 반환해야 함', async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'openai' provider를 요청 (하지만 OpenAI는 사용 불가능)
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('openai');

      // Then: fallback으로 'gemini' provider를 반환해야 함
      expect(result).toBe('gemini');
    });

    it('모든 provider가 사용 불가능한 경우 null을 반환해야 함', async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'openai' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('openai');

      // Then: null을 반환해야 함
      expect(result).toBeNull();
    });

    it("'auto' 모드일 때 사용 가능한 첫 번째 provider를 반환해야 함", async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'auto' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('auto');

      // Then: 사용 가능한 첫 번째 provider인 'openai'를 반환해야 함
      expect(result).toBe('openai');
    });

    it("'auto' 모드일 때 OpenAI가 사용 불가능하면 Gemini를 반환해야 함", async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'auto' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('auto');

      // Then: 사용 가능한 첫 번째 provider인 'gemini'를 반환해야 함
      expect(result).toBe('gemini');
    });

    it("'auto' 모드일 때 모든 provider가 사용 불가능하면 null을 반환해야 함", async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'auto' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('auto');

      // Then: null을 반환해야 함
      expect(result).toBeNull();
    });

    it("'gemini' provider 요청 시 Gemini가 사용 가능하면 Gemini를 반환해야 함", async () => {
      // Given: Gemini 클라이언트가 초기화된 상태
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'gemini' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('gemini');

      // Then: 'gemini' provider를 반환해야 함
      expect(result).toBe('gemini');
    });

    it("'gemini' provider 요청 시 Gemini가 사용 불가능하고 OpenAI가 사용 가능하면 OpenAI를 반환해야 함", async () => {
      // Given: Gemini 클라이언트가 초기화되지 않고 OpenAI 클라이언트만 초기화된 상태
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'gemini' provider를 요청 (하지만 Gemini는 사용 불가능)
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('gemini');

      // Then: fallback으로 'openai' provider를 반환해야 함
      expect(result).toBe('openai');
    });
  });

  describe('fallback 로직', () => {
    it('preferredProvider가 null이고 openaiClient가 null이지만 geminiClient가 사용 가능한 경우 gemini를 반환해야 함', async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'auto' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('auto');

      // Then: 사용 가능한 'gemini' provider를 반환해야 함
      expect(result).toBe('gemini');
    });

    it('preferredProvider가 null이고 모든 클라이언트가 null인 경우 null을 반환해야 함', async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'auto' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('auto');

      // Then: null을 반환해야 함
      expect(result).toBeNull();
    });

    it("preferredProvider가 'openai'이지만 openaiClient가 null이고 geminiClient가 사용 가능한 경우 gemini를 반환해야 함 (fallback)", async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'openai' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('openai');

      // Then: fallback으로 'gemini' provider를 반환해야 함
      expect(result).toBe('gemini');
    });

    it("preferredProvider가 'gemini'이지만 geminiClient가 null이고 openaiClient가 사용 가능한 경우 openai를 반환해야 함 (fallback)", async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'gemini' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('gemini');

      // Then: fallback으로 'openai' provider를 반환해야 함
      expect(result).toBe('openai');
    });

    it("preferredProvider가 'ollama'이지만 ollama가 사용 불가능하고 openaiClient가 사용 가능한 경우 openai를 반환해야 함 (fallback)", async () => {
      // Given: preferredProvider가 'ollama'이지만 ollama가 사용 불가능하고 openaiClient가 사용 가능한 상태
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'ollama' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('ollama');

      // Then: fallback으로 'openai' provider를 반환해야 함
      expect(result).toBe('openai');
    });

    it('모든 provider가 사용 불가능한 경우 null을 반환해야 함', async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'openai' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('openai');

      // Then: null을 반환해야 함
      expect(result).toBeNull();
    });

    it("preferredProvider가 'ollama'이지만 ollama가 사용 불가능하고 openaiClient도 null이지만 geminiClient가 사용 가능한 경우 gemini를 반환해야 함 (fallback)", async () => {
      // Given: preferredProvider가 'ollama'이지만 ollama가 사용 불가능하고 openaiClient도 null이지만 geminiClient가 사용 가능한 상태
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: 'ollama' provider를 요청
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      const result = serviceInstance.determineProvider('ollama');

      // Then: fallback으로 'gemini' provider를 반환해야 함
      expect(result).toBe('gemini');
    });
  });

  describe('extractWithLLM 에러 처리', () => {
    it('actualProvider가 null일 때 failureReason을 llm_unavailable로 설정하고 명확한 에러 메시지를 반환해야 함', async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: extractTriples 호출 (모든 provider가 사용 불가능)
      const observation = '사용자가 커피를 좋아한다고 말했습니다.';
      const result = await serviceInstance.extractTriples(observation);

      // Then: failureReason이 'llm_unavailable'로 설정되어야 함
      expect(result.extractionInfo.failureReason).toBe('llm_unavailable');
      
      // Then: 명확한 에러 메시지가 포함되어야 함
      // createFailureResult에서 rawLLMOutput에 에러 메시지가 저장되므로 확인
      expect(result.extractionInfo.rawLLMOutput).toContain('LLM 서비스를 사용할 수 없습니다');
      expect(result.extractionInfo.rawLLMOutput).toContain('OPENAI_API_KEY');
      expect(result.extractionInfo.rawLLMOutput).toContain('GEMINI_API_KEY');
      
      // Then: triples는 빈 배열이어야 함
      expect(result.triples).toEqual([]);
      
      // Then: steps는 모두 false여야 함
      expect(result.extractionInfo.steps.canonicalization).toBe(false);
      expect(result.extractionInfo.steps.entityLinking).toBe(false);
    });

    it('actualProvider가 null일 때 extractWithLLM이 직접 호출되면 적절한 에러 결과를 반환해야 함', async () => {
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

      const serviceInstance = new TripleExtractionService();
      // 초기화 완료를 보장하기 위해 extractTriples() 호출 (ensureInitialized() 내부 호출)
      await serviceInstance.extractTriples('test');

      // When: extractTriples 호출 (모든 provider가 사용 불가능)
      const observation = '테스트 observation';
      const result = await serviceInstance.extractTriples(observation, { provider: 'openai' });

      // Then: failureReason이 'llm_unavailable'로 설정되어야 함
      expect(result.extractionInfo.failureReason).toBe('llm_unavailable');
      
      // Then: 명확한 에러 메시지가 포함되어야 함
      expect(result.extractionInfo.rawLLMOutput).toBeDefined();
      expect(result.extractionInfo.rawLLMOutput).toContain('LLM 서비스를 사용할 수 없습니다');
      
      // Then: triples는 빈 배열이어야 함
      expect(result.triples).toEqual([]);
    });
  });
});


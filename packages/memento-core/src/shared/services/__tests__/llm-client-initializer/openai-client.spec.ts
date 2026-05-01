/**
 * LLMClientInitializer unit tests — OpenAI client initialization
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
      const loggerModule = await import('../../../utils/logger.js');
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
      const loggerModule = await import('../../../utils/logger.js');
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
});

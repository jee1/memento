/**
 * LLMClientInitializer unit tests — Gemini client initialization
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

  describe('Gemini client initialization', () => {
    /**
     * Given: GEMINI_API_KEY가 설정되어 있음
     * When: initialize() 메서드를 호출함
     * Then: GoogleGenAI 클라이언트가 생성되고 initializedProviders에 'gemini'가 추가되어야 함
     * 
     * Note: 현재 구현에서는 Gemini 초기화 로직이 없으므로 이 테스트는 실패할 것임 (RED 단계)
     */
    it('should initialize Gemini client when API key is available', async () => {
      // Given: GEMINI_API_KEY가 설정되어 있음
      mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
      
      // GoogleGenAI 모킹된 인스턴스 가져오기
      const geminiModule = await import('@google/genai');
      const MockGoogleGenAI = geminiModule.GoogleGenAI;
      vi.mocked(MockGoogleGenAI).mockClear();
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: GoogleGenAI 클라이언트가 생성되어야 함
      // 현재 구현에서는 Gemini 초기화 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(MockGoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-gemini-api-key' });
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
      const loggerModule = await import('../../../utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: geminiClient는 null이고 경고가 추가되어야 함
      // 현재 구현에서는 Gemini 초기화 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result.geminiClient).toBeNull();
      expect(result.warnings.some((w) => w.includes('GEMINI_API_KEY'))).toBe(true);
      expect(loggerWarnSpy).toHaveBeenCalled();
      
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
      
      // GoogleGenAI 모킹 - 에러 발생하도록 설정
      const geminiModule = await import('@google/genai');
      const MockGoogleGenAI = geminiModule.GoogleGenAI;
      vi.mocked(MockGoogleGenAI).mockImplementation(() => {
        throw new Error('Gemini initialization failed');
      });
      
      // Logger 모킹
      const loggerModule = await import('../../../utils/logger.js');
      const loggerWarnSpy = vi.spyOn(loggerModule.logger, 'warn');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: geminiClient는 null이고 경고가 추가되어야 함
      // 현재 구현에서는 Gemini 초기화 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(result.geminiClient).toBeNull();
      expect(result.warnings.some((w) => w.includes('Gemini 클라이언트 초기화 실패'))).toBe(true);
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Gemini 클라이언트 초기화 중 오류가 발생했습니다.',
        expect.objectContaining({ requestedProvider: expect.any(String) })
      );
      
      vi.mocked(MockGoogleGenAI).mockRestore();
      loggerWarnSpy.mockRestore();
    });
  });
});

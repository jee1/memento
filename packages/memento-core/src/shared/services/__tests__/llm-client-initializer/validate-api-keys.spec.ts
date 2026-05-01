/**
 * LLMClientInitializer unit tests — validateApiKeys
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
});

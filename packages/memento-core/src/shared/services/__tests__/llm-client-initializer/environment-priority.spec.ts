/**
 * LLMClientInitializer unit tests — environment variable priority
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
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      
      // getRawEnvValue 함수를 스파이로 모킹하여 호출 여부 확인
      const envModule = await import('../../../config/environment.js');
      const getRawEnvValueSpy = vi.spyOn(envModule, 'getRawEnvValue');
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: getRawEnvValue('LLM_PROVIDER')가 호출되어야 함
      // 현재 구현에서는 provider 선택 로직이 없으므로 이 검증은 실패할 것임 (RED 단계)
      expect(getRawEnvValueSpy).toHaveBeenCalledWith('LLM_PROVIDER');
      expect(result.preferredProvider).toBe('openai');
      
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
      mockMementoConfig.geminiApiKey = 'test-gemini-api-key';
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: mementoConfig.llmProvider 값이 사용되어야 함
      // 현재 구현에서는 provider 선택 로직이 없으므로 이 검증은 실패할 것임
      expect(process.env.LLM_PROVIDER).toBeUndefined();
      expect(result.preferredProvider).toBe('gemini');
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
      mockMementoConfig.openaiApiKey = 'test-openai-api-key';
      
      const initializer = new LLMClientInitializer();

      // When: initialize() 메서드 호출
      const result = await initializer.initialize();

      // Then: 기본값 'auto'가 사용되어야 함
      // 현재 구현에서는 provider 선택 로직이 없으므로 이 검증은 실패할 것임
      expect(process.env.LLM_PROVIDER).toBeUndefined();
      expect(result.preferredProvider).toBe('openai');
    });
  });
});

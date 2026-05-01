/**
 * LLMClientInitializer unit tests — initialize
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
});

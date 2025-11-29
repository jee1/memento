/**
 * Environment Check 테스트
 * 환경 체크 유틸리티 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isTestEnvironment,
  isValidationDisabled,
  isValidConfigurationEnvironment
} from '../environment-check.js';

describe('environment-check', () => {
  let originalNodeEnv: string | undefined;
  let originalVitest: string | undefined;
  let originalDisableConfigValidation: string | undefined;
  let originalSkipConfigValidation: string | undefined;

  beforeEach(() => {
    // 원본 환경 변수 저장
    originalNodeEnv = process.env.NODE_ENV;
    originalVitest = process.env.VITEST;
    originalDisableConfigValidation = process.env.DISABLE_CONFIG_VALIDATION;
    originalSkipConfigValidation = process.env.SKIP_CONFIG_VALIDATION;
  });

  afterEach(() => {
    // 원본 환경 변수 복원
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (originalVitest !== undefined) {
      process.env.VITEST = originalVitest;
    } else {
      delete process.env.VITEST;
    }
    if (originalDisableConfigValidation !== undefined) {
      process.env.DISABLE_CONFIG_VALIDATION = originalDisableConfigValidation;
    } else {
      delete process.env.DISABLE_CONFIG_VALIDATION;
    }
    if (originalSkipConfigValidation !== undefined) {
      process.env.SKIP_CONFIG_VALIDATION = originalSkipConfigValidation;
    } else {
      delete process.env.SKIP_CONFIG_VALIDATION;
    }
  });

  describe('isTestEnvironment', () => {
    it('NODE_ENV가 test일 때 true를 반환해야 함', () => {
      // Given: NODE_ENV를 test로 설정
      process.env.NODE_ENV = 'test';
      delete process.env.VITEST;

      // When: 테스트 환경 확인
      const result = isTestEnvironment();

      // Then: true 반환
      expect(result).toBe(true);
    });

    it('VITEST가 true일 때 true를 반환해야 함', () => {
      // Given: VITEST를 true로 설정
      delete process.env.NODE_ENV;
      process.env.VITEST = 'true';

      // When: 테스트 환경 확인
      const result = isTestEnvironment();

      // Then: true 반환
      expect(result).toBe(true);
    });

    it('NODE_ENV가 test이고 VITEST가 true일 때 true를 반환해야 함', () => {
      // Given: 둘 다 설정
      process.env.NODE_ENV = 'test';
      process.env.VITEST = 'true';

      // When: 테스트 환경 확인
      const result = isTestEnvironment();

      // Then: true 반환
      expect(result).toBe(true);
    });

    it('테스트 환경이 아닐 때 false를 반환해야 함', () => {
      // Given: 테스트 환경 변수 제거
      delete process.env.NODE_ENV;
      delete process.env.VITEST;

      // When: 테스트 환경 확인
      const result = isTestEnvironment();

      // Then: false 반환
      expect(result).toBe(false);
    });

    it('NODE_ENV가 production일 때 false를 반환해야 함', () => {
      // Given: NODE_ENV를 production으로 설정
      process.env.NODE_ENV = 'production';
      delete process.env.VITEST;

      // When: 테스트 환경 확인
      const result = isTestEnvironment();

      // Then: false 반환
      expect(result).toBe(false);
    });
  });

  describe('isValidationDisabled', () => {
    it('DISABLE_CONFIG_VALIDATION이 true일 때 true를 반환해야 함', () => {
      // Given: DISABLE_CONFIG_VALIDATION을 true로 설정
      process.env.DISABLE_CONFIG_VALIDATION = 'true';
      delete process.env.SKIP_CONFIG_VALIDATION;

      // When: 검증 비활성화 확인
      const result = isValidationDisabled();

      // Then: true 반환
      expect(result).toBe(true);
    });

    it('DISABLE_CONFIG_VALIDATION이 1일 때 true를 반환해야 함', () => {
      // Given: DISABLE_CONFIG_VALIDATION을 1로 설정
      process.env.DISABLE_CONFIG_VALIDATION = '1';
      delete process.env.SKIP_CONFIG_VALIDATION;

      // When: 검증 비활성화 확인
      const result = isValidationDisabled();

      // Then: true 반환
      expect(result).toBe(true);
    });

    it('DISABLE_CONFIG_VALIDATION이 yes일 때 true를 반환해야 함', () => {
      // Given: DISABLE_CONFIG_VALIDATION을 yes로 설정
      process.env.DISABLE_CONFIG_VALIDATION = 'yes';
      delete process.env.SKIP_CONFIG_VALIDATION;

      // When: 검증 비활성화 확인
      const result = isValidationDisabled();

      // Then: true 반환
      expect(result).toBe(true);
    });

    it('DISABLE_CONFIG_VALIDATION이 on일 때 true를 반환해야 함', () => {
      // Given: DISABLE_CONFIG_VALIDATION을 on으로 설정
      process.env.DISABLE_CONFIG_VALIDATION = 'on';
      delete process.env.SKIP_CONFIG_VALIDATION;

      // When: 검증 비활성화 확인
      const result = isValidationDisabled();

      // Then: true 반환
      expect(result).toBe(true);
    });

    it('SKIP_CONFIG_VALIDATION이 true일 때 true를 반환해야 함', () => {
      // Given: SKIP_CONFIG_VALIDATION을 true로 설정
      delete process.env.DISABLE_CONFIG_VALIDATION;
      process.env.SKIP_CONFIG_VALIDATION = 'true';

      // When: 검증 비활성화 확인
      const result = isValidationDisabled();

      // Then: true 반환
      expect(result).toBe(true);
    });

    it('DISABLE_CONFIG_VALIDATION이 우선순위를 가져야 함', () => {
      // Given: 둘 다 설정 (DISABLE_CONFIG_VALIDATION 우선)
      process.env.DISABLE_CONFIG_VALIDATION = 'true';
      process.env.SKIP_CONFIG_VALIDATION = 'false';

      // When: 검증 비활성화 확인
      const result = isValidationDisabled();

      // Then: true 반환 (DISABLE_CONFIG_VALIDATION 우선)
      expect(result).toBe(true);
    });

    it('대소문자를 구분하지 않아야 함', () => {
      // Given: 대문자로 설정
      process.env.DISABLE_CONFIG_VALIDATION = 'TRUE';
      delete process.env.SKIP_CONFIG_VALIDATION;

      // When: 검증 비활성화 확인
      const result = isValidationDisabled();

      // Then: true 반환
      expect(result).toBe(true);
    });

    it('검증이 비활성화되지 않았을 때 false를 반환해야 함', () => {
      // Given: 검증 비활성화 플래그 제거
      delete process.env.DISABLE_CONFIG_VALIDATION;
      delete process.env.SKIP_CONFIG_VALIDATION;

      // When: 검증 비활성화 확인
      const result = isValidationDisabled();

      // Then: false 반환
      expect(result).toBe(false);
    });

    it('유효하지 않은 값일 때 false를 반환해야 함', () => {
      // Given: 유효하지 않은 값 설정
      process.env.DISABLE_CONFIG_VALIDATION = 'invalid';
      delete process.env.SKIP_CONFIG_VALIDATION;

      // When: 검증 비활성화 확인
      const result = isValidationDisabled();

      // Then: false 반환
      expect(result).toBe(false);
    });
  });

  describe('isValidConfigurationEnvironment', () => {
    it('테스트 환경일 때 false를 반환해야 함', () => {
      // Given: 테스트 환경 설정
      process.env.NODE_ENV = 'test';
      delete process.env.VITEST;
      delete process.env.DISABLE_CONFIG_VALIDATION;
      delete process.env.SKIP_CONFIG_VALIDATION;

      // When: 유효한 설정 환경 확인
      const result = isValidConfigurationEnvironment();

      // Then: false 반환
      expect(result).toBe(false);
    });

    it('검증이 비활성화되었을 때 false를 반환해야 함', () => {
      // Given: 검증 비활성화 설정
      delete process.env.NODE_ENV;
      delete process.env.VITEST;
      process.env.DISABLE_CONFIG_VALIDATION = 'true';
      delete process.env.SKIP_CONFIG_VALIDATION;

      // When: 유효한 설정 환경 확인
      const result = isValidConfigurationEnvironment();

      // Then: false 반환
      expect(result).toBe(false);
    });

    it('테스트 환경이 아니고 검증이 활성화되었을 때 true를 반환해야 함', () => {
      // Given: 정상 환경 설정
      process.env.NODE_ENV = 'production';
      delete process.env.VITEST;
      delete process.env.DISABLE_CONFIG_VALIDATION;
      delete process.env.SKIP_CONFIG_VALIDATION;

      // When: 유효한 설정 환경 확인
      const result = isValidConfigurationEnvironment();

      // Then: true 반환
      expect(result).toBe(true);
    });

    it('테스트 환경이고 검증이 비활성화되었을 때 false를 반환해야 함', () => {
      // Given: 테스트 환경 + 검증 비활성화
      process.env.NODE_ENV = 'test';
      delete process.env.VITEST;
      process.env.DISABLE_CONFIG_VALIDATION = 'true';
      delete process.env.SKIP_CONFIG_VALIDATION;

      // When: 유효한 설정 환경 확인
      const result = isValidConfigurationEnvironment();

      // Then: false 반환
      expect(result).toBe(false);
    });

    it('환경 변수가 없을 때 true를 반환해야 함', () => {
      // Given: 모든 환경 변수 제거
      delete process.env.NODE_ENV;
      delete process.env.VITEST;
      delete process.env.DISABLE_CONFIG_VALIDATION;
      delete process.env.SKIP_CONFIG_VALIDATION;

      // When: 유효한 설정 환경 확인
      const result = isValidConfigurationEnvironment();

      // Then: true 반환
      expect(result).toBe(true);
    });
  });
});


/**
 * 설정 값 검증 로직 테스트
 * 
 * 3.8.1: 설정 값 검증 로직 테스트 작성
 */

import { describe, it, expect } from 'vitest';
import { validateConfig, ConfigValidationSchema } from '../config-loader-utils.js';

describe('3.8.1 설정 값 검증 로직', () => {
  describe('유효한 범위 검증', () => {
    it('숫자 값이 최소값 이상인지 검증', () => {
      // Given: 최소값이 0인 스키마
      const schema: ConfigValidationSchema = {
        value: { type: 'number', min: 0, max: 100 }
      };

      // When: 유효한 값 검증
      const result1 = validateConfig({ value: 50 }, schema);
      
      // Then: 검증 통과
      expect(result1.valid).toBe(true);
      expect(result1.errors).toHaveLength(0);
    });

    it('숫자 값이 최대값 이하인지 검증', () => {
      // Given: 최대값이 100인 스키마
      const schema: ConfigValidationSchema = {
        value: { type: 'number', min: 0, max: 100 }
      };

      // When: 유효한 값 검증
      const result = validateConfig({ value: 50 }, schema);
      
      // Then: 검증 통과
      expect(result.valid).toBe(true);
    });

    it('범위를 벗어난 값 검증 실패', () => {
      // Given: 범위가 0-100인 스키마
      const schema: ConfigValidationSchema = {
        value: { type: 'number', min: 0, max: 100 }
      };

      // When: 범위를 벗어난 값 검증
      const result1 = validateConfig({ value: 150 }, schema);
      const result2 = validateConfig({ value: -10 }, schema);

      // Then: 검증 실패
      expect(result1.valid).toBe(false);
      expect(result1.errors.length).toBeGreaterThan(0);
      expect(result2.valid).toBe(false);
      expect(result2.errors.length).toBeGreaterThan(0);
    });
  });

  describe('문자열 길이 검증', () => {
    it('문자열이 최소 길이 이상인지 검증', () => {
      // Given: 최소 길이가 1인 스키마
      const schema: ConfigValidationSchema = {
        value: { type: 'string', minLength: 1, maxLength: 100 }
      };

      // When: 유효한 값 검증
      const result = validateConfig({ value: 'test' }, schema);
      
      // Then: 검증 통과
      expect(result.valid).toBe(true);
    });

    it('문자열이 최대 길이 이하인지 검증', () => {
      // Given: 최대 길이가 10인 스키마
      const schema: ConfigValidationSchema = {
        value: { type: 'string', maxLength: 10 }
      };

      // When: 유효한 값 검증
      const result = validateConfig({ value: 'test' }, schema);
      
      // Then: 검증 통과
      expect(result.valid).toBe(true);
    });

    it('길이를 벗어난 문자열 검증 실패', () => {
      // Given: 최대 길이가 10인 스키마
      const schema: ConfigValidationSchema = {
        value: { type: 'string', maxLength: 10 }
      };

      // When: 길이를 벗어난 값 검증
      const result = validateConfig({ value: 'this is a very long string' }, schema);

      // Then: 검증 실패
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('필수 필드 검증', () => {
    it('필수 필드가 없을 때 검증 실패', () => {
      // Given: 필수 필드가 있는 스키마
      const schema: ConfigValidationSchema = {
        required: { type: 'string', required: true },
        optional: { type: 'string' }
      };

      // When: 필수 필드가 없는 설정 검증
      const result = validateConfig({ optional: 'value' }, schema);

      // Then: 검증 실패
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('required'))).toBe(true);
    });

    it('필수 필드가 있을 때 검증 통과', () => {
      // Given: 필수 필드가 있는 스키마
      const schema: ConfigValidationSchema = {
        required: { type: 'string', required: true }
      };

      // When: 필수 필드가 있는 설정 검증
      const result = validateConfig({ required: 'value' }, schema);

      // Then: 검증 통과
      expect(result.valid).toBe(true);
    });
  });

  describe('에러 메시지 명확성', () => {
    it('에러 메시지에 필드 이름과 값 포함', () => {
      // Given: 범위가 0-100인 스키마
      const schema: ConfigValidationSchema = {
        value: { type: 'number', min: 0, max: 100 }
      };

      // When: 범위를 벗어난 값 검증
      const result = validateConfig({ value: 150 }, schema);

      // Then: 에러 메시지에 필드 이름과 값 포함
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('value');
      expect(result.errors[0]).toContain('150');
    });

    it('에러 메시지에 예상 범위 포함', () => {
      // Given: 범위가 0-100인 스키마
      const schema: ConfigValidationSchema = {
        value: { type: 'number', min: 0, max: 100 }
      };

      // When: 범위를 벗어난 값 검증
      const result = validateConfig({ value: 150 }, schema);

      // Then: 에러 메시지에 예상 범위 포함
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('100');
    });
  });
});


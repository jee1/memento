/**
 * PII 마스킹 환경 변수 제어 테스트
 * 
 * PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
 * 환경 변수 ENABLE_PII_MASKING으로 마스킹 활성화/비활성화 제어
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PIIMasker } from '../pii-masker.js';

describe('PII 마스킹 환경 변수 제어', () => {
  const originalEnv = process.env.ENABLE_PII_MASKING;

  beforeEach(() => {
    // 각 테스트 전에 환경 변수 초기화
    delete process.env.ENABLE_PII_MASKING;
  });

  afterEach(() => {
    // 각 테스트 후에 환경 변수 복원
    if (originalEnv !== undefined) {
      process.env.ENABLE_PII_MASKING = originalEnv;
    } else {
      delete process.env.ENABLE_PII_MASKING;
    }
  });

  describe('기본값 (환경 변수 미지정)', () => {
    it('환경 변수가 없을 때 기본값은 true여야 함 (보안 우선)', () => {
      // Given: 환경 변수가 지정되지 않았을 때
      delete process.env.ENABLE_PII_MASKING;
      
      // When: PII 마스킹을 수행하면
      const email = 'test@example.com';
      const result = PIIMasker.mask(`이메일: ${email}`);
      
      // Then: PII가 마스킹되어야 함 (기본값: true)
      expect(result.masked).not.toContain(email);
      expect(result.masked).toContain('[EMAIL]');
      expect(result.maskedCount).toBeGreaterThan(0);
    });
  });

  describe('ENABLE_PII_MASKING=true', () => {
    it('환경 변수가 true일 때 PII가 마스킹되어야 함', () => {
      // Given: 환경 변수가 true로 설정되었을 때
      process.env.ENABLE_PII_MASKING = 'true';
      
      // When: PII 마스킹을 수행하면
      const email = 'test@example.com';
      const phone = '010-1234-5678';
      const result = PIIMasker.mask(`이메일: ${email}, 전화번호: ${phone}`);
      
      // Then: PII가 마스킹되어야 함
      expect(result.masked).not.toContain(email);
      expect(result.masked).not.toContain(phone);
      expect(result.masked).toContain('[EMAIL]');
      expect(result.masked).toContain('[PHONE]');
      expect(result.maskedCount).toBeGreaterThan(0);
    });

    it('환경 변수가 1일 때 PII가 마스킹되어야 함', () => {
      // Given: 환경 변수가 '1'로 설정되었을 때
      process.env.ENABLE_PII_MASKING = '1';
      
      // When: PII 마스킹을 수행하면
      const email = 'test@example.com';
      const result = PIIMasker.mask(`이메일: ${email}`);
      
      // Then: PII가 마스킹되어야 함
      expect(result.masked).not.toContain(email);
      expect(result.masked).toContain('[EMAIL]');
    });

    it('환경 변수가 yes일 때 PII가 마스킹되어야 함', () => {
      // Given: 환경 변수가 'yes'로 설정되었을 때
      process.env.ENABLE_PII_MASKING = 'yes';
      
      // When: PII 마스킹을 수행하면
      const email = 'test@example.com';
      const result = PIIMasker.mask(`이메일: ${email}`);
      
      // Then: PII가 마스킹되어야 함
      expect(result.masked).not.toContain(email);
      expect(result.masked).toContain('[EMAIL]');
    });
  });

  describe('ENABLE_PII_MASKING=false', () => {
    it('환경 변수가 false일 때 PII가 마스킹되지 않아야 함', () => {
      // Given: 환경 변수가 false로 설정되었을 때
      process.env.ENABLE_PII_MASKING = 'false';
      
      // When: PII 마스킹을 수행하면
      const email = 'test@example.com';
      const phone = '010-1234-5678';
      const text = `이메일: ${email}, 전화번호: ${phone}`;
      const result = PIIMasker.mask(text);
      
      // Then: PII가 마스킹되지 않아야 함 (원본 그대로)
      expect(result.masked).toBe(text);
      expect(result.masked).toContain(email);
      expect(result.masked).toContain(phone);
      expect(result.maskedCount).toBe(0);
      expect(result.maskedTypes).toEqual([]);
    });

    it('환경 변수가 0일 때 PII가 마스킹되지 않아야 함', () => {
      // Given: 환경 변수가 '0'으로 설정되었을 때
      process.env.ENABLE_PII_MASKING = '0';
      
      // When: PII 마스킹을 수행하면
      const email = 'test@example.com';
      const text = `이메일: ${email}`;
      const result = PIIMasker.mask(text);
      
      // Then: PII가 마스킹되지 않아야 함
      expect(result.masked).toBe(text);
      expect(result.masked).toContain(email);
      expect(result.maskedCount).toBe(0);
    });

    it('환경 변수가 no일 때 PII가 마스킹되지 않아야 함', () => {
      // Given: 환경 변수가 'no'로 설정되었을 때
      process.env.ENABLE_PII_MASKING = 'no';
      
      // When: PII 마스킹을 수행하면
      const email = 'test@example.com';
      const text = `이메일: ${email}`;
      const result = PIIMasker.mask(text);
      
      // Then: PII가 마스킹되지 않아야 함
      expect(result.masked).toBe(text);
      expect(result.masked).toContain(email);
      expect(result.maskedCount).toBe(0);
    });
  });

  describe('maskObject 환경 변수 제어', () => {
    it('환경 변수가 false일 때 객체의 PII가 마스킹되지 않아야 함', () => {
      // Given: 환경 변수가 false로 설정되었을 때
      process.env.ENABLE_PII_MASKING = 'false';
      
      // When: 객체의 PII 마스킹을 수행하면
      const obj = {
        email: 'test@example.com',
        phone: '010-1234-5678',
        name: 'John Doe'
      };
      const result = PIIMasker.maskObject(obj);
      
      // Then: 객체의 PII가 마스킹되지 않아야 함 (원본 그대로)
      expect(result).toEqual(obj);
      expect(result.email).toBe('test@example.com');
      expect(result.phone).toBe('010-1234-5678');
    });

    it('환경 변수가 true일 때 객체의 PII가 마스킹되어야 함', () => {
      // Given: 환경 변수가 true로 설정되었을 때
      process.env.ENABLE_PII_MASKING = 'true';
      
      // When: 객체의 PII 마스킹을 수행하면
      const obj = {
        email: 'test@example.com',
        phone: '010-1234-5678',
        name: 'John Doe'
      };
      const result = PIIMasker.maskObject(obj);
      
      // Then: 객체의 PII가 마스킹되어야 함
      const resultJson = JSON.stringify(result);
      expect(resultJson).not.toContain('test@example.com');
      expect(resultJson).not.toContain('010-1234-5678');
      expect(resultJson).toContain('[EMAIL]');
      expect(resultJson).toContain('[PHONE]');
    });
  });

  describe('maskError 환경 변수 제어', () => {
    it('환경 변수가 false일 때 Error 객체의 PII가 마스킹되지 않아야 함', () => {
      // Given: 환경 변수가 false로 설정되었을 때
      process.env.ENABLE_PII_MASKING = 'false';
      
      // When: Error 객체의 PII 마스킹을 수행하면
      const email = 'error@example.com';
      const error = new Error(`에러 발생: 사용자 ${email}`);
      error.stack = `Error: 에러 발생\n    at processEmail(${email}):10:20`;
      const result = PIIMasker.maskError(error);
      
      // Then: Error 객체의 PII가 마스킹되지 않아야 함 (원본 그대로)
      expect(result.message).toBe(error.message);
      expect(result.message).toContain(email);
      expect(result.stack).toBe(error.stack);
      expect(result.stack).toContain(email);
    });

    it('환경 변수가 true일 때 Error 객체의 PII가 마스킹되어야 함', () => {
      // Given: 환경 변수가 true로 설정되었을 때
      process.env.ENABLE_PII_MASKING = 'true';
      
      // When: Error 객체의 PII 마스킹을 수행하면
      const email = 'error@example.com';
      const error = new Error(`에러 발생: 사용자 ${email}`);
      error.stack = `Error: 에러 발생\n    at processEmail(${email}):10:20`;
      const result = PIIMasker.maskError(error);
      
      // Then: Error 객체의 PII가 마스킹되어야 함
      expect(result.message).not.toContain(email);
      expect(result.message).toContain('[EMAIL]');
      if (result.stack) {
        expect(result.stack).not.toContain(email);
        expect(result.stack).toContain('[EMAIL]');
      }
    });
  });

  describe('대소문자 무시', () => {
    it('환경 변수가 TRUE일 때 PII가 마스킹되어야 함', () => {
      // Given: 환경 변수가 'TRUE'로 설정되었을 때
      process.env.ENABLE_PII_MASKING = 'TRUE';
      
      // When: PII 마스킹을 수행하면
      const email = 'test@example.com';
      const result = PIIMasker.mask(`이메일: ${email}`);
      
      // Then: PII가 마스킹되어야 함
      expect(result.masked).not.toContain(email);
      expect(result.masked).toContain('[EMAIL]');
    });

    it('환경 변수가 False일 때 PII가 마스킹되지 않아야 함', () => {
      // Given: 환경 변수가 'False'로 설정되었을 때
      process.env.ENABLE_PII_MASKING = 'False';
      
      // When: PII 마스킹을 수행하면
      const email = 'test@example.com';
      const text = `이메일: ${email}`;
      const result = PIIMasker.mask(text);
      
      // Then: PII가 마스킹되지 않아야 함
      expect(result.masked).toBe(text);
      expect(result.masked).toContain(email);
    });
  });

  describe('공백 처리', () => {
    it('환경 변수가 " true "일 때 PII가 마스킹되어야 함 (공백 제거)', () => {
      // Given: 환경 변수가 ' true '로 설정되었을 때 (앞뒤 공백)
      process.env.ENABLE_PII_MASKING = ' true ';
      
      // When: PII 마스킹을 수행하면
      const email = 'test@example.com';
      const result = PIIMasker.mask(`이메일: ${email}`);
      
      // Then: PII가 마스킹되어야 함 (공백 제거 후 true로 인식)
      expect(result.masked).not.toContain(email);
      expect(result.masked).toContain('[EMAIL]');
    });

    it('환경 변수가 " false "일 때 PII가 마스킹되지 않아야 함 (공백 제거)', () => {
      // Given: 환경 변수가 ' false '로 설정되었을 때 (앞뒤 공백)
      process.env.ENABLE_PII_MASKING = ' false ';
      
      // When: PII 마스킹을 수행하면
      const email = 'test@example.com';
      const text = `이메일: ${email}`;
      const result = PIIMasker.mask(text);
      
      // Then: PII가 마스킹되지 않아야 함 (공백 제거 후 false로 인식)
      expect(result.masked).toBe(text);
      expect(result.masked).toContain(email);
    });
  });
});


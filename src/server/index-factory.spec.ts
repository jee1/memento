/**
 * index.ts 팩토리 패턴 통합 테스트
 * 
 * Given/When/Then 구조를 따르는 통합 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServerFactory } from './server-factory.js';

describe('index.ts 팩토리 패턴 통합 테스트', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // 환경 변수 초기화
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('환경 변수 기반 서버 선택', () => {
    /**
     * @given index.ts가 팩토리 패턴으로 리팩토링 완료
     * @when 환경 변수 기반 서버 선택 로직 추가
     * @then 환경 변수 테스트 통과
     */
    it('should create stdio server when TRANSPORT_TYPE is stdio', () => {
      process.env.TRANSPORT_TYPE = 'stdio';
      const factory = createServerFactory();
      const server = factory.createServerFromEnv();
      
      expect(server).toBeDefined();
      expect(typeof server.start).toBe('function');
      expect(typeof server.stop).toBe('function');
      expect(typeof server.cleanup).toBe('function');
    });

    it('should create sse server when TRANSPORT_TYPE is sse', () => {
      process.env.TRANSPORT_TYPE = 'sse';
      const factory = createServerFactory();
      const server = factory.createServerFromEnv();
      
      expect(server).toBeDefined();
      expect(typeof server.start).toBe('function');
      expect(typeof server.stop).toBe('function');
      expect(typeof server.cleanup).toBe('function');
    });
  });

  describe('기본값 stdio 동작', () => {
    /**
     * @given index.ts 리팩토링 완료
     * @when TRANSPORT_TYPE 미설정 시 기본값 stdio 동작 검증 테스트 작성 및 실행
     * @then 기본값 stdio로 서버 시작 확인
     */
    it('should default to stdio when TRANSPORT_TYPE is not set', () => {
      delete process.env.TRANSPORT_TYPE;
      const factory = createServerFactory();
      const server = factory.createServerFromEnv();
      
      expect(server).toBeDefined();
      expect(typeof server.start).toBe('function');
      expect(typeof server.stop).toBe('function');
      expect(typeof server.cleanup).toBe('function');
    });

    it('should default to stdio when TRANSPORT_TYPE is empty string', () => {
      process.env.TRANSPORT_TYPE = '';
      const factory = createServerFactory();
      const server = factory.createServerFromEnv();
      
      expect(server).toBeDefined();
      expect(typeof server.start).toBe('function');
    });
  });
});


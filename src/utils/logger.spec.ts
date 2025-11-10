/**
 * Logger 테스트
 * 로깅 유틸리티 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger, type LogLevel } from './logger.js';

describe('logger', () => {
  let originalConsoleDebug: typeof console.debug;
  let originalConsoleInfo: typeof console.info;
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    // 원본 console 메서드 저장
    originalConsoleDebug = console.debug;
    originalConsoleInfo = console.info;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;

    // console 메서드 모킹
    console.debug = vi.fn();
    console.info = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    // 원본 console 메서드 복원
    console.debug = originalConsoleDebug;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    vi.clearAllMocks();
  });

  describe('debug', () => {
    it('debug 메시지를 출력해야 함', () => {
      // Given: debug 메시지
      const message = 'Debug message';

      // When: debug 로그 출력
      logger.debug(message);

      // Then: console.debug가 호출되어야 함
      expect(console.debug).toHaveBeenCalledTimes(1);
      expect(console.debug).toHaveBeenCalledWith(
        expect.stringContaining('DEBUG')
      );
      expect(console.debug).toHaveBeenCalledWith(
        expect.stringContaining(message)
      );
    });

    it('메타데이터와 함께 debug 메시지를 출력해야 함', () => {
      // Given: debug 메시지와 메타데이터
      const message = 'Debug message';
      const meta = { key: 'value', count: 42 };

      // When: debug 로그 출력
      logger.debug(message, meta);

      // Then: console.debug가 메타데이터와 함께 호출되어야 함
      expect(console.debug).toHaveBeenCalledTimes(1);
      const callArg = (console.debug as any).mock.calls[0][0];
      expect(callArg).toContain('DEBUG');
      expect(callArg).toContain(message);
      expect(callArg).toContain('key');
      expect(callArg).toContain('value');
    });
  });

  describe('info', () => {
    it('info 메시지를 출력해야 함', () => {
      // Given: info 메시지
      const message = 'Info message';

      // When: info 로그 출력
      logger.info(message);

      // Then: console.info가 호출되어야 함
      expect(console.info).toHaveBeenCalledTimes(1);
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('INFO')
      );
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining(message)
      );
    });

    it('메타데이터와 함께 info 메시지를 출력해야 함', () => {
      // Given: info 메시지와 메타데이터
      const message = 'Info message';
      const meta = { userId: 'user123', action: 'login' };

      // When: info 로그 출력
      logger.info(message, meta);

      // Then: console.info가 메타데이터와 함께 호출되어야 함
      expect(console.info).toHaveBeenCalledTimes(1);
      const callArg = (console.info as any).mock.calls[0][0];
      expect(callArg).toContain('INFO');
      expect(callArg).toContain(message);
      expect(callArg).toContain('userId');
      expect(callArg).toContain('user123');
    });
  });

  describe('warn', () => {
    it('warn 메시지를 출력해야 함', () => {
      // Given: warn 메시지
      const message = 'Warning message';

      // When: warn 로그 출력
      logger.warn(message);

      // Then: console.warn이 호출되어야 함
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('WARN')
      );
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining(message)
      );
    });

    it('메타데이터와 함께 warn 메시지를 출력해야 함', () => {
      // Given: warn 메시지와 메타데이터
      const message = 'Warning message';
      const meta = { error: 'Something went wrong', code: 500 };

      // When: warn 로그 출력
      logger.warn(message, meta);

      // Then: console.warn이 메타데이터와 함께 호출되어야 함
      expect(console.warn).toHaveBeenCalledTimes(1);
      const callArg = (console.warn as any).mock.calls[0][0];
      expect(callArg).toContain('WARN');
      expect(callArg).toContain(message);
      expect(callArg).toContain('error');
      expect(callArg).toContain('Something went wrong');
    });
  });

  describe('error', () => {
    it('error 메시지를 출력해야 함', () => {
      // Given: error 메시지
      const message = 'Error message';

      // When: error 로그 출력
      logger.error(message);

      // Then: console.error가 호출되어야 함
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('ERROR')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(message)
      );
    });

    it('메타데이터와 함께 error 메시지를 출력해야 함', () => {
      // Given: error 메시지와 메타데이터
      const message = 'Error message';
      const meta = { error: 'Database connection failed', stack: 'stack trace' };

      // When: error 로그 출력
      logger.error(message, meta);

      // Then: console.error가 메타데이터와 함께 호출되어야 함
      expect(console.error).toHaveBeenCalledTimes(1);
      const callArg = (console.error as any).mock.calls[0][0];
      expect(callArg).toContain('ERROR');
      expect(callArg).toContain(message);
      expect(callArg).toContain('error');
      expect(callArg).toContain('Database connection failed');
    });
  });

  describe('로그 메시지 형식', () => {
    it('ISO 형식의 타임스탬프를 포함해야 함', () => {
      // Given: 로그 메시지
      const message = 'Test message';

      // When: info 로그 출력
      logger.info(message);

      // Then: ISO 형식의 타임스탬프가 포함되어야 함
      const callArg = (console.info as any).mock.calls[0][0];
      // ISO 형식: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(callArg).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('로그 레벨을 대문자로 포함해야 함', () => {
      // Given: 각 레벨의 로그 메시지
      const message = 'Test message';

      // When: 각 레벨로 로그 출력
      logger.debug(message);
      logger.info(message);
      logger.warn(message);
      logger.error(message);

      // Then: 각 로그 레벨이 대문자로 포함되어야 함
      const debugCall = (console.debug as any).mock.calls[0][0];
      const infoCall = (console.info as any).mock.calls[0][0];
      const warnCall = (console.warn as any).mock.calls[0][0];
      const errorCall = (console.error as any).mock.calls[0][0];

      expect(debugCall).toContain('DEBUG');
      expect(infoCall).toContain('INFO');
      expect(warnCall).toContain('WARN');
      expect(errorCall).toContain('ERROR');
    });

    it('메시지와 메타데이터를 파이프(|)로 구분해야 함', () => {
      // Given: 메시지와 메타데이터
      const message = 'Test message';
      const meta = { key: 'value' };

      // When: 로그 출력
      logger.info(message, meta);

      // Then: 파이프로 구분되어야 함
      const callArg = (console.info as any).mock.calls[0][0];
      const parts = callArg.split(' | ');
      expect(parts.length).toBeGreaterThanOrEqual(3); // timestamp | LEVEL | message | meta
    });

    it('빈 메타데이터는 포함하지 않아야 함', () => {
      // Given: 메시지와 빈 메타데이터
      const message = 'Test message';
      const meta = {};

      // When: 로그 출력
      logger.info(message, meta);

      // Then: 메타데이터 부분이 없어야 함
      const callArg = (console.info as any).mock.calls[0][0];
      const parts = callArg.split(' | ');
      expect(parts.length).toBe(3); // timestamp | LEVEL | message (메타데이터 없음)
    });
  });

  describe('안전한 직렬화', () => {
    it('직렬화 불가능한 객체를 안전하게 처리해야 함', () => {
      // Given: 순환 참조가 있는 객체
      const message = 'Test message';
      const circular: any = { key: 'value' };
      circular.self = circular; // 순환 참조 생성

      // When: 로그 출력
      logger.info(message, circular);

      // Then: 에러 없이 처리되어야 함
      expect(console.info).toHaveBeenCalledTimes(1);
      const callArg = (console.info as any).mock.calls[0][0];
      expect(callArg).toContain(message);
      // 순환 참조는 [unserializable: ...] 형식으로 처리되어야 함
      expect(callArg).toMatch(/unserializable|key|value/);
    });

    it('문자열은 그대로 출력해야 함', () => {
      // Given: 문자열 메타데이터
      const message = 'Test message';
      const meta = { text: 'simple string' };

      // When: 로그 출력
      logger.info(message, meta);

      // Then: 문자열이 그대로 포함되어야 함
      const callArg = (console.info as any).mock.calls[0][0];
      expect(callArg).toContain('simple string');
    });

    it('복잡한 객체를 JSON으로 직렬화해야 함', () => {
      // Given: 복잡한 객체
      const message = 'Test message';
      const meta = {
        nested: {
          array: [1, 2, 3],
          object: { key: 'value' }
        },
        number: 42,
        boolean: true
      };

      // When: 로그 출력
      logger.info(message, meta);

      // Then: JSON으로 직렬화되어야 함
      const callArg = (console.info as any).mock.calls[0][0];
      expect(callArg).toContain('nested');
      expect(callArg).toContain('array');
      expect(callArg).toContain('42');
    });
  });
});


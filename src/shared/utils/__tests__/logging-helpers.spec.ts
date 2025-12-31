/**
 * 로깅 헬퍼 함수 테스트
 * 
 * 공통 필드(agentId, slot, memoryId, traceId)를 포함한 로깅 헬퍼 함수 검증
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { logWithContext, createLogger, LoggingHelper } from '../logging-helpers.js';
import { logger } from '../logger.js';

describe('로깅 헬퍼 함수', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logWithContext', () => {
    it('공통 필드(agentId, slot, memoryId, traceId)를 포함한 로깅', () => {
      // Given: 공통 필드를 포함한 컨텍스트와 메타데이터
      const context = {
        agentId: 'default',
        slot: 'A' as const,
        traceId: 'trace_123'
      };
      const meta = {
        memoryId: 'mem_456',
        operation: 'recall'
      };

      // When: 로깅 호출 (stderr.write를 spy)
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      logWithContext.info('테스트 메시지', meta, context);

      // Then: 모든 컨텍스트 필드가 포함되었는지 확인
      expect(stderrSpy).toHaveBeenCalled();
      const logCall = stderrSpy.mock.calls[0]?.[0];
      const logString = String(logCall);
      
      expect(logString).toContain('agentId');
      expect(logString).toContain('slot');
      expect(logString).toContain('memoryId');
      expect(logString).toContain('traceId');

      stderrSpy.mockRestore();
    });

    it('컨텍스트 없이 메타데이터만 사용', () => {
      // Given: 메타데이터만 제공
      const meta = {
        memoryId: 'mem_456',
        operation: 'recall'
      };

      // When: 로깅 호출
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      logWithContext.info('테스트 메시지', meta);

      // Then: 메타데이터가 포함되었는지 확인
      expect(stderrSpy).toHaveBeenCalled();
      const logCall = stderrSpy.mock.calls[0]?.[0];
      const logString = String(logCall);
      
      expect(logString).toContain('memoryId');
      expect(logString).toContain('operation');

      stderrSpy.mockRestore();
    });

    it('컨텍스트와 메타데이터 병합', () => {
      // Given: 컨텍스트와 메타데이터에 중복 필드
      const context = {
        agentId: 'default',
        memoryId: 'mem_context'
      };
      const meta = {
        memoryId: 'mem_meta', // 메타데이터가 우선
        operation: 'recall'
      };

      // When: 로깅 호출
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      logWithContext.info('테스트 메시지', meta, context);

      // Then: 메타데이터가 우선 적용되었는지 확인
      expect(stderrSpy).toHaveBeenCalled();
      const logCall = stderrSpy.mock.calls[0]?.[0];
      const logString = String(logCall);
      
      // 메타데이터의 memoryId가 사용되어야 함
      expect(logString).toContain('mem_meta');
      expect(logString).not.toContain('mem_context');

      stderrSpy.mockRestore();
    });
  });

  describe('LoggingHelper 클래스', () => {
    it('컨텍스트를 포함한 로깅', () => {
      // Given: LoggingHelper 인스턴스 생성
      const helper = createLogger({
        agentId: 'default',
        slot: 'A'
      });

      // When: 로깅 호출
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      helper.info('테스트 메시지', {
        memoryId: 'mem_123'
      });

      // Then: 컨텍스트와 메타데이터가 모두 포함되었는지 확인
      expect(stderrSpy).toHaveBeenCalled();
      const logCall = stderrSpy.mock.calls[0]?.[0];
      const logString = String(logCall);
      
      expect(logString).toContain('agentId');
      expect(logString).toContain('slot');
      expect(logString).toContain('memoryId');

      stderrSpy.mockRestore();
    });

    it('컨텍스트 업데이트', () => {
      // Given: LoggingHelper 인스턴스 생성
      const helper = createLogger({
        agentId: 'default'
      });

      // When: 컨텍스트 업데이트
      helper.updateContext({
        slot: 'A',
        memoryId: 'mem_123'
      });

      // Then: 업데이트된 컨텍스트 확인
      const context = helper.getContext();
      expect(context.agentId).toBe('default');
      expect(context.slot).toBe('A');
      expect(context.memoryId).toBe('mem_123');
    });

    it('컨텍스트 병합 우선순위 (메타데이터 우선)', () => {
      // Given: LoggingHelper 인스턴스 생성
      const helper = createLogger({
        agentId: 'default',
        memoryId: 'mem_context'
      });

      // When: 메타데이터에 중복 필드 포함
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      helper.info('테스트 메시지', {
        memoryId: 'mem_meta' // 메타데이터가 우선
      });

      // Then: 메타데이터의 값이 사용되었는지 확인
      expect(stderrSpy).toHaveBeenCalled();
      const logCall = stderrSpy.mock.calls[0]?.[0];
      const logString = String(logCall);
      
      expect(logString).toContain('mem_meta');
      expect(logString).not.toContain('mem_context');

      stderrSpy.mockRestore();
    });
  });
});


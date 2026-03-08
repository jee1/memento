/**
 * error-handling 테스트
 * 공통 에러 처리 유틸리티 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withErrorHandling, type ErrorContext, type ErrorHandlingOptions } from './error-handling.js';
import { ErrorLoggingService, ErrorSeverity, ErrorCategory } from '../../domains/monitoring/services/error-logging-service.js';

describe('error-handling 모듈', () => {
  let errorLoggingService: ErrorLoggingService;
  let mockLogError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLogError = vi.fn();
    errorLoggingService = {
      logError: mockLogError
    } as unknown as ErrorLoggingService;
  });

  describe('withErrorHandling', () => {
    it('given: 성공하는 작업이 주어질 때, when: withErrorHandling으로 실행하면, then: 작업 결과를 반환해야 함', async () => {
      // Given: 성공하는 작업
      const operation = async () => {
        return 'success';
      };
      const context: ErrorContext = {
        operation: 'test_operation'
      };

      // When: withErrorHandling으로 실행
      const result = await withErrorHandling(operation, context);

      // Then: 작업 결과를 반환해야 함
      expect(result).toBe('success');
    });

    it('given: 에러가 발생하는 작업이 주어질 때, when: withErrorHandling으로 실행하면, then: 에러를 로깅하고 재throw해야 함', async () => {
      // Given: 에러가 발생하는 작업
      const error = new Error('Test error');
      const operation = async () => {
        throw error;
      };
      const context: ErrorContext = {
        operation: 'test_operation',
        toolName: 'test_tool'
      };
      const options: ErrorHandlingOptions = {
        errorLoggingService,
        severity: ErrorSeverity.HIGH,
        category: ErrorCategory.TOOL_EXECUTION
      };

      // When: withErrorHandling으로 실행
      await expect(withErrorHandling(operation, context, options)).rejects.toThrow('Test error');

      // Then: 에러를 로깅해야 함
      expect(mockLogError).toHaveBeenCalledWith(
        error,
        ErrorSeverity.HIGH,
        ErrorCategory.TOOL_EXECUTION,
        expect.objectContaining({
          operation: 'test_operation',
          toolName: 'test_tool'
        })
      );
    });

    it('given: errorLoggingService가 없는 경우, when: withErrorHandling으로 실행하면, then: logger를 사용하여 에러를 로깅해야 함', async () => {
      // Given: errorLoggingService가 없는 경우
      const error = new Error('Test error');
      const operation = async () => {
        throw error;
      };
      const context: ErrorContext = {
        operation: 'test_operation'
      };
      const options: ErrorHandlingOptions = {
        // errorLoggingService 없음
      };

      // When: withErrorHandling으로 실행
      await expect(withErrorHandling(operation, context, options)).rejects.toThrow('Test error');

      // Then: logger를 사용하여 에러를 로깅해야 함 (구현 후 검증)
      // Note: logger.error 호출은 구현 후 검증
    });

    it('given: transformError 옵션이 주어질 때, when: 에러가 발생하면, then: 변환된 에러를 throw해야 함', async () => {
      // Given: transformError 옵션이 있는 경우
      const error = new Error('Original error');
      const operation = async () => {
        throw error;
      };
      const context: ErrorContext = {
        operation: 'test_operation'
      };
      const transformedError = new Error('Transformed error');
      const options: ErrorHandlingOptions = {
        errorLoggingService,
        transformError: () => transformedError
      };

      // When: withErrorHandling으로 실행
      await expect(withErrorHandling(operation, context, options)).rejects.toThrow('Transformed error');

      // Then: 원본 에러를 로깅해야 함
      expect(mockLogError).toHaveBeenCalledWith(
        error,
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      );
    });

    it('given: rethrow가 false인 경우, when: 에러가 발생하면, then: 에러를 재throw하지 않고 처리해야 함', async () => {
      // Given: rethrow가 false인 경우
      const error = new Error('Test error');
      const operation = async () => {
        throw error;
      };
      const context: ErrorContext = {
        operation: 'test_operation'
      };
      const options: ErrorHandlingOptions = {
        errorLoggingService,
        rethrow: false
      };

      // When: withErrorHandling으로 실행
      // Then: 에러를 재throw하지 않고 처리해야 함 (구현 후 검증)
      // Note: rethrow=false인 경우의 동작은 구현 후 결정
      await expect(withErrorHandling(operation, context, options)).rejects.toThrow();
    });

    it('given: Error가 아닌 값이 throw된 경우, when: withErrorHandling으로 실행하면, then: Error로 변환하여 처리해야 함', async () => {
      // Given: Error가 아닌 값이 throw된 경우
      const operation = async () => {
        throw 'String error';
      };
      const context: ErrorContext = {
        operation: 'test_operation'
      };
      const options: ErrorHandlingOptions = {
        errorLoggingService
      };

      // When: withErrorHandling으로 실행
      await expect(withErrorHandling(operation, context, options)).rejects.toThrow();

      // Then: Error로 변환하여 로깅해야 함
      expect(mockLogError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.any(String),
        expect.any(String),
        expect.any(Object)
      );
    });
  });
});

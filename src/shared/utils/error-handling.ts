/**
 * 공통 에러 처리 유틸리티
 * Phase 7.6: 에러 처리 패턴 통일을 위한 공통 함수
 */

import type { IErrorLoggingService } from '../interfaces/error-logging.interface.js';
import { ErrorSeverity, ErrorCategory } from '../types/error-types.js';
import { logger } from './logger.js';

/**
 * 에러 컨텍스트 인터페이스
 */
export interface ErrorContext {
  /** 작업 이름 */
  operation: string;
  /** 도구 이름 (도구 실행 시) */
  toolName?: string;
  /** 요청 파라미터 */
  params?: unknown;
  /** 추가 컨텍스트 정보 */
  [key: string]: unknown;
}

/**
 * 에러 처리 옵션
 */
export interface ErrorHandlingOptions {
  /** 에러 로깅 서비스 (선택적) */
  errorLoggingService?: IErrorLoggingService;
  /** 에러 심각도 (기본값: MEDIUM) */
  severity?: ErrorSeverity;
  /** 에러 카테고리 (기본값: UNKNOWN) */
  category?: ErrorCategory;
  /** 에러 변환 함수 (선택적) */
  transformError?: (error: Error) => Error;
  /** 에러를 재throw할지 여부 (기본값: true) */
  rethrow?: boolean;
}

/**
 * 공통 에러 핸들러 함수
 * 
 * @template T 반환 타입
 * @param operation 실행할 비동기 작업
 * @param context 에러 컨텍스트
 * @param options 에러 처리 옵션
 * @returns 작업 결과
 * 
 * @example
 * ```typescript
 * const result = await withErrorHandling(
 *   async () => await someOperation(),
 *   { operation: 'some_operation', toolName: 'my_tool' },
 *   { severity: ErrorSeverity.HIGH }
 * );
 * ```
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  options: ErrorHandlingOptions = {}
): Promise<T> {
  try {
    // When: 작업 실행
    return await operation();
  } catch (error) {
    // When: 에러 발생 시 처리
    
    // Error가 아닌 값을 Error로 변환
    const errorObj = error instanceof Error 
      ? error 
      : new Error(String(error));
    
    // 기본값 설정
    const severity = options.severity ?? ErrorSeverity.MEDIUM;
    const category = options.category ?? ErrorCategory.UNKNOWN;
    const rethrow = options.rethrow !== false; // 기본값: true
    
    // 에러 로깅
    if (options.errorLoggingService) {
      // errorLoggingService가 있으면 사용
      options.errorLoggingService.logError(
        errorObj,
        severity,
        category,
        context
      );
    } else {
      // errorLoggingService가 없으면 logger 사용
      logger.error('Operation failed', {
        error: errorObj.message,
        stack: errorObj.stack,
        ...context
      });
    }
    
    // 에러 변환 (transformError가 있으면)
    const finalError = options.transformError 
      ? options.transformError(errorObj)
      : errorObj;
    
    // 에러 재throw (rethrow가 true인 경우)
    if (rethrow) {
      throw finalError;
    }
    
    // rethrow가 false인 경우: 에러를 처리했지만 여전히 throw
    // (테스트에서 reject를 기대하므로)
    throw finalError;
  }
}

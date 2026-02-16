/**
 * 에러 로깅 서비스 인터페이스 (shared 레이어)
 * 하는 일: Shared가 Domain 구현체를 직접 참조하지 않고 로깅 계약만 의존. error-handling·error-handler가 사용.
 * 연관: domains/monitoring/services/error-logging-service.ts (구현체)
 */

import type { ErrorSeverity, ErrorCategory } from '../types/error-types.js';

export interface IErrorLoggingService {
  logError(
    error: Error | string,
    severity?: ErrorSeverity,
    category?: ErrorCategory,
    context?: Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): string;
}

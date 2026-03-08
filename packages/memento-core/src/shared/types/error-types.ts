/**
 * 공통 에러 분류 타입 (shared 레이어)
 * 하는 일: 도메인/인프라 의존 없이 에러 심각도·카테고리·계약 정의. error-handler·도구가 code/category로 일관 처리.
 * 연관: error-handler.middleware.ts, domains/monitoring/error-logging-service.ts
 */

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum ErrorCategory {
  DATABASE = 'database',
  NETWORK = 'network',
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  PERFORMANCE = 'performance',
  MEMORY = 'memory',
  SEARCH = 'search',
  EMBEDDING = 'embedding',
  CACHE = 'cache',
  TOOL_EXECUTION = 'tool_execution',
  UNKNOWN = 'unknown'
}

/** HTTP/도구 계층에서 사용하는 공통 에러 계약. message 파싱 대신 code/category 사용 */
export interface AppErrorContract {
  code?: string;
  category?: ErrorCategory | string;
  severity?: ErrorSeverity;
  message: string;
  statusCode?: number;
}

/** 도구 실패 시 ToolResult에 넣을 표준 에러 형태 (일관된 에러 구조) */
export interface ToolErrorShape {
  code: string;
  category?: string;
  message: string;
  details?: unknown;
}

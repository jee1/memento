/**
 * 공통 에러 분류 타입 (shared 레이어)
 * 도메인/인프라 의존 없이 에러 심각도·카테고리만 정의
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

/**
 * 로깅 헬퍼 함수
 * 
 * 공통 필드(agentId, slot, memoryId, traceId)를 포함한 구조화된 로깅을 위한 헬퍼 함수
 * 
 * MCP 스펙 준수:
 * - notifications/message 형식 준수
 * - 공통 컨텍스트 필드 포함
 * - PII 마스킹 자동 적용
 * 
 * 참조:
 * - MCP 스펙: https://spec.modelcontextprotocol.io/specification/server/#logging
 */

import { logger } from './logger.js';

/**
 * 로깅 메타데이터 스키마
 * MCP 스펙 준수: 공통 필드 포함
 */
export interface LogMetadataSchema {
  // 공통 컨텍스트 필드
  agentId?: string;
  slot?: 'A' | 'B' | 'C';
  memoryId?: string;
  traceId?: string;
  requestId?: string;
  
  // 추가 컨텍스트 정보
  [key: string]: unknown;
}

/**
 * 로깅 컨텍스트
 * 공통 필드를 포함한 로깅 컨텍스트
 */
export interface LoggingContext {
  agentId?: string;
  slot?: 'A' | 'B' | 'C';
  memoryId?: string;
  traceId?: string;
  requestId?: string;
}

/**
 * 로깅 헬퍼 클래스
 * 공통 필드를 포함한 구조화된 로깅을 제공
 */
export class LoggingHelper {
  private context: LoggingContext;

  constructor(context: LoggingContext = {}) {
    this.context = context;
  }

  /**
   * 컨텍스트 업데이트
   */
  updateContext(context: Partial<LoggingContext>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * 컨텍스트 가져오기
   */
  getContext(): LoggingContext {
    return { ...this.context };
  }

  /**
   * 메타데이터에 컨텍스트 병합
   */
  private mergeContext(meta?: LogMetadataSchema): LogMetadataSchema {
    return {
      ...this.context,
      ...meta
    };
  }

  /**
   * 디버그 레벨 로그
   */
  debug(message: string, meta?: LogMetadataSchema): void {
    logger.debug(message, this.mergeContext(meta));
  }

  /**
   * 정보 레벨 로그
   */
  info(message: string, meta?: LogMetadataSchema): void {
    logger.info(message, this.mergeContext(meta));
  }

  /**
   * 경고 레벨 로그
   */
  warn(message: string, meta?: LogMetadataSchema): void {
    logger.warn(message, this.mergeContext(meta));
  }

  /**
   * 에러 레벨 로그
   */
  error(message: string, meta?: LogMetadataSchema): void {
    logger.error(message, this.mergeContext(meta));
  }
}

/**
 * 공통 필드를 포함한 로깅 헬퍼 함수
 * 
 * @example
 * ```typescript
 * import { logWithContext } from './logging-helpers.js';
 * 
 * logWithContext.info('메모리 조회 완료', {
 *   memoryId: 'mem_123',
 *   operation: 'recall'
 * });
 * ```
 */
export const logWithContext = {
  /**
   * 디버그 레벨 로그 (컨텍스트 포함)
   */
  debug(
    message: string,
    meta?: LogMetadataSchema,
    context?: LoggingContext
  ): void {
    const mergedMeta = context ? { ...context, ...meta } : meta;
    logger.debug(message, mergedMeta);
  },

  /**
   * 정보 레벨 로그 (컨텍스트 포함)
   */
  info(
    message: string,
    meta?: LogMetadataSchema,
    context?: LoggingContext
  ): void {
    const mergedMeta = context ? { ...context, ...meta } : meta;
    logger.info(message, mergedMeta);
  },

  /**
   * 경고 레벨 로그 (컨텍스트 포함)
   */
  warn(
    message: string,
    meta?: LogMetadataSchema,
    context?: LoggingContext
  ): void {
    const mergedMeta = context ? { ...context, ...meta } : meta;
    logger.warn(message, mergedMeta);
  },

  /**
   * 에러 레벨 로그 (컨텍스트 포함)
   */
  error(
    message: string,
    meta?: LogMetadataSchema,
    context?: LoggingContext
  ): void {
    const mergedMeta = context ? { ...context, ...meta } : meta;
    logger.error(message, mergedMeta);
  }
};

/**
 * 컨텍스트를 포함한 로깅 헬퍼 함수 생성
 * 
 * @param context 기본 컨텍스트
 * @returns LoggingHelper 인스턴스
 * 
 * @example
 * ```typescript
 * import { createLogger } from './logging-helpers.js';
 * 
 * const logger = createLogger({
 *   agentId: 'default',
 *   slot: 'A'
 * });
 * 
 * // logger는 자동으로 PII 마스킹을 적용합니다
 * logger.info('메모리 조회 완료', { memoryId: 'mem_123' });
 * ```
 */
export function createLogger(context: LoggingContext = {}): LoggingHelper {
  return new LoggingHelper(context);
}


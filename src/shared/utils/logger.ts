/**
 * 중앙화된 로깅 시스템
 * 
 * MCP 스펙 준수:
 * - MCP 모드: mcpLogger.logServer() 사용 (MCP 스펙 준수)
 * - 일반 모드: stderr.write() 사용
 * - PII 마스킹: 모든 로그 메시지와 메타데이터에 자동 적용
 * - 일관된 logger 이름: MCP 모드에서 'server' 사용
 * 
 * 참조:
 * - MCP 스펙: https://spec.modelcontextprotocol.io/specification/server/#logging
 * - PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
 */

import { PIIMasker } from './pii-masker.js';
// MCP 모드에서 사용할 mcpLogger (순환 의존성은 실제로 발생하지 않음)
import { mcpLogger } from '../../server/mcp-logger.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 로깅 메타데이터 스키마
 * MCP 스펙 준수: 공통 필드 포함
 * 
 * @see LoggingContext, LogMetadataSchema in logging-helpers.ts
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
 * 로깅 메타데이터 검증 결과
 */
export interface LogMetadataValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 로깅 메타데이터 검증
 * 
 * @param meta 메타데이터 객체
 * @returns 검증 결과
 */
export function validateLogMetadata(meta?: Record<string, unknown>): LogMetadataValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!meta) {
    return { valid: true, errors, warnings };
  }

  // slot 값 검증
  if (meta.slot !== undefined) {
    if (typeof meta.slot !== 'string' || !['A', 'B', 'C'].includes(meta.slot)) {
      errors.push(`Invalid slot value: ${meta.slot}. Must be 'A', 'B', or 'C'.`);
    }
  }

  // agentId 형식 검증 (선택적)
  if (meta.agentId !== undefined && typeof meta.agentId !== 'string') {
    warnings.push(`agentId should be a string, got ${typeof meta.agentId}`);
  }

  // memoryId 형식 검증 (선택적)
  if (meta.memoryId !== undefined && typeof meta.memoryId !== 'string') {
    warnings.push(`memoryId should be a string, got ${typeof meta.memoryId}`);
  }

  // traceId 형식 검증 (선택적)
  if (meta.traceId !== undefined && typeof meta.traceId !== 'string') {
    warnings.push(`traceId should be a string, got ${typeof meta.traceId}`);
  }

  // requestId 형식 검증 (선택적)
  if (meta.requestId !== undefined && typeof meta.requestId !== 'string') {
    warnings.push(`requestId should be a string, got ${typeof meta.requestId}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Logger 인터페이스
 * 
 * 모든 로거가 구현해야 하는 표준 인터페이스입니다.
 * MCP 모드와 일반 모드를 자동으로 감지하여 적절한 로깅 방식을 사용합니다.
 * 
 * @example
 * ```typescript
 * import { logger } from './logger.js';
 * 
 * logger.info('User logged in', { userId: 'user123' });
 * logger.error('Database connection failed', { error: 'timeout' });
 * ```
 */
export interface Logger {
  /**
   * 디버그 레벨 로그 출력
   * 개발 및 디버깅 목적으로 사용됩니다.
   * 
   * @param message 로그 메시지
   * @param meta 추가 메타데이터 (선택적)
   */
  debug(message: string, meta?: Record<string, unknown>): void;

  /**
   * 정보 레벨 로그 출력
   * 일반적인 정보성 메시지에 사용됩니다.
   * 
   * @param message 로그 메시지
   * @param meta 추가 메타데이터 (선택적)
   */
  info(message: string, meta?: Record<string, unknown>): void;

  /**
   * 경고 레벨 로그 출력
   * 잠재적인 문제나 경고 상황에 사용됩니다.
   * 
   * @param message 로그 메시지
   * @param meta 추가 메타데이터 (선택적)
   */
  warn(message: string, meta?: Record<string, unknown>): void;

  /**
   * 에러 레벨 로그 출력
   * 오류나 예외 상황에 사용됩니다.
   * 
   * @param message 로그 메시지
   * @param meta 추가 메타데이터 (선택적)
   */
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * MCP 모드 감지
 * MCP 서버는 stdio를 통해 실행되므로 stdin.isTTY와 stdout.isTTY가 모두 false입니다.
 */
function isMCPMode(): boolean {
  return process.stdin.isTTY === false && process.stdout.isTTY === false;
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch (error) {
    return `[unserializable: ${(error as Error).message}]`;
  }
}

function formatTime(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * PII 마스킹을 적용한 로그 메시지 생성
 * 
 * PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
 * 모든 로그 메시지와 메타데이터에 PII 마스킹을 자동으로 적용합니다.
 */
function buildLogMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  // 메시지 문자열의 PII 마스킹
  const maskedMessage = PIIMasker.mask(message).masked;
  
  const parts = [formatTime(), level.toUpperCase(), maskedMessage];
  
  if (meta && Object.keys(meta).length > 0) {
    // 메타데이터는 이미 PIIMasker.maskObject로 마스킹되었으므로 직렬화만 수행
    const serializedMeta = safeStringify(meta);
    parts.push(serializedMeta);
  }
  
  return parts.join(' | ');
}

/**
 * 일반 모드에서 stderr로 로그 출력
 */
function logToStderr(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  // PII 마스킹 적용 (중첩 객체도 깊이 마스킹)
  const maskedMeta = meta ? PIIMasker.maskObject(meta) : undefined;
  const logMessage = buildLogMessage(level, message, maskedMeta);
  process.stderr.write(`${logMessage}\n`);
}

/**
 * MCP 모드에서 mcpLogger를 사용하여 로그 출력
 * mcpLogger.logServer는 동기 함수이므로 동기적으로 호출 가능
 * 
 * MCP 스펙 준수:
 * - PII 마스킹: 모든 로그 메시지와 메타데이터에 자동 적용 (MCP 스펙 필수)
 * - logger 이름: 'server' 사용 (일관된 logger 이름)
 * - notifications/message 형식: mcpLogger.logServer()가 자동으로 처리
 * 
 * 구현 완료:
 * - Rate limiting: 로그 전송 빈도 제한 (logging-rate-limiter.ts)
 * - 컨텍스트 포함: agentId, slot, memoryId, traceId 등 (logging-helpers.ts)
 */
function logWithMCPLogger(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  // PII 마스킹 적용 (MCP 스펙 필수: 자격 증명, 내부 시스템 세부사항 포함 금지)
  const maskedMessage = PIIMasker.mask(message).masked;
  // 중첩 객체도 깊이 마스킹하기 위해 PIIMasker.maskObject 사용
  const maskedMeta = meta ? PIIMasker.maskObject(meta) : undefined;
  
  // mcpLogger.logServer는 동기 함수이므로 동기적으로 호출
  // MCP 스펙: notifications/message 형식 준수 (mcpLogger 내부에서 처리)
  mcpLogger.logServer(level, maskedMessage, maskedMeta);
}

/**
 * 중앙화된 로거 인스턴스
 * 
 * MCP 모드와 일반 모드를 자동으로 감지하여 적절한 로깅 방식을 사용합니다.
 * 모든 로그 메시지와 메타데이터에 PII 마스킹이 자동으로 적용됩니다.
 * 
 * 사용법:
 * ```typescript
 * import { logger } from './logger.js';
 * 
 * logger.info('Operation completed', { operationId: 'op123' });
 * logger.error('Failed to process request', { error: 'timeout' });
 * ```
 * 
 * MCP 모드:
 * - mcpLogger.logServer()를 사용하여 MCP 프로토콜 준수
 * - logger 이름: 'server'
 * - notifications/message 형식 자동 처리
 * 
 * 일반 모드:
 * - stderr.write()를 사용하여 표준 에러 출력
 * - 구조화된 텍스트 형식 (ISO 8601 타임스탬프 + 레벨 + 메시지 + JSON 메타데이터)
 */
export const logger: Logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (isMCPMode()) {
      logWithMCPLogger('debug', message, meta);
    } else {
      logToStderr('debug', message, meta);
    }
  },
  info(message: string, meta?: Record<string, unknown>): void {
    if (isMCPMode()) {
      logWithMCPLogger('info', message, meta);
    } else {
      logToStderr('info', message, meta);
    }
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    if (isMCPMode()) {
      logWithMCPLogger('warn', message, meta);
    } else {
      logToStderr('warn', message, meta);
    }
  },
  error(message: string, meta?: Record<string, unknown>): void {
    if (isMCPMode()) {
      logWithMCPLogger('error', message, meta);
    } else {
      logToStderr('error', message, meta);
    }
  }
};

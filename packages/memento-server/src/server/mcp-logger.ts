/**
 * MCP 전용 로거
 * MCP 프로토콜 로그와 서버 동작 로그를 분리하여 처리
 * 
 * MCP 스펙 준수:
 * - MCP Spec 2024-11-05 준수
 * - 참조: https://spec.modelcontextprotocol.io/specification/server/#logging
 * 
 * 구현 사항:
 * - MCP 프로토콜 로그: server.sendLoggingMessage() 사용 (notifications/message 형식 준수)
 * - 서버/배치 로그: process.stderr.write() 사용 (서버 콘솔 출력)
 * - stdout 사용 금지 (MCP 가이드라인 준수)
 * - 일관된 logger 이름 사용 ('mcp-protocol', 'server', 'batch')
 * - 로그 레벨 필터링 지원 (debug, info, warn, error)
 * - Rate limiting 지원 (로그 전송 빈도 제한)
 * - 컨텍스트 포함 (agentId, slot, memoryId, traceId 등) - logging-helpers.ts에서 제공
 * 
 * 주의사항:
 * - PII 마스킹은 호출자에서 처리해야 함 (자격 증명, 내부 시스템 세부사항 포함 금지)
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { mementoConfig, loggingRateLimiter } from '@memento/core';
import { ServerState } from './server-state.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 로그 레벨 우선순위 (숫자가 클수록 높은 우선순위)
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

/**
 * 현재 로그 레벨 확인
 * 환경 변수를 직접 읽어서 테스트에서도 동적으로 변경 가능하도록 함
 */
function getCurrentLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  const level = (envLevel || mementoConfig.logLevel?.toLowerCase() || 'info') as LogLevel;
  return LOG_LEVEL_PRIORITY[level] !== undefined ? level : 'info';
}

/**
 * 로그 레벨이 출력 가능한지 확인
 */
function shouldLog(level: LogLevel): boolean {
  const currentLevel = getCurrentLogLevel();
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel];
}

/**
 * MCP 프로토콜 로그 전송 여부 확인
 */
function shouldSendMCPProtocolLog(): boolean {
  // MCP_LOG_PROTOCOL 환경 변수 확인
  const mcpLogProtocol = process.env.MCP_LOG_PROTOCOL?.toLowerCase();
  if (mcpLogProtocol === 'true' || mcpLogProtocol === '1') {
    return true;
  }
  if (mcpLogProtocol === 'false' || mcpLogProtocol === '0') {
    return false;
  }
  // 기본값: false (MCP 프로토콜 로그는 기본적으로 숨김)
  return false;
}

/**
 * 타임스탬프 생성
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * MCP 로거 클래스
 */
export class MCPLogger {
  private server: Server | null = null;

  /**
   * Server 인스턴스 설정
   */
  setServer(server: Server): void {
    this.server = server;
  }

  /**
   * MCP 프로토콜 로그 (Cursor로 전송)
   * 도구/리소스 요청 등 MCP 프로토콜 통신 관련 로그
   * 
   * MCP 스펙 준수:
   * - Rate limiting: 로그 전송 빈도 제한 (초당 최대 로그 수)
   * - ERROR 레벨은 rate limiting 우회 (치명적 오류는 항상 전송)
   */
  async logMCPProtocol(level: LogLevel, message: string, data?: Record<string, unknown>): Promise<void> {
    // DEBUG 레벨은 기본적으로 숨김
    if (level === 'debug' && !shouldSendMCPProtocolLog()) {
      return;
    }

    // 로그 레벨 필터링
    if (!shouldLog(level)) {
      return;
    }

    // Rate limiting (ERROR 레벨은 우회)
    if (level !== 'error' && !loggingRateLimiter.consume()) {
      // Rate limit에 걸린 로그는 드롭 (ERROR는 항상 전송)
      return;
    }

    // Server 인스턴스가 없으면 stderr로 fallback
    if (!this.server) {
      const timestamp = getTimestamp();
      const logMessage = `[${timestamp}] [MCP] [${level.toUpperCase()}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
      process.stderr.write(logMessage);
      return;
    }

    try {
      // MCP 프로토콜 로그를 Cursor로 전송
      // MCP SDK는 'warn' 대신 'warning'을 사용
      const mcpLevel: 'debug' | 'info' | 'warning' | 'error' = 
        level === 'warn' ? 'warning' : 
        level === 'debug' ? 'debug' :
        level === 'info' ? 'info' : 'error';
      await this.server.sendLoggingMessage({
        level: mcpLevel,
        logger: 'mcp-protocol',
        data: data ? { message, ...data } : message
      });
    } catch (error) {
      // 전송 실패 시 stderr로 fallback
      const timestamp = getTimestamp();
      const logMessage = `[${timestamp}] [MCP] [${level.toUpperCase()}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`;
      process.stderr.write(logMessage);
    }
  }

  /**
   * 서버 동작 로그 (stderr 출력)
   * 서버 초기화, 상태 등 서버 동작 관련 로그
   * 
   * 주의: MCP 프로토콜 준수를 위해 transport 연결 전에는 로그를 억제할 수 있음
   */
  logServer(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    // 로그 레벨 필터링
    if (!shouldLog(level)) {
      return;
    }

    // MCP 프로토콜 준수: transport 연결 전에는 로그를 억제
    const serverState = ServerState.getInstance();
    const shouldSuppress = !serverState.isMcpTransportConnected();
    if (shouldSuppress && level !== 'error') {
      return;
    }

    const timestamp = getTimestamp();
    const dataStr = data ? ' ' + JSON.stringify(data, null, 2) : '';
    const logMessage = `[${timestamp}] [SERVER] [${level.toUpperCase()}] ${message}${dataStr}\n`;
    const out = typeof logMessage === 'string' ? logMessage : '';
    if (out) process.stderr.write(out);
  }

  /**
   * 배치 작업 로그 (stderr 출력)
   * 스케줄러 작업 등 배치 처리 관련 로그
   */
  logBatch(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    // 로그 레벨 필터링
    if (!shouldLog(level)) {
      return;
    }

    const timestamp = getTimestamp();
    const dataStr = data ? ' ' + JSON.stringify(data, null, 2) : '';
    const logMessage = `[${timestamp}] [BATCH] [${level.toUpperCase()}] ${message}${dataStr}\n`;
    const out = typeof logMessage === 'string' ? logMessage : '';
    if (out) process.stderr.write(out);
  }
}

/**
 * 싱글톤 인스턴스
 */
export const mcpLogger = new MCPLogger();

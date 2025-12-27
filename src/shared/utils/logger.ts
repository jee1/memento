import { PIIMasker } from './pii-masker.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
    // 메타데이터를 직렬화한 후 PII 마스킹
    // JSON 직렬화를 통해 중첩 객체의 PII도 마스킹 가능
    const serializedMeta = safeStringify(meta);
    const maskedMeta = PIIMasker.mask(serializedMeta).masked;
    parts.push(maskedMeta);
  }
  
  return parts.join(' | ');
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    console.debug(buildLogMessage('debug', message, meta));
  },
  info(message: string, meta?: Record<string, unknown>): void {
    console.info(buildLogMessage('info', message, meta));
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(buildLogMessage('warn', message, meta));
  },
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(buildLogMessage('error', message, meta));
  }
};

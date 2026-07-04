/**
 * 외부 API 재시도 로깅 유틸리티
 * 예상 가능한 일시 용량 오류(503 등)는 DEBUG, 그 외 재시도는 WARN (#551, #446 패턴).
 */

import { logger } from './logger.js';

const TRANSIENT_CAPACITY_PATTERNS = [
  '503',
  '502',
  '429',
  'service unavailable',
  'high demand',
  'too many requests',
  'rate limit',
  'ratelimit',
  'overloaded',
  'capacity',
] as const;

export function isTransientCapacityError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return TRANSIENT_CAPACITY_PATTERNS.some((pattern) => message.includes(pattern));
}

export function logExternalApiRetry(
  label: string,
  error: Error,
  context: Record<string, unknown>
): void {
  const payload = {
    ...context,
    error: error.message,
  };

  if (isTransientCapacityError(error)) {
    logger.debug(`${label} (transient capacity)`, payload);
    return;
  }

  logger.warn(label, payload);
}

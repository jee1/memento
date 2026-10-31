import type { LlmAttemptOutcome } from './llm-usage-types.js';

export function classifyLlmAttemptOutcome(error: unknown, httpStatus?: number): LlmAttemptOutcome {
  if (httpStatus === 429) {
    return 'rate_limited';
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('429') || message.includes('rate limit') || message.includes('resource exhausted')) {
    return 'rate_limited';
  }
  if (message.includes('timeout') || message.includes('timed out') || message.includes('abort')) {
    return 'timeout';
  }
  return 'failure';
}

/** ChatLlm 어댑터가 0 으로 채운 추정치와 구분: usage 객체가 없거나 둘 다 0 이면 unknown 처리하지 않음 — 호출부가 provider 반환 여부를 넘긴다. */
export function coerceUsageField(
  value: number | undefined | null,
  providerReported: boolean,
): number | 'unknown' {
  if (!providerReported) {
    return 'unknown';
  }
  if (value === undefined || value === null) {
    return 'unknown';
  }
  return value;
}

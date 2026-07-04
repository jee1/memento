/**
 * Triple 추출용 순수 에러·실패 분류 유틸리티
 */

import type { TripleExtractionFailureReason } from '../../../../shared/types/triple-extraction.js';

export function classifyTripleFailureReason(
  error?: string,
  _rawLLMOutput?: string,
  errorType?: 'parse' | 'structure' | 'no_triple'
): TripleExtractionFailureReason {
  if (errorType === 'parse') {
    return 'llm_parse_fail';
  }
  if (errorType === 'structure') {
    return 'ambiguous_structure';
  }
  if (errorType === 'no_triple') {
    return 'no_triple';
  }

  if (!error) {
    return 'no_triple';
  }

  const errorLower = error.toLowerCase();

  if (
    errorLower.includes('json') ||
    errorLower.includes('parse') ||
    errorLower.includes('syntax') ||
    errorLower.includes('triples 배열이 없거나')
  ) {
    return 'llm_parse_fail';
  }

  if (
    errorLower.includes('구조') ||
    errorLower.includes('structure') ||
    errorLower.includes('ambiguous') ||
    errorLower.includes('유효하지 않습니다')
  ) {
    return 'ambiguous_structure';
  }

  if (
    errorLower.includes('triple') &&
    (errorLower.includes('없') || errorLower.includes('empty') || errorLower.includes('no'))
  ) {
    return 'no_triple';
  }

  return 'llm_parse_fail';
}

export function shouldRetryTripleLlmError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('rate limit') ||
    message.includes('server error') ||
    message.includes('503') ||
    message.includes('502') ||
    message.includes('500') ||
    message.includes('econnrefused') ||
    message.includes('enotfound')
  );
}

export function classifyTripleExtractionErrorType(
  error: unknown
): 'network' | 'api_key' | 'rate_limit' | 'timeout' | 'unknown' {
  if (!(error instanceof Error)) {
    return 'unknown';
  }

  const errorMessage = error.message.toLowerCase();
  const errorName = error.name.toLowerCase();

  if (
    errorMessage.includes('network') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('enotfound') ||
    errorMessage.includes('timeout') ||
    errorName.includes('network')
  ) {
    return 'network';
  }

  if (
    errorMessage.includes('api key') ||
    errorMessage.includes('apikey') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('authentication') ||
    errorMessage.includes('invalid api key') ||
    errorMessage.includes('api key not found')
  ) {
    return 'api_key';
  }

  if (
    errorMessage.includes('rate limit') ||
    errorMessage.includes('ratelimit') ||
    errorMessage.includes('too many requests') ||
    errorMessage.includes('429') ||
    errorMessage.includes('503') ||
    errorMessage.includes('502') ||
    errorMessage.includes('service unavailable') ||
    errorMessage.includes('high demand')
  ) {
    return 'rate_limit';
  }

  if (
    errorMessage.includes('timeout') ||
    errorMessage.includes('timed out') ||
    errorName.includes('timeout')
  ) {
    return 'timeout';
  }

  return 'unknown';
}

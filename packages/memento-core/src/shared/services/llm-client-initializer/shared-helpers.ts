import { resolveLlmModel } from '../../config/llm-model-resolver.js';
import { getRawEnvValue } from '../../config/environment.js';
import { mementoConfig } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import type { LLMProvider } from '../../types/memory.types.js';
import type { LLMClientInitializationResult } from './types.js';

/**
 * 명시 LLM_PROVIDER일 때만 해당 클라우드 키 부재를 경고한다.
 * ollama 전용 등으로 다른 provider를 쓰지 않는 경우 불필요한 WARN 로그를 막는다. auto는 탐색 목적상 기존과 같이 경고.
 */
export function shouldWarnMissingOpenaiKey(selectedProvider: LLMProvider): boolean {
  return selectedProvider === 'openai' || selectedProvider === 'auto';
}

export function shouldWarnMissingGeminiKey(selectedProvider: LLMProvider): boolean {
  return selectedProvider === 'gemini' || selectedProvider === 'auto';
}

export function resolveLlmModelLabel(
  provider: LLMClientInitializationResult['preferredProvider']
): string {
  if (provider === 'openai') return resolveLlmModel('openai');
  if (provider === 'gemini') return resolveLlmModel('gemini');
  if (provider === 'ollama') return resolveLlmModel('ollama');
  return 'none';
}

/**
 * 환경 변수 우선순위에 따라 provider 선택
 */
export function getSelectedProvider(): LLMProvider {
  const envProvider = getRawEnvValue('LLM_PROVIDER');
  return (envProvider as LLMProvider) || mementoConfig.llmProvider || 'auto';
}

/**
 * 에러 메시지 추출
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 경고 메시지 추가 및 로깅
 */
export function addWarning(
  result: LLMClientInitializationResult,
  warningMessage: string,
  logMessage: string,
  metadata: Record<string, unknown>
): void {
  result.warnings.push(warningMessage);
  logger.warn(logMessage, metadata);
}

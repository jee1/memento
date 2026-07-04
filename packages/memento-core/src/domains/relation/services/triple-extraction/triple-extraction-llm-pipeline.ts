/**
 * Triple 추출 LLM 단계: provider raw 호출, 파싱, 초기화 로깅.
 * TripleExtractionService에서 분리해 복잡도를 낮춘다.
 */

import type { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import type { LLMClientInitializationResult } from '../../../../shared/services/llm-client-initializer.js';
import type { Triple, TripleExtractionOptions, TripleExtractionResult } from '../../../../shared/types/triple-extraction.js';
import { logger } from '../../../../shared/utils/logger.js';
import {
  classifyTripleFailureReason,
} from './triple-extraction-errors.js';
import {
  extractRawWithGemini,
  extractRawWithOllama,
  extractRawWithOpenAI,
  type TripleLlmCallDeps,
} from './triple-extraction-llm-providers.js';
import { createTripleExtractionFailureResult } from './triple-extraction-result-helpers.js';
import type { TripleParser } from './triple-parser.js';

/** 테스트·런타임에서 동일 문구로 LLM 미가용 응답을 맞춘다. */
export const TRIPLE_EXTRACTION_LLM_UNAVAILABLE_MESSAGE =
  'LLM 서비스를 사용할 수 없습니다. OPENAI_API_KEY 또는 GEMINI_API_KEY를 설정하거나 LLM_PROVIDER를 변경해주세요.';

export function createTripleLlmUnavailableResponse(
  message: string = TRIPLE_EXTRACTION_LLM_UNAVAILABLE_MESSAGE
): { result: TripleExtractionResult; rawLLMOutput: string } {
  return {
    result: createTripleExtractionFailureResult('llm_unavailable', message),
    rawLLMOutput: message,
  };
}

export type TripleLlmActiveProvider = 'openai' | 'gemini' | 'ollama';

const TRIPLE_LLM_PROVIDER_ORDER: TripleLlmActiveProvider[] = ['openai', 'gemini', 'ollama'];

export function buildTripleLlmProviderAttemptOrder(
  primary: TripleLlmActiveProvider,
  isProviderReady: (provider: TripleLlmActiveProvider) => boolean
): TripleLlmActiveProvider[] {
  const fallbacks = TRIPLE_LLM_PROVIDER_ORDER.filter(
    (provider) => provider !== primary && isProviderReady(provider)
  );
  return isProviderReady(primary) ? [primary, ...fallbacks] : fallbacks;
}

export async function invokeTripleProviderWithFallback(params: {
  primaryProvider: TripleLlmActiveProvider;
  openaiClient: OpenAI | null;
  geminiClient: GoogleGenAI | null;
  isProviderReady: (provider: TripleLlmActiveProvider) => boolean;
  deps: TripleLlmCallDeps;
  prompt: string;
  options: TripleExtractionOptions;
}): Promise<{ rawOutput: string; provider: TripleLlmActiveProvider }> {
  const {
    primaryProvider,
    openaiClient,
    geminiClient,
    isProviderReady,
    deps,
    prompt,
    options,
  } = params;

  const attemptOrder = buildTripleLlmProviderAttemptOrder(primaryProvider, isProviderReady);
  if (attemptOrder.length === 0) {
    throw new Error('사용 가능한 LLM provider가 없습니다.');
  }

  let lastError: Error | undefined;
  let previousProvider: TripleLlmActiveProvider | undefined;
  for (const provider of attemptOrder) {
    if (previousProvider !== undefined) {
      logger.info('TripleExtractionService: LLM provider 폴백', {
        from: previousProvider,
        to: provider,
        reason: lastError?.message,
      });
    }

    try {
      const rawOutput = await invokeTripleProviderRawOutput({
        actualProvider: provider,
        openaiClient,
        geminiClient,
        deps,
        prompt,
        options,
      });
      return { rawOutput, provider };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      previousProvider = provider;
    }
  }

  throw lastError ?? new Error('LLM provider 호출에 실패했습니다.');
}

export async function invokeTripleProviderRawOutput(params: {
  actualProvider: TripleLlmActiveProvider;
  openaiClient: OpenAI | null;
  geminiClient: GoogleGenAI | null;
  deps: TripleLlmCallDeps;
  prompt: string;
  options: TripleExtractionOptions;
}): Promise<string> {
  const { actualProvider, openaiClient, geminiClient, deps, prompt, options } = params;
  switch (actualProvider) {
    case 'openai':
      if (!openaiClient) {
        throw new Error('OpenAI 클라이언트가 초기화되지 않았습니다.');
      }
      return extractRawWithOpenAI(openaiClient, deps, prompt, options);
    case 'gemini':
      if (!geminiClient) {
        throw new Error('Gemini 클라이언트가 초기화되지 않았습니다.');
      }
      return extractRawWithGemini(geminiClient, deps, prompt, options);
    case 'ollama':
      return extractRawWithOllama(deps, prompt, options);
    default: {
      const _exhaustive: never = actualProvider;
      throw new Error(`지원하지 않는 LLM Provider: ${_exhaustive}`);
    }
  }
}

export type TripleParsePipelineOutcome =
  | { ok: true; triples: Triple[]; rawLLMOutput: string }
  | { ok: false; result: TripleExtractionResult; rawLLMOutput: string };

export function resolveTripleParseOrFailure(
  parser: TripleParser,
  rawLLMOutput: string
): TripleParsePipelineOutcome {
  const parseResult = parser.parse(rawLLMOutput);
  if (parseResult.success) {
    const triples = parseResult.triples;
    if (triples.length === 0) {
      return {
        ok: false,
        result: createTripleExtractionFailureResult('no_triple', rawLLMOutput),
        rawLLMOutput,
      };
    }
    if (parseResult.errorType === 'structure') {
      logger.warn('TripleExtractionService: 일부 triple이 유효하지 않음', {
        validTriples: triples.length,
        error: parseResult.error,
      });
    }
    return { ok: true, triples, rawLLMOutput };
  }
  const failureReason = classifyTripleFailureReason(
    parseResult.error,
    rawLLMOutput,
    parseResult.errorType
  );
  return {
    ok: false,
    result: createTripleExtractionFailureResult(failureReason, rawLLMOutput),
    rawLLMOutput,
  };
}

export function logTripleExtractionClientInitResult(result: LLMClientInitializationResult): void {
  if (result.warnings.length > 0 && result.preferredProvider === null) {
    result.warnings.forEach((warning) => {
      logger.warn('LLM 초기화 경고', { warning });
    });
  }

  if (result.preferredProvider) {
    logger.info('TripleExtractionService: LLM 클라이언트 초기화 완료', {
      preferredProvider: result.preferredProvider,
      initializedProviders: result.initializedProviders,
    });
  } else {
    logger.error('TripleExtractionService: LLM 클라이언트 초기화 실패 - 모든 provider가 사용 불가능합니다');
  }
}

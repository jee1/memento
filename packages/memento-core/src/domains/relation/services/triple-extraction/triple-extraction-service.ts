/**
 * Triple 추출 서비스
 * LLM을 사용하여 Episodic Memory의 observation에서 (subject, predicate, object) 형태의 지식 그래프 트리플을 추출합니다.
 *
 * AriGraph 파이프라인의 핵심 컴포넌트로, Episodic Memory에서 Semantic Memory로의 자동 학습을 지원합니다.
 * RelationExtractor는 규칙/LLM 하이브리드 관계 후보를 담당; 본 서비스는 트리플 텍스트 추출·정규화·지속화 경로를 담당한다.
 *
 * 비용 최적화 전략:
 * - Rate limit (토큰 버킷 알고리즘)
 * - 캐싱 (TTL 기반)
 * - 비용 모니터링
 * - 에러 처리 및 폴백
 */

import type { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { tripleExtractionLogger } from '../../../../infrastructure/logging/triple-extraction-logger.js';
import type { IRetryManager } from '../../../../shared/interfaces/retry-manager.interface.js';
import { mementoConfig } from '../../../../shared/config/index.js';
import { getRetryOptions } from '../../../../shared/config/retry-options-loader.js';
import type { LLMClientInitializationResult } from '../../../../shared/services/llm-client-initializer.js';
import { LLMClientInitializer } from '../../../../shared/services/llm-client-initializer.js';
import type {
  ExtractionInfo,
  TripleExtractionOptions,
  TripleExtractionResult,
} from '../../../../shared/types/triple-extraction.js';
import { logger } from '../../../../shared/utils/logger.js';
import { TokenBucketRateLimiter } from '../../../../shared/utils/token-bucket-rate-limiter.js';
import { determineLlmProvider } from '../llm-provider-selection.js';
import { PromptTemplateLoader } from '../../../../shared/utils/prompt-template-loader.js';
import { TripleCacheService } from '../../../../shared/utils/triple-cache.js';
import { EntityLinker } from './entity-linker.js';
import { PredicateCanonicalizer } from './predicate-canonicalizer.js';
import {
  classifyTripleExtractionErrorType,
  shouldRetryTripleLlmError,
} from './triple-extraction-errors.js';
import type { TripleLlmCallDeps } from './triple-extraction-llm-providers.js';
import {
  createTripleLlmUnavailableResponse,
  invokeTripleProviderWithFallback,
  logTripleExtractionClientInitResult,
  resolveTripleParseOrFailure,
  TRIPLE_EXTRACTION_LLM_UNAVAILABLE_MESSAGE,
  type TripleLlmActiveProvider,
} from './triple-extraction-llm-pipeline.js';
import {
  createTripleExtractionFailureResult,
  normalizeTripleExtractionResult,
  trackTripleExtractionSteps,
} from './triple-extraction-result-helpers.js';
import { TripleExtractionStatisticsService } from './triple-extraction-statistics.js';
import { TripleNormalizer } from './triple-normalizer.js';
import { TripleParser } from './triple-parser.js';
import { RelationRetryManager } from '../relation-retry-manager.js';

/**
 * LLM 비용 모니터링
 */
interface LLMCostMetrics {
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
  lastReset: number;
}

/**
 * Triple 추출 서비스
 */
export class TripleExtractionService {
  private openaiClient: OpenAI | null = null;
  private geminiClient: GoogleGenAI | null = null;
  private preferredProvider: 'openai' | 'gemini' | 'ollama' | null = null;
  private initializedProviders: ('openai' | 'gemini' | 'ollama')[] = [];
  private readonly cache: TripleCacheService;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly costMetrics: LLMCostMetrics;
  private readonly canonicalizer: PredicateCanonicalizer;
  private readonly entityLinker: EntityLinker;
  private readonly parser: TripleParser;
  private readonly normalizer: TripleNormalizer;
  private readonly statistics: TripleExtractionStatisticsService;
  private readonly retryManager: IRetryManager;
  private initializationPromise: Promise<void> | null = null;

  private readonly DEFAULT_TEMPERATURE = 0.3;
  private readonly DEFAULT_MAX_TOKENS = 2000;
  private readonly CACHE_SIZE = 100;
  private readonly CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  private readonly RATE_LIMITER_CAPACITY = 1;
  private readonly RATE_LIMITER_REFILL_RATE = 1;

  private readonly SUCCESS_SAMPLING_RATE = 0.1;

  constructor(retryManager?: IRetryManager) {
    this.cache = new TripleCacheService(this.CACHE_SIZE, this.CACHE_TTL_MS);
    this.rateLimiter = new TokenBucketRateLimiter(
      this.RATE_LIMITER_CAPACITY,
      this.RATE_LIMITER_REFILL_RATE
    );
    this.costMetrics = {
      totalCalls: 0,
      totalTokens: 0,
      totalCost: 0,
      lastReset: Date.now(),
    };
    this.canonicalizer = new PredicateCanonicalizer();
    this.entityLinker = new EntityLinker();
    this.parser = new TripleParser();
    this.normalizer = new TripleNormalizer(this.canonicalizer, this.entityLinker);
    this.statistics = new TripleExtractionStatisticsService();
    const retryOptions = getRetryOptions();
    this.retryManager = retryManager ?? new RelationRetryManager({
      maxAttempts: retryOptions.external_api.maxAttempts,
      baseDelay: retryOptions.external_api.baseDelay,
    });

    this.initializationPromise = this.initializeClients();
  }

  private getLlmCallDeps(): TripleLlmCallDeps {
    return {
      retryManager: this.retryManager,
      shouldRetry: shouldRetryTripleLlmError,
      onTokenUsage: (provider, promptTokens, completionTokens) =>
        this.updateCostMetrics(provider, promptTokens, completionTokens),
      defaultTemperature: this.DEFAULT_TEMPERATURE,
      defaultMaxTokens: this.DEFAULT_MAX_TOKENS,
    };
  }

  private async initializeClients(): Promise<void> {
    try {
      const initializer = new LLMClientInitializer();
      const result: LLMClientInitializationResult = await initializer.initialize();

      this.openaiClient = result.openaiClient;
      this.geminiClient = result.geminiClient;
      this.preferredProvider = result.preferredProvider;
      this.initializedProviders = result.initializedProviders;

      logTripleExtractionClientInitResult(result);
    } catch (error) {
      logger.error('TripleExtractionService: LLM 클라이언트 초기화 실패', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.openaiClient = null;
      this.geminiClient = null;
      this.preferredProvider = null;
      this.initializedProviders = [];
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initializationPromise) {
      try {
        await this.initializationPromise;
      } catch (error) {
        logger.error('TripleExtractionService: 초기화 대기 실패', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.initializationPromise = null;
      }
    }
  }

  private determineProvider(
    requestedProvider: 'openai' | 'gemini' | 'ollama' | 'auto'
  ): 'openai' | 'gemini' | 'ollama' | null {
    return determineLlmProvider(
      requestedProvider,
      {
        openai: this.openaiClient !== null,
        gemini: this.geminiClient !== null,
        ollama: this.initializedProviders.includes('ollama'),
      },
      { includeOllamaInAuto: false, includeOllamaInFallback: false },
    );
  }

  isAvailable(): boolean {
    return this.preferredProvider !== null;
  }

  private enqueueExtractionLog(
    result: TripleExtractionResult,
    memoryId: string | undefined,
    observation: string,
    rawLLMOutput: string
  ): void {
    this.logExtractionResult(result, memoryId, observation, rawLLMOutput).catch((err) => {
      logger.error('TripleExtractionService: 로깅 실패', { error: err });
    });
  }

  async extractTriples(
    observation: string,
    options: TripleExtractionOptions = {},
    memoryId?: string
  ): Promise<TripleExtractionResult> {
    await this.ensureInitialized();

    const normalizedObservation = observation?.trim() ?? '';

    if (!normalizedObservation) {
      const result = createTripleExtractionFailureResult('no_triple', 'Observation이 비어있습니다.');
      const normalizedResult = this.normalizeExtractionResult(result);
      this.enqueueExtractionLog(
        normalizedResult,
        memoryId,
        normalizedObservation,
        'Observation이 비어있습니다.'
      );
      return normalizedResult;
    }

    const extractionStartTime = Date.now();
    const cached = this.cache.get(normalizedObservation);
    if (cached) {
      const normalizedCached = this.normalizeExtractionResult(cached);
      logger.debug('TripleExtractionService: 캐시 히트', {
        contentLength: normalizedObservation.length,
        tripleCount: normalizedCached.triples.length,
      });

      const extractionTime = Date.now() - extractionStartTime;
      this.statistics.recordExtraction(normalizedCached, extractionTime, true, 0, 0, 0);

      return normalizedCached;
    }

    if (mementoConfig.nodeEnv === 'test' && process.env.MEMENTO_ALLOW_LLM_IN_TESTS !== 'true') {
      const errorMessage = TRIPLE_EXTRACTION_LLM_UNAVAILABLE_MESSAGE;
      const result = createTripleExtractionFailureResult('llm_unavailable', errorMessage);
      const normalizedResult = this.normalizeExtractionResult(result);
      this.enqueueExtractionLog(normalizedResult, memoryId, normalizedObservation, errorMessage);
      return normalizedResult;
    }

    try {
      const provider = options.provider || this.preferredProvider || 'auto';
      const { result, rawLLMOutput } = await this.extractWithLLM(
        normalizedObservation,
        provider,
        options
      );

      const normalizedResult = this.normalizeExtractionResult(result);

      this.cache.set(normalizedObservation, normalizedResult);

      const extractionTime = Date.now() - extractionStartTime;
      const costMetrics = this.getCostMetrics();
      const llmCalls = 1;
      const tokens = costMetrics.totalTokens;
      const cost = costMetrics.totalCost;
      this.statistics.recordExtraction(normalizedResult, extractionTime, false, llmCalls, tokens, cost);

      this.enqueueExtractionLog(normalizedResult, memoryId, normalizedObservation, rawLLMOutput);

      return normalizedResult;
    } catch (error) {
      const errorType = classifyTripleExtractionErrorType(error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error('TripleExtractionService: Triple 추출 실패', {
        error: errorMessage,
        errorType,
        observation: normalizedObservation.substring(0, 100),
        retryable: errorType === 'network' || errorType === 'rate_limit' || errorType === 'timeout',
        immediateFailure: errorType === 'api_key',
      });

      const failureReason = 'llm_api_error';
      const result = createTripleExtractionFailureResult(failureReason, errorMessage);
      const normalizedResult = this.normalizeExtractionResult(result);

      this.enqueueExtractionLog(normalizedResult, memoryId, normalizedObservation, errorMessage);

      return normalizedResult;
    }
  }

  private isProviderReady(provider: TripleLlmActiveProvider): boolean {
    switch (provider) {
      case 'openai':
        return this.openaiClient !== null;
      case 'gemini':
        return this.geminiClient !== null;
      case 'ollama':
        return this.initializedProviders.includes('ollama');
      default: {
        const _exhaustive: never = provider;
        return _exhaustive;
      }
    }
  }

  private async extractWithLLM(
    observation: string,
    provider: 'openai' | 'gemini' | 'ollama' | 'auto',
    options: TripleExtractionOptions
  ): Promise<{ result: TripleExtractionResult; rawLLMOutput: string }> {
    const actualProvider = this.determineProvider(provider);

    if (actualProvider === null) {
      logger.error('TripleExtractionService: LLM 서비스 사용 불가능', {
        requestedProvider: provider,
        preferredProvider: this.preferredProvider,
        openaiAvailable: this.openaiClient !== null,
        geminiAvailable: this.geminiClient !== null,
      });

      return createTripleLlmUnavailableResponse();
    }

    await this.rateLimiter.consume();

    const prompt = PromptTemplateLoader.loadAndRender('triple-extraction', {
      observation,
    });

    const deps = this.getLlmCallDeps();

    let rawLLMOutput: string;
    try {
      const invocation = await invokeTripleProviderWithFallback({
        primaryProvider: actualProvider,
        openaiClient: this.openaiClient,
        geminiClient: this.geminiClient,
        isProviderReady: (provider) => this.isProviderReady(provider),
        deps,
        prompt,
        options,
      });
      rawLLMOutput = invocation.rawOutput;
    } catch (error) {
      const errorType = classifyTripleExtractionErrorType(error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('TripleExtractionService: LLM 호출 실패', {
        error: errorMessage,
        errorType,
        provider: actualProvider,
        retryable:
          errorType === 'network' || errorType === 'rate_limit' || errorType === 'timeout',
      });

      throw error;
    }

    const parsed = resolveTripleParseOrFailure(this.parser, rawLLMOutput);
    if (parsed.ok === false) {
      return { result: parsed.result, rawLLMOutput: parsed.rawLLMOutput };
    }
    const triples = parsed.triples;

    const normalizedTriples = this.normalizer.normalize(triples);

    const steps = trackTripleExtractionSteps(
      normalizedTriples,
      this.canonicalizer,
      this.entityLinker
    );

    const extractionInfo: ExtractionInfo = {
      steps,
    };

    return {
      result: {
        triples: normalizedTriples,
        extractionInfo,
      },
      rawLLMOutput,
    };
  }

  private updateCostMetrics(
    provider: 'openai' | 'gemini' | 'ollama',
    promptTokens: number,
    completionTokens: number
  ): void {
    this.costMetrics.totalCalls += 1;
    this.costMetrics.totalTokens += promptTokens + completionTokens;

    let cost = 0;
    if (provider === 'openai') {
      cost = (promptTokens / 1_000_000) * 0.15 + (completionTokens / 1_000_000) * 0.6;
    } else if (provider === 'gemini') {
      cost = (promptTokens / 1_000_000) * 0.075 + (completionTokens / 1_000_000) * 0.3;
    }

    this.costMetrics.totalCost += cost;
  }

  private async logExtractionResult(
    result: TripleExtractionResult,
    memoryId: string | undefined,
    observation: string | undefined,
    rawLLMOutput: string
  ): Promise<void> {
    const isSuccess = result.triples.length > 0;
    const isFailure = !isSuccess || result.extractionInfo.failureReason !== undefined;

    let shouldLog = false;

    if (isFailure) {
      shouldLog = true;
    } else if (isSuccess) {
      shouldLog = Math.random() < this.SUCCESS_SAMPLING_RATE;
    }

    if (!shouldLog) {
      return;
    }

    const resultWithRawOutput: TripleExtractionResult = {
      ...result,
      extractionInfo: {
        ...result.extractionInfo,
        rawLLMOutput,
      },
    };

    await tripleExtractionLogger.logExtraction(resultWithRawOutput, memoryId, observation);
  }

  private normalizeExtractionResult(result: TripleExtractionResult): TripleExtractionResult {
    return normalizeTripleExtractionResult(result, (triples) =>
      trackTripleExtractionSteps(triples, this.canonicalizer, this.entityLinker)
    );
  }

  getCostMetrics(): LLMCostMetrics {
    return { ...this.costMetrics };
  }

  getStatistics() {
    return this.statistics.getStatistics();
  }

  getFailureReasonStatistics() {
    return this.statistics.getFailureReasonStatistics();
  }
}

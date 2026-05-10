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

import type { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { tripleExtractionLogger } from '../../../../infrastructure/logging/triple-extraction-logger.js';
import type { IRetryManager } from '../../../../shared/interfaces/retry-manager.interface.js';
import { mementoConfig } from '../../../../shared/config/index.js';
import { getRetryOptions } from '../../../../shared/config/retry-options-loader.js';
import type { LLMClientInitializationResult } from '../../../../shared/services/llm-client-initializer.js';
import { LLMClientInitializer } from '../../../../shared/services/llm-client-initializer.js';
import type {
  ExtractionInfo,
  Triple,
  TripleExtractionOptions,
  TripleExtractionResult,
} from '../../../../shared/types/triple-extraction.js';
import { logger } from '../../../../shared/utils/logger.js';
import { PromptTemplateLoader } from '../../../../shared/utils/prompt-template-loader.js';
import { TripleCacheService } from '../../../../shared/utils/triple-cache.js';
import { EntityLinker } from './entity-linker.js';
import { PredicateCanonicalizer } from './predicate-canonicalizer.js';
import {
  classifyTripleExtractionErrorType,
  classifyTripleFailureReason,
  shouldRetryTripleLlmError,
} from './triple-extraction-errors.js';
import {
  extractRawWithGemini,
  extractRawWithOllama,
  extractRawWithOpenAI,
  type TripleLlmCallDeps,
} from './triple-extraction-llm-providers.js';
import { TokenBucketRateLimiter } from './triple-extraction-rate-limiter.js';
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
  private geminiClient: GoogleGenerativeAI | null = null;
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
    if (requestedProvider === 'auto') {
      if (this.openaiClient) return 'openai';
      if (this.geminiClient) return 'gemini';
      return null;
    }

    if (requestedProvider === 'openai' && this.openaiClient) {
      return 'openai';
    }
    if (requestedProvider === 'gemini' && this.geminiClient) {
      return 'gemini';
    }
    if (requestedProvider === 'ollama') {
      if (this.initializedProviders.includes('ollama')) {
        return 'ollama';
      }
    }

    if (requestedProvider === 'openai') {
      if (this.geminiClient) return 'gemini';
    } else if (requestedProvider === 'gemini') {
      if (this.openaiClient) return 'openai';
    } else if (requestedProvider === 'ollama') {
      if (this.openaiClient) return 'openai';
      if (this.geminiClient) return 'gemini';
    }

    return null;
  }

  isAvailable(): boolean {
    return this.preferredProvider !== null;
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
      this.logExtractionResult(
        normalizedResult,
        memoryId,
        normalizedObservation,
        'Observation이 비어있습니다.'
      ).catch((err) => {
        logger.error('TripleExtractionService: 로깅 실패', { error: err });
      });
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
      const errorMessage =
        'LLM 서비스를 사용할 수 없습니다. OPENAI_API_KEY 또는 GEMINI_API_KEY를 설정하거나 LLM_PROVIDER를 변경해주세요.';
      const result = createTripleExtractionFailureResult('llm_unavailable', errorMessage);
      const normalizedResult = this.normalizeExtractionResult(result);
      this.logExtractionResult(normalizedResult, memoryId, normalizedObservation, errorMessage).catch(
        (err) => {
          logger.error('TripleExtractionService: 로깅 실패', { error: err });
        }
      );
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

      this.logExtractionResult(normalizedResult, memoryId, normalizedObservation, rawLLMOutput).catch(
        (err) => {
          logger.error('TripleExtractionService: 로깅 실패', { error: err });
        }
      );

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

      this.logExtractionResult(normalizedResult, memoryId, normalizedObservation, errorMessage).catch(
        (err) => {
          logger.error('TripleExtractionService: 로깅 실패', { error: err });
        }
      );

      return normalizedResult;
    }
  }

  private async extractWithLLM(
    observation: string,
    provider: 'openai' | 'gemini' | 'ollama' | 'auto',
    options: TripleExtractionOptions
  ): Promise<{ result: TripleExtractionResult; rawLLMOutput: string }> {
    const actualProvider = this.determineProvider(provider);

    if (actualProvider === null) {
      const errorMessage =
        'LLM 서비스를 사용할 수 없습니다. OPENAI_API_KEY 또는 GEMINI_API_KEY를 설정하거나 LLM_PROVIDER를 변경해주세요.';

      logger.error('TripleExtractionService: LLM 서비스 사용 불가능', {
        requestedProvider: provider,
        preferredProvider: this.preferredProvider,
        openaiAvailable: this.openaiClient !== null,
        geminiAvailable: this.geminiClient !== null,
      });

      return {
        result: createTripleExtractionFailureResult('llm_unavailable', errorMessage),
        rawLLMOutput: errorMessage,
      };
    }

    await this.rateLimiter.consume();

    const prompt = PromptTemplateLoader.loadAndRender('triple-extraction', {
      observation,
    });

    let rawLLMOutput: string;
    let triples: Triple[] = [];

    const deps = this.getLlmCallDeps();

    try {
      switch (actualProvider) {
        case 'openai':
          if (!this.openaiClient) {
            throw new Error('OpenAI 클라이언트가 초기화되지 않았습니다.');
          }
          rawLLMOutput = await extractRawWithOpenAI(this.openaiClient, deps, prompt, options);
          break;
        case 'gemini':
          if (!this.geminiClient) {
            throw new Error('Gemini 클라이언트가 초기화되지 않았습니다.');
          }
          rawLLMOutput = await extractRawWithGemini(this.geminiClient, deps, prompt, options);
          break;
        case 'ollama':
          rawLLMOutput = await extractRawWithOllama(deps, prompt, options);
          break;
        default:
          throw new Error(`지원하지 않는 LLM Provider: ${actualProvider}`);
      }

      const parseResult = this.parser.parse(rawLLMOutput);
      if (parseResult.success) {
        triples = parseResult.triples;

        if (triples.length === 0) {
          return {
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
      } else {
        const failureReason = classifyTripleFailureReason(
          parseResult.error,
          rawLLMOutput,
          parseResult.errorType
        );
        return {
          result: createTripleExtractionFailureResult(failureReason, rawLLMOutput),
          rawLLMOutput,
        };
      }
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

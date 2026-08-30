/**
 * LLM 기반 관계 추출기
 * LLM을 사용하여 기억 간의 관계를 추출합니다.
 * 규칙 기반이 실패하거나 신뢰도가 낮은 경우 사용됩니다.
 * 
 * 비용 최적화 전략:
 * - Embedding 기반 후보 제한 (cosine similarity 상위 N개)
 * - Rate limit (토큰 버킷 알고리즘, 초당 1회)
 * - 프롬프트 압축 (최대 500 토큰)
 * - 캐싱 (7일 TTL)
 * - 배치 처리 (최대 10개)
 * - 비용 모니터링
 */

import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import type { ICacheService } from '../../../shared/interfaces/cache.interface.js';
import type { IRetryManager } from '../../../shared/interfaces/retry-manager.interface.js';
import { mementoConfig } from '../../../shared/config/index.js';
import { resolveLlmProvider } from '../../../shared/config/llm-model-resolver.js';
import { getRetryOptions } from '../../../shared/config/retry-options-loader.js';
import { CACHE, CONFIDENCE, LIMITS, LLM_COST, RATE_LIMITER } from '../../../shared/constants/relation-constants.js';
import { LLMClientInitializer } from '../../../shared/services/llm-client-initializer.js';
import type { MemoryItem } from '../../../shared/types/memory.types.js';
import type {
ExtractOptions,
IRelationExtractor,
RelationCandidate,
RelationType
} from '../../../shared/types/relation.js';
import { isApplicableRelationType, MEMORY_TYPE_RELATION_MAP } from '../../../shared/types/relation.js';
import { CacheKeyGenerator } from '../../../shared/utils/cache-key-generator.js';
import { logger } from '../../../shared/utils/logger.js';
import { TokenBucketRateLimiter } from '../../../shared/utils/token-bucket-rate-limiter.js';
import { determineLlmProvider } from './llm-provider-selection.js';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import { RelationCache } from './relation-cache.js';
import { RelationRetryManager } from './relation-retry-manager.js';

import { filterRelationCandidatesByEmbedding } from './llm-relation-extractor/embedding-candidate-filter.js';
import { parseLlmRelationsResponse } from './llm-relation-extractor/llm-response-parse.js';
import {
  extractRelationsWithOpenAI,
  type OpenAiRelationExtractDeps
} from './llm-relation-extractor/extract-relations-openai.js';
import {
  extractRelationsWithGemini,
  type GeminiRelationExtractDeps
} from './llm-relation-extractor/extract-relations-gemini.js';
import {
  extractRelationsWithOllama,
  type OllamaRelationExtractDeps
} from './llm-relation-extractor/extract-relations-ollama.js';
import type { ParseResult } from './llm-relation-extractor/types.js';
export type { ParseResult } from './llm-relation-extractor/types.js';

/**
 * LLM 비용 모니터링
 */
interface LLMCostMetrics {
  totalCalls: number;
  totalTokens: number;
  totalCost: number; // USD
  lastReset: number;
}

/**
 * LLM 기반 관계 추출기
 */
export class LLMBasedRelationExtractor implements IRelationExtractor {
  private openaiClient: OpenAI | null = null;
  private geminiClient: GoogleGenAI | null = null;
  private preferredProvider: 'openai' | 'gemini' | 'ollama' | null = null;
  private initializedProviders: ('openai' | 'gemini' | 'ollama')[] = [];
  private readonly initializationPromise: Promise<void>;
  private readonly embeddingService: UnifiedEmbeddingService;
  private readonly cache: ICacheService<RelationCandidate[]>; // 7일 TTL
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly costMetrics: LLMCostMetrics;
  private readonly retryManager: IRetryManager;

  constructor(
    embeddingService?: UnifiedEmbeddingService,
    cache?: ICacheService<RelationCandidate[]>,
    retryManager?: IRetryManager,
  ) {
    // 초기화 지연: preferredProvider는 null로 시작하고, initializationPromise를 통해 비동기 초기화
    this.preferredProvider = null;
    this.embeddingService = embeddingService || new UnifiedEmbeddingService();
    this.cache = cache ?? new RelationCache<RelationCandidate[]>(CACHE.EXTRACTION_SIZE, CACHE.EXTRACTION_TTL_MS);
    this.rateLimiter = new TokenBucketRateLimiter(RATE_LIMITER.CAPACITY, RATE_LIMITER.REFILL_RATE);
    this.costMetrics = {
      totalCalls: 0,
      totalTokens: 0,
      totalCost: 0,
      lastReset: Date.now()
    };
    
    // RetryManager 초기화 (external_api 설정 사용)
    const retryOptions = getRetryOptions();
    this.retryManager = retryManager ?? new RelationRetryManager({
      maxAttempts: retryOptions.external_api.maxAttempts,
      baseDelay: retryOptions.external_api.baseDelay,
    });
    
    // 비동기 초기화: initializeClients()를 호출하고 결과를 설정
    this.initializationPromise = this.initializeClients().then((provider) => {
      this.preferredProvider = provider;
    }).catch((error) => {
      // reason 은 폴백 사유를 한 필드명으로 grep 하기 위한 것이다.
      // error.message 외의 값은 넣지 않는다 — 자격 증명이 로그에 새면 안 된다.
      logger.error('LLM 클라이언트 초기화 실패', {
        error: error instanceof Error ? error.message : String(error),
        reason: 'init_failed'
      });
      this.preferredProvider = null;
      this.openaiClient = null;
      this.geminiClient = null;
      this.initializedProviders = [];
    });
  }

  /**
   * LLM 클라이언트 초기화
   * LLMClientInitializer를 사용하여 클라이언트 초기화
   * 환경 변수 LLM_PROVIDER에 따라 프로바이더 선택
   * - 'openai': OpenAI 우선 시도, 실패 시 Gemini/Ollama fallback
   * - 'gemini': Gemini 우선 시도, 실패 시 OpenAI/Ollama fallback
   * - 'ollama': Ollama 우선 시도, 실패 시 OpenAI/Gemini fallback
   * - 'auto': 사용 가능한 것 자동 선택 (OpenAI -> Gemini -> Ollama 순서)
   */
  private async initializeClients(): Promise<'openai' | 'gemini' | 'ollama' | null> {
    const initializer = new LLMClientInitializer();
    const result = await initializer.initialize();
    
    // LLMClientInitializer 결과를 사용하여 클라이언트 설정
    this.openaiClient = result.openaiClient;
    this.geminiClient = result.geminiClient;
    this.initializedProviders = result.initializedProviders ?? [];
    
    // 경고 메시지 로깅
    if (result.warnings.length > 0 && result.preferredProvider === null) {
      result.warnings.forEach((warning) => {
        logger.warn('LLM 초기화 경고', { warning });
      });
    }
    
    return result.preferredProvider;
  }

  /**
   * LLM 서비스 사용 가능 여부 확인 (동기)
   *
   * **초기화 완료 이후에만 유효하다.** 생성 직후에는 preferredProvider 가
   * 아직 정해지지 않아 항상 false 를 반환한다 (이슈 #819).
   * 외부 호출자는 `isAvailableAsync()` 를 사용한다.
   */
  isAvailable(): boolean {
    if (this.preferredProvider === 'openai') {
      return this.openaiClient !== null;
    }
    if (this.preferredProvider === 'gemini') {
      return this.geminiClient !== null;
    }
    if (this.preferredProvider === 'ollama' || this.isOllamaAvailable()) {
      return true;
    }

    return false;
  }

  /**
   * LLM 서비스 사용 가능 여부 확인 (초기화 완료 보장)
   *
   * 생성자에서 시작된 비동기 초기화가 끝난 뒤에 판정한다. 초기화 실패는
   * 생성자의 catch 가 이미 흡수하므로 여기서 예외가 새어 나가지 않는다.
   *
   * 외부 호출자는 이 판정을 사용한다. 동기 `isAvailable()` 은 초기화 완료
   * 이후에만 유효하다 (이슈 #819).
   */
  async isAvailableAsync(): Promise<boolean> {
    await this.initializationPromise;
    return this.isAvailable();
  }

  /**
   * Job-scoped Ollama readiness (FR-005): global preferred 가 cloud 여도
   * initializedProviders 에 ollama 가 있으면 per-job override 경로에서 사용 가능.
   */
  private isOllamaAvailable(): boolean {
    return this.initializedProviders.includes('ollama');
  }

  private providerAvailability() {
    return {
      openai: this.openaiClient !== null,
      gemini: this.geminiClient !== null,
      ollama: this.isOllamaAvailable(),
    };
  }


  private determineProvider(
    requestedProvider: 'openai' | 'gemini' | 'ollama' | 'auto'
  ): 'openai' | 'gemini' | 'ollama' | null {
    return determineLlmProvider(requestedProvider, this.providerAvailability());
  }

  private async filterCandidatesByEmbedding(
    newMemory: MemoryItem,
    existingMemories: MemoryItem[],
    limit: number = LIMITS.LLM_CANDIDATE_DEFAULT
  ): Promise<MemoryItem[]> {
    return filterRelationCandidatesByEmbedding(
      this.embeddingService,
      newMemory,
      existingMemories,
      limit
    );
  }

  private openAiDeps(): OpenAiRelationExtractDeps {
    return {
      rateLimiter: this.rateLimiter,
      retryManager: this.retryManager,
      calculateAndLogCost: (provider, promptTokens, completionTokens) =>
        this.calculateAndLogCost(provider, promptTokens, completionTokens),
      parseLlmRelationsResponse,
      initPreferredProvider: this.preferredProvider,
    };
  }

  private geminiDeps(): GeminiRelationExtractDeps {
    return {
      rateLimiter: this.rateLimiter,
      retryManager: this.retryManager,
      calculateAndLogCost: (provider, promptTokens, completionTokens) =>
        this.calculateAndLogCost(provider, promptTokens, completionTokens),
      parseLlmRelationsResponse,
      initPreferredProvider: this.preferredProvider,
    };
  }

  private ollamaDeps(): OllamaRelationExtractDeps {
    return {
      rateLimiter: this.rateLimiter,
      retryManager: this.retryManager,
      calculateAndLogCost: (provider, promptTokens, completionTokens) =>
        this.calculateAndLogCost(provider, promptTokens, completionTokens),
      parseLlmRelationsResponse,
      initPreferredProvider: this.preferredProvider,
    };
  }

  private async extractWithOpenAI(prompt: string): Promise<ParseResult> {
    return extractRelationsWithOpenAI(this.openaiClient!, prompt, this.openAiDeps());
  }

  private async extractWithGemini(prompt: string): Promise<ParseResult> {
    return extractRelationsWithGemini(this.geminiClient!, prompt, this.geminiDeps());
  }

  private async extractWithOllama(prompt: string): Promise<ParseResult> {
    return extractRelationsWithOllama(prompt, this.ollamaDeps());
  }

  /**
   * 관계 추출 프롬프트 템플릿 생성
   */
  private buildPrompt(
    newMemory: MemoryItem,
    existingMemories: MemoryItem[],
    applicableTypes: RelationType[]
  ): string {
    const relationTypesList = applicableTypes.join(', ');
    const memoryList = existingMemories
      .map((mem, idx) => `[${idx + 1}] ID: ${mem.id}\n   내용: ${mem.content}`)
      .join('\n\n');

    return `다음은 새로운 기억과 기존 기억 목록입니다. 새로운 기억과 기존 기억들 간의 의미적 관계를 분석해주세요.

새로운 기억:
ID: ${newMemory.id}
타입: ${newMemory.type}
내용: ${newMemory.content}

기존 기억 목록:
${memoryList}

관계 유형: ${relationTypesList}

각 기존 기억에 대해 새로운 기억과의 관계가 있다면, 다음 JSON 형식으로 반환해주세요:
{
  "relations": [
    {
      "target_id": "기억_ID",
      "relation_type": "CAUSES | DEPENDS_ON | FOLLOWS | CONTRASTS_WITH | REFERENCES | BELONGS_TO",
      "confidence": 0.0~1.0,
      "reasoning": "관계 추론 근거 (선택적)"
    }
  ]
}

관계가 없는 경우 빈 배열을 반환하세요. JSON 형식만 반환하고 다른 설명은 포함하지 마세요.`;
  }

  /**
   * 기존 기억 목록을 요약하여 프롬프트 크기 축소
   * 간단한 요약: 내용을 최대 길이로 제한
   */
  private compressMemories(memories: MemoryItem[], maxTokens: number = LIMITS.MAX_PROMPT_TOKENS): MemoryItem[] {
    const avgTokensPerMemory = 50; // 대략적인 토큰 수
    const maxMemories = Math.floor(maxTokens / avgTokensPerMemory);
    const limited = memories.slice(0, maxMemories);

    // 각 기억의 내용을 요약 (간단한 버전: 최대 200자로 제한)
    return limited.map(memory => ({
      ...memory,
      content: memory.content.length > 200 
        ? memory.content.substring(0, 200) + '...'
        : memory.content
    }));
  }

  /**
   * 캐시 키 생성
   * 공통 유틸리티를 사용하여 일관된 캐시 키를 생성합니다.
   */
  private generateCacheKey(newMemoryId: string, existingMemoryIds: string[]): string {
    return CacheKeyGenerator.generateLLMRelationExtractionKey(newMemoryId, existingMemoryIds);
  }

  /**
   * 비용 계산 및 모니터링
   * 비용 계산과 모니터링 로그를 통합하여 중복을 제거합니다.
   * 
   * @param provider LLM 제공자
   * @param promptTokens 프롬프트 토큰 수
   * @param completionTokens 완료 토큰 수
   * @returns 계산된 비용 (USD)
   */
  private calculateAndLogCost(
    provider: 'openai' | 'gemini' | 'ollama',
    promptTokens: number,
    completionTokens: number
  ): number {
    // Given: 토큰 수와 제공자 정보
    // When: 비용 계산
    let cost = 0;

    if (provider === 'openai') {
      // OpenAI 가격 (gpt-4o-mini 기준, 2025년 1월)
      const inputCost = (promptTokens / 1000) * LLM_COST.OPENAI_INPUT;
      const outputCost = (completionTokens / 1000) * LLM_COST.OPENAI_OUTPUT;
      cost = inputCost + outputCost;
    } else if (provider === 'gemini') {
      // Gemini 가격 (gemini-1.5-flash 기준)
      const inputCost = (promptTokens / 1000) * LLM_COST.GEMINI_INPUT;
      const outputCost = (completionTokens / 1000) * LLM_COST.GEMINI_OUTPUT;
      cost = inputCost + outputCost;
    } else if (provider === 'ollama') {
      // Ollama는 로컬 실행이므로 비용 0
      cost = 0;
    }

    // Then: 비용 메트릭 업데이트 및 로깅
    this.costMetrics.totalCalls++;
    this.costMetrics.totalTokens += promptTokens + completionTokens;
    this.costMetrics.totalCost += cost;

    // 주기적으로 로그 출력
    if (this.costMetrics.totalCalls % LIMITS.COST_LOG_INTERVAL === 0) {
      logger.info('LLM 비용 통계', {
        totalCalls: this.costMetrics.totalCalls,
        totalTokens: this.costMetrics.totalTokens,
        totalCost: this.costMetrics.totalCost.toFixed(4),
        provider
      });
    }

    return cost;
  }

  async extractRelations(
    newMemory: MemoryItem,
    existingMemories: MemoryItem[],
    options?: ExtractOptions
  ): Promise<RelationCandidate[]> {
    // 초기화 완료를 먼저 기다린 뒤에 가용성을 판정한다. 이전 코드는 await 앞에서
    // 던져, 초기화가 진행 중인 신규 인스턴스가 await 에 도달하지 못했다 (이슈 #819).
    // 진짜 미가용은 아래의 hasAvailableClient 검사가 처리한다.
    await this.initializationPromise;

    if (existingMemories.length === 0) {
      return [];
    }

    const hasAvailableClient =
      this.openaiClient !== null ||
      this.geminiClient !== null ||
      this.isOllamaAvailable();

    if (!hasAvailableClient) {
      throw new Error(
        'LLM 서비스를 사용할 수 없습니다. OPENAI_API_KEY 또는 GEMINI_API_KEY를 설정하거나 LLM_PROVIDER를 변경해주세요.'
      );
    }

    // 캐시 확인
    const existingMemoryIds = existingMemories.map(m => m.id);
    const cacheKey = this.generateCacheKey(newMemory.id, existingMemoryIds);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.debug('LLM 관계 추출 캐시 히트', { cacheKey });
      return cached;
    }

    // 적용 가능한 관계 유형 필터링
    const allowedTypes = options?.relationTypes;
    const memoryType = newMemory.type;
    const applicableTypes = allowedTypes
      ? allowedTypes.filter(type => isApplicableRelationType(memoryType, type))
      : MEMORY_TYPE_RELATION_MAP[memoryType];

    if (applicableTypes.length === 0) {
      return [];
    }

    // Embedding 기반 후보 제한 (cosine similarity 상위 N개)
    const candidateLimit = options?.candidateLimit ?? LIMITS.LLM_CANDIDATE_DEFAULT;
    const filteredMemories = await this.filterCandidatesByEmbedding(
      newMemory,
      existingMemories,
      candidateLimit
    );

    // 프롬프트 압축
    const compressedMemories = this.compressMemories(filteredMemories, LIMITS.MAX_PROMPT_TOKENS);

    // 프롬프트 생성
    const prompt = this.buildPrompt(newMemory, compressedMemories, applicableTypes);

    // Provider 결정 (fallback 로직 포함)
    // preferredProvider가 null이거나 클라이언트가 초기화되지 않았을 때 
    // 다른 사용 가능한 provider로 자동 전환
    const requestedProvider = resolveLlmProvider('relation_extraction');
    const actualProvider = this.determineProvider(
      requestedProvider as 'openai' | 'gemini' | 'ollama' | 'auto'
    );
    
    // actualProvider가 null인 경우 llm_unavailable 에러 반환
    if (actualProvider === null) {
      const errorMessage = 
        'LLM 서비스를 사용할 수 없습니다. OPENAI_API_KEY 또는 GEMINI_API_KEY를 설정하거나 LLM_PROVIDER를 변경해주세요.';
      
      logger.error('LLMBasedRelationExtractor: LLM 서비스 사용 불가능', {
        requestedProvider,
        preferredProvider: this.preferredProvider,
        llmProviderConfig: mementoConfig.llmProvider,
        openaiAvailable: this.openaiClient !== null,
        geminiAvailable: this.geminiClient !== null
      });
      
      throw new Error(errorMessage);
    }

    // LLM 호출
    let parsedResponse: ParseResult;

    try {
      switch (actualProvider) {
        case 'openai':
          parsedResponse = await this.extractWithOpenAI(prompt);
          break;
        case 'gemini':
          parsedResponse = await this.extractWithGemini(prompt);
          break;
        case 'ollama':
          parsedResponse = await this.extractWithOllama(prompt);
          break;
        default:
          throw new Error(`지원하지 않는 provider: ${actualProvider}`);
      }
    } catch (error) {
      // LLM 호출 실패 시 명확한 에러 메시지와 함께 예외를 던짐
      // 호출자가 실패를 인지하고 적절한 fallback 전략을 사용할 수 있도록 함
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      const errorDetails = {
        error: errorMessage,
        memoryId: newMemory.id,
        provider: actualProvider,
        requestedProvider,
        preferredProvider: this.preferredProvider,
        llmProviderConfig: mementoConfig.llmProvider,
        suggestion: '규칙 기반 추출을 사용하거나 네트워크 연결을 확인하세요.'
      };
      
      logger.error('LLM 호출 실패', errorDetails);
      
      // 네트워크 오류와 실제 관계가 없는 경우를 구분하기 위해 예외를 던짐
      // 호출자는 이 예외를 catch하여 fallback 전략을 사용할 수 있음
      throw new Error(`LLM 기반 관계 추출 실패: ${errorMessage}. ${errorDetails.suggestion}`);
    }

    // 최소 신뢰도 필터링
    const minConfidence = options?.minConfidence ?? CONFIDENCE.MIN_LLM_BASED;

    // RelationCandidate로 변환
    const candidates: RelationCandidate[] = parsedResponse.relations
      .filter(rel => rel.confidence >= minConfidence)
      .map(rel => ({
        source_id: newMemory.id,
        target_id: rel.target_id,
        relation_type: rel.relation_type,
        confidence: rel.confidence,
        method: 'llm',
        evidence: rel.reasoning || 'LLM 분석 결과'
      }));

    // 신뢰도 내림차순 정렬
    candidates.sort((a, b) => b.confidence - a.confidence);

    // 캐시 저장 (7일 TTL)
    this.cache.set(cacheKey, candidates);

    return candidates;
  }

  /**
   * 배치 관계 추출 (여러 기억을 묶어서 처리)
   * 
   * @param newMemories 새로운 기억 목록
   * @param existingMemories 기존 기억 목록
   * @param options 추출 옵션 (batchSize 포함 가능)
   * @returns 각 새로운 기억별 관계 후보 맵
   */
  async extractRelationsBatch(
    newMemories: MemoryItem[],
    existingMemories: MemoryItem[],
    options?: ExtractOptions & { batchSize?: number }
  ): Promise<Map<string, RelationCandidate[]>> {
    const results = new Map<string, RelationCandidate[]>();
    // 배치 크기를 옵션에서 가져오거나, 환경 변수에서 가져오거나, 기본값 사용
    const batchSize = options?.batchSize ?? 
      (process.env.RELATION_EXTRACT_BATCH_SIZE ? parseInt(process.env.RELATION_EXTRACT_BATCH_SIZE, 10) : LIMITS.BATCH_SIZE_DEFAULT);
    const batches: MemoryItem[][] = [];

    // 배치로 나누기
    for (let i = 0; i < newMemories.length; i += batchSize) {
      batches.push(newMemories.slice(i, i + batchSize));
    }

    // 각 배치 처리
    for (const batch of batches) {
      const promises = batch.map(memory =>
        this.extractRelations(memory, existingMemories, options)
      );

      const batchResults = await Promise.all(promises);
      
      for (let i = 0; i < batch.length && i < batchResults.length; i++) {
        const memory = batch[i];
        const result = batchResults[i];
        if (memory && result !== undefined) {
          results.set(memory.id, result);
        }
      }
    }

    return results;
  }

  /**
   * 비용 통계 조회
   */
  getCostMetrics(): LLMCostMetrics {
    return { ...this.costMetrics };
  }

  /**
   * 비용 통계 초기화
   */
  resetCostMetrics(): void {
    this.costMetrics.totalCalls = 0;
    this.costMetrics.totalTokens = 0;
    this.costMetrics.totalCost = 0;
    this.costMetrics.lastReset = Date.now();
  }
}

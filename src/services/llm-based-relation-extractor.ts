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

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { mementoConfig } from '../config/index.js';
import { UnifiedEmbeddingService } from './unified-embedding-service.js';
import { CacheService } from './cache-service.js';
import type {
  RelationCandidate,
  RelationType,
  IRelationExtractor,
  ExtractOptions
} from '../types/relation.js';
import { ALL_RELATION_TYPES } from '../types/relation.js';
import type { MemoryItem } from '../types/index.js';
import { isApplicableRelationType, MEMORY_TYPE_RELATION_MAP } from '../types/relation.js';
import type { EmbeddingData, SimilarityResult } from '../types/embedding.types.js';
import { logger } from '../utils/logger.js';
import { CacheKeyGenerator } from '../utils/cache-key-generator.js';
import { CONFIDENCE, LIMITS, CACHE, LLM_COST, RATE_LIMITER, TIME } from '../constants/relation-constants.js';

/**
 * LLM 응답 파싱 결과 (레거시 호환성을 위해 유지)
 * @deprecated ParseResult를 사용하세요
 */
interface ParsedLLMResponse {
  relations: Array<{
    target_id: string;
    relation_type: RelationType;
    confidence: number;
    reasoning?: string;
  }>;
}

/**
 * LLM 응답 파싱 결과
 * 외부에서 접근 가능하도록 클래스 외부에 정의
 */
export interface ParseResult {
  success: boolean;
  relations: Array<{
    target_id: string;
    relation_type: RelationType;
    confidence: number;
    reasoning?: string;
  }>;
  error?: string;
}

/**
 * 토큰 버킷 Rate Limiter
 * 
 * 경쟁 조건을 방지하기 위해 락 메커니즘을 사용합니다.
 * 동시에 여러 요청이 들어와도 토큰 계산이 정확하게 이루어집니다.
 */
class TokenBucketRateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second
  private lastRefill: number;
  private lock: Promise<void> = Promise.resolve(); // 락을 위한 Promise 체인

  constructor(capacity: number = 1, refillRate: number = 1) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * 토큰을 소비하고 사용 가능 여부를 반환
   * 
   * 락 메커니즘을 사용하여 동시 요청 시 경쟁 조건을 방지합니다.
   * refill()과 토큰 소비를 원자적으로 처리합니다.
   */
  async consume(): Promise<boolean> {
    // 락을 획득하여 순차적으로 처리
    return await new Promise<boolean>((resolve) => {
      this.lock = this.lock.then(async () => {
        // 토큰 리필 (락 내에서 실행)
        this.refill();

        if (this.tokens >= 1) {
          this.tokens -= 1;
          resolve(true);
          return;
        }

        // 토큰이 부족한 경우, 다음 토큰이 채워질 때까지 대기
        const waitTime = (1 - this.tokens) / this.refillRate * TIME.SECOND_MS;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // 대기 후 다시 리필 및 확인 (락 내에서 실행)
        this.refill();
        
        if (this.tokens >= 1) {
          this.tokens -= 1;
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }

  /**
   * 토큰 버킷 리필
   * 
   * 락 내에서만 호출되어야 하므로 private으로 유지합니다.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / TIME.SECOND_MS;
    const tokensToAdd = elapsed * this.refillRate;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

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
  private geminiClient: GoogleGenerativeAI | null = null;
  private readonly preferredProvider: 'openai' | 'gemini' | null;
  private readonly embeddingService: UnifiedEmbeddingService;
  private readonly cache: CacheService<RelationCandidate[]>; // 7일 TTL
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly costMetrics: LLMCostMetrics;

  constructor() {
    this.preferredProvider = this.initializeClients();
    this.embeddingService = new UnifiedEmbeddingService();
    this.cache = new CacheService<RelationCandidate[]>(CACHE.EXTRACTION_SIZE, CACHE.EXTRACTION_TTL_MS);
    this.rateLimiter = new TokenBucketRateLimiter(RATE_LIMITER.CAPACITY, RATE_LIMITER.REFILL_RATE);
    this.costMetrics = {
      totalCalls: 0,
      totalTokens: 0,
      totalCost: 0,
      lastReset: Date.now()
    };
  }

  /**
   * LLM 클라이언트 초기화
   */
  private initializeClients(): 'openai' | 'gemini' | null {
    // OpenAI 클라이언트 초기화
    if (mementoConfig.openaiApiKey) {
      try {
        this.openaiClient = new OpenAI({ apiKey: mementoConfig.openaiApiKey });
        logger.info('OpenAI 클라이언트 초기화 완료');
        return 'openai';
      } catch (error) {
        logger.warn('OpenAI 초기화 실패', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }

    // Gemini 클라이언트 초기화
    if (mementoConfig.geminiApiKey) {
      try {
        this.geminiClient = new GoogleGenerativeAI(mementoConfig.geminiApiKey);
        logger.info('Gemini 클라이언트 초기화 완료');
        return 'gemini';
      } catch (error) {
        logger.warn('Gemini 초기화 실패', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }

    logger.warn('사용 가능한 LLM 서비스가 없습니다.');
    return null;
  }

  /**
   * LLM 서비스 사용 가능 여부 확인
   */
  isAvailable(): boolean {
    return this.preferredProvider !== null;
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
   * Embedding 기반 후보 필터링
   * cosine similarity 상위 N개만 LLM 비교 대상으로 선정
   */
  private async filterCandidatesByEmbedding(
    newMemory: MemoryItem,
    existingMemories: MemoryItem[],
    limit: number = LIMITS.LLM_CANDIDATE_DEFAULT
  ): Promise<MemoryItem[]> {
    if (existingMemories.length <= limit) {
      return existingMemories;
    }

    try {
      // 새로운 기억의 임베딩 생성
      const newEmbedding = await this.embeddingService.generateEmbedding(newMemory.content);
      if (!newEmbedding || !newEmbedding.embedding) {
        // 임베딩 생성 실패 시 단순 제한
        return existingMemories.slice(0, limit);
      }

      // 기존 기억들의 임베딩 데이터 준비
      const embeddingData: EmbeddingData[] = [];
      for (const memory of existingMemories) {
        if (memory.embedding && memory.embedding.length > 0) {
          embeddingData.push({
            id: memory.id,
            content: memory.content,
            embedding: memory.embedding
          });
        }
      }

      // 임베딩이 없는 기억은 제외하고 유사도 검색
      if (embeddingData.length === 0) {
        return existingMemories.slice(0, limit);
      }

      // 유사도 검색
      const similarMemories = await this.embeddingService.searchSimilar(
        newMemory.content,
        embeddingData,
        limit,
        0.0 // threshold 없이 상위 N개만
      );

      // 유사도 순으로 정렬된 기억 ID 목록
      const similarIds = new Set(similarMemories.map(r => r.id));

      // 원본 순서를 유지하면서 유사한 기억을 우선 배치
      const result: MemoryItem[] = [];
      const added = new Set<string>();

      // 유사한 기억 먼저 추가
      for (const memory of existingMemories) {
        if (similarIds.has(memory.id) && result.length < limit) {
          result.push(memory);
          added.add(memory.id);
        }
      }

      // 나머지 기억 추가 (임베딩이 없는 경우 포함)
      for (const memory of existingMemories) {
        if (!added.has(memory.id) && result.length < limit) {
          result.push(memory);
        }
      }

      return result;
    } catch (error) {
      logger.warn('Embedding 기반 필터링 실패, 기본 제한 사용', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return existingMemories.slice(0, limit);
    }
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
    provider: 'openai' | 'gemini',
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

  /**
   * OpenAI를 사용하여 관계 추출
   */
  private async extractWithOpenAI(
    prompt: string
  ): Promise<ParseResult> {
    if (!this.openaiClient) {
      throw new Error('OpenAI 클라이언트가 초기화되지 않았습니다.');
    }

    // Rate limit 확인
    await this.rateLimiter.consume();

    try {
      const model = mementoConfig.openaiModel || 'gpt-4o-mini';
      const response = await this.openaiClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a semantic relation analyzer. Analyze relationships between memories and return JSON format only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3, // 일관성을 위해 낮은 temperature
        max_tokens: LIMITS.MAX_RESPONSE_TOKENS,
        response_format: { type: 'json_object' } // JSON 모드 강제
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI 응답이 비어있습니다.');
      }

      // 비용 모니터링
      const promptTokens = response.usage?.prompt_tokens || 0;
      const completionTokens = response.usage?.completion_tokens || 0;
      this.calculateAndLogCost('openai', promptTokens, completionTokens);

      const parseResult = this.parseLLMResponse(content);
      if (!parseResult.success) {
        // 파싱 실패 시 예외를 던져 호출자가 실패를 인지할 수 있도록 함
        throw new Error(`LLM 응답 파싱 실패: ${parseResult.error}`);
      }
      return parseResult;
    } catch (error) {
      logger.error('OpenAI 호출 실패', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Gemini를 사용하여 관계 추출
   */
  private async extractWithGemini(
    prompt: string
  ): Promise<ParseResult> {
    if (!this.geminiClient) {
      throw new Error('Gemini 클라이언트가 초기화되지 않았습니다.');
    }

    // Rate limit 확인
    await this.rateLimiter.consume();

    try {
      const modelName = mementoConfig.geminiModel || 'gemini-1.5-flash';
      const model = this.geminiClient.getGenerativeModel({ model: modelName });

      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: LIMITS.MAX_RESPONSE_TOKENS,
          responseMimeType: 'application/json'
        }
      });

      const response = result.response;
      const text = response.text();
      if (!text) {
        throw new Error('Gemini 응답이 비어있습니다.');
      }

      // 비용 모니터링 (Gemini는 usage 정보를 직접 제공하지 않으므로 대략적 추정)
      const estimatedPromptTokens = Math.ceil(prompt.length / 4); // 대략적 추정
      const estimatedCompletionTokens = Math.ceil(text.length / 4);
      this.calculateAndLogCost('gemini', estimatedPromptTokens, estimatedCompletionTokens);

      const parseResult = this.parseLLMResponse(text);
      if (!parseResult.success) {
        // 파싱 실패 시 예외를 던져 호출자가 실패를 인지할 수 있도록 함
        throw new Error(`LLM 응답 파싱 실패: ${parseResult.error}`);
      }
      return parseResult;
    } catch (error) {
      logger.error('Gemini 호출 실패', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  /**
   * LLM 응답을 파싱하여 관계 후보 추출
   * 
   * @param responseText LLM 응답 텍스트
   * @returns 파싱 결과 (성공 여부와 관계 목록 포함)
   * @throws 파싱 실패 시 예외를 던지지 않고 ParseResult에 실패 정보를 포함하여 반환
   */
  private parseLLMResponse(responseText: string): ParseResult {
    try {
      // JSON 추출 (마크다운 코드 블록 제거)
      let jsonText = responseText.trim();
      
      // 마크다운 코드 블록 제거
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(jsonText) as { relations?: Array<{
        target_id: string;
        relation_type: string;
        confidence: number;
        reasoning?: string;
      }> };

      // 응답 구조 검증
      if (!parsed.relations || !Array.isArray(parsed.relations)) {
        return {
          success: false,
          relations: [],
          error: '응답 구조가 올바르지 않습니다: relations 배열이 없거나 배열이 아닙니다.'
        };
      }

      // 관계 유형 및 신뢰도 검증
      const validRelations = parsed.relations
        .filter(rel => {
          // 관계 유형 검증
          if (!ALL_RELATION_TYPES.includes(rel.relation_type as RelationType)) {
            return false;
          }

          // 신뢰도 범위 검증
          if (typeof rel.confidence !== 'number' || rel.confidence < 0 || rel.confidence > 1) {
            return false;
          }

          return true;
        })
        .map(rel => ({
          target_id: rel.target_id,
          relation_type: rel.relation_type as RelationType,
          confidence: Math.max(0, Math.min(1, rel.confidence)), // 0~1 범위로 클램핑
          reasoning: rel.reasoning
        }));

      return {
        success: true,
        relations: validRelations
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('LLM 응답 파싱 실패', { 
        error: errorMessage,
        responseText: responseText.substring(0, 500) // 처음 500자만 로깅
      });
      return {
        success: false,
        relations: [],
        error: `JSON 파싱 실패: ${errorMessage}`
      };
    }
  }

  /**
   * 새로운 기억과 기존 기억들 간의 관계를 추출합니다.
   * 
   * @param newMemory 새로운 기억
   * @param existingMemories 기존 기억 목록
   * @param options 추출 옵션
   * @returns 관계 후보 목록
   */
  async extractRelations(
    newMemory: MemoryItem,
    existingMemories: MemoryItem[],
    options?: ExtractOptions
  ): Promise<RelationCandidate[]> {
    if (!this.isAvailable()) {
      throw new Error('LLM 서비스가 사용 불가능합니다. API 키를 설정해주세요.');
    }

    if (existingMemories.length === 0) {
      return [];
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

    // LLM 호출
    let parsedResponse: ParseResult;
    try {
      if (this.preferredProvider === 'openai') {
        parsedResponse = await this.extractWithOpenAI(prompt);
      } else if (this.preferredProvider === 'gemini') {
        parsedResponse = await this.extractWithGemini(prompt);
      } else {
        throw new Error('사용 가능한 LLM 서비스가 없습니다.');
      }
    } catch (error) {
      // LLM 호출 실패 시 명확한 에러 메시지와 함께 예외를 던짐
      // 호출자가 실패를 인지하고 적절한 fallback 전략을 사용할 수 있도록 함
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorDetails = {
        error: errorMessage,
        memoryId: newMemory.id,
        provider: this.preferredProvider,
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

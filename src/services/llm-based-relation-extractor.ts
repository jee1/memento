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
  private readonly preferredProvider: 'openai' | 'gemini' | 'ollama' | null;
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
   * 환경 변수 LLM_PROVIDER에 따라 프로바이더 선택
   * - 'openai': OpenAI 우선 시도, 실패 시 Gemini/Ollama fallback
   * - 'gemini': Gemini 우선 시도, 실패 시 OpenAI/Ollama fallback
   * - 'ollama': Ollama 우선 시도, 실패 시 OpenAI/Gemini fallback
   * - 'auto': 사용 가능한 것 자동 선택 (OpenAI -> Gemini -> Ollama 순서)
   */
  private initializeClients(): 'openai' | 'gemini' | 'ollama' | null {
    const preferredProvider = mementoConfig.llmProvider || 'auto';
    
    // OpenAI 클라이언트 초기화 함수
    const initOpenAI = (): 'openai' | null => {
      if (!mementoConfig.openaiApiKey) {
        return null;
      }
      try {
        this.openaiClient = new OpenAI({ apiKey: mementoConfig.openaiApiKey });
        logger.info('OpenAI 클라이언트 초기화 완료');
        return 'openai';
      } catch (error) {
        logger.warn('OpenAI 초기화 실패', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        return null;
      }
    };

    // Gemini 클라이언트 초기화 함수
    const initGemini = (): 'gemini' | null => {
      if (!mementoConfig.geminiApiKey) {
        return null;
      }
      try {
        this.geminiClient = new GoogleGenerativeAI(mementoConfig.geminiApiKey);
        logger.info('Gemini 클라이언트 초기화 완료');
        return 'gemini';
      } catch (error) {
        logger.warn('Gemini 초기화 실패', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        return null;
      }
    };

    // Ollama 클라이언트 초기화 함수 (연결 테스트)
    const initOllama = async (): Promise<'ollama' | null> => {
      try {
        const baseUrl = mementoConfig.ollamaBaseUrl || 'http://localhost:11434';
        const model = mementoConfig.ollamaModel || 'llama3';
        
        // Ollama 서버 연결 테스트
        const response = await fetch(`${baseUrl}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(3000) // 3초 타임아웃
        });
        
        if (!response.ok) {
          logger.warn('Ollama 서버 연결 실패', { 
            status: response.status,
            baseUrl 
          });
          return null;
        }
        
        logger.info('Ollama 클라이언트 초기화 완료', { baseUrl, model });
        return 'ollama';
      } catch (error) {
        logger.warn('Ollama 초기화 실패', { 
          error: error instanceof Error ? error.message : String(error),
          baseUrl: mementoConfig.ollamaBaseUrl
        });
        return null;
      }
    };

    // 프로바이더 선택 로직
    if (preferredProvider === 'openai') {
      // OpenAI 우선 시도
      const result = initOpenAI();
      if (result) return result;
      // 실패 시 Gemini fallback
      const geminiResult = initGemini();
      if (geminiResult) return geminiResult;
      // 실패 시 Ollama fallback (비동기이므로 null 반환)
      return null;
    } else if (preferredProvider === 'gemini') {
      // Gemini 우선 시도
      const result = initGemini();
      if (result) return result;
      // 실패 시 OpenAI fallback
      const openaiResult = initOpenAI();
      if (openaiResult) return openaiResult;
      // 실패 시 Ollama fallback (비동기이므로 null 반환)
      return null;
    } else if (preferredProvider === 'ollama') {
      // Ollama는 비동기 초기화이므로 나중에 확인
      // 여기서는 null을 반환하고, extractRelations에서 확인
      return null;
    } else {
      // 'auto': 기존 로직 (OpenAI -> Gemini -> Ollama 순서)
      const result = initOpenAI();
      if (result) return result;
      const geminiResult = initGemini();
      if (geminiResult) return geminiResult;
      // Ollama는 비동기이므로 null 반환
      return null;
    }
  }

  /**
   * LLM 서비스 사용 가능 여부 확인
   */
  isAvailable(): boolean {
    // Ollama는 비동기 초기화이므로 설정만 확인
    if (mementoConfig.llmProvider === 'ollama') {
      return true; // Ollama는 extractRelations에서 실제 연결 확인
    }
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
      const model = mementoConfig.openaiLlmModel || 'gpt-4o-mini';
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
   * Ollama 모델 존재 여부 확인
   */
  private async checkOllamaModel(baseUrl: string, model: string): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      const models = data.models || [];
      return models.some((m: any) => m.name === model || m.name.startsWith(`${model}:`));
    } catch (error) {
      logger.warn('Ollama 모델 확인 실패', { 
        error: error instanceof Error ? error.message : String(error),
        baseUrl,
        model
      });
      return false;
    }
  }

  /**
   * Ollama를 사용하여 관계 추출
   */
  private async extractWithOllama(
    prompt: string
  ): Promise<ParseResult> {
    // Rate limit 확인
    await this.rateLimiter.consume();

    const baseUrl = mementoConfig.ollamaBaseUrl || 'http://localhost:11434';
    const model = mementoConfig.ollamaModel || 'llama3';

    // Ollama API 요청 준비 (에러 로깅을 위해 함수 스코프 밖에 선언)
    const requestBody = {
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
      options: {
        temperature: 0.3,
        num_predict: LIMITS.MAX_RESPONSE_TOKENS
      },
      format: 'json' as const // JSON 형식 강제
    };

    try {
      // 모델 존재 여부 확인
      const modelExists = await this.checkOllamaModel(baseUrl, model);
      if (!modelExists) {
        throw new Error(
          `Ollama 모델 '${model}'이 설치되지 않았습니다. ` +
          `다음 명령어로 모델을 설치하세요: ollama pull ${model}`
        );
      }
      
      // Ollama API 호출
      const apiUrl = `${baseUrl}/api/chat`;
      
      let response: Response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(60000) // 60초 타임아웃
        });
      } catch (fetchError) {
        // 에러 발생 시에만 요청 정보 로깅
        logger.error('Ollama API fetch 실패', {
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
          url: apiUrl,
          baseUrl,
          model,
          requestBody: {
            ...requestBody,
            messages: requestBody.messages.map((msg: { role: string; content: string }) => ({
              role: msg.role,
              contentLength: msg.content.length,
              contentPreview: msg.content.substring(0, 500),
              contentFull: msg.content.length < 2000 ? msg.content : msg.content.substring(0, 1000) + '...' + msg.content.substring(msg.content.length - 1000)
            }))
          },
          promptLength: prompt.length,
          promptPreview: prompt.substring(0, 500),
          promptFull: prompt.length < 2000 ? prompt : prompt.substring(0, 1000) + '...' + prompt.substring(prompt.length - 1000)
        });
        throw fetchError;
      }

      if (!response.ok) {
        let errorText = '';
        try {
          errorText = await response.text();
          logger.error('Ollama API 에러 응답', {
            status: response.status,
            statusText: response.statusText,
            errorText,
            url: apiUrl
          });
        } catch (textError) {
          logger.error('Ollama API 에러 응답 텍스트 읽기 실패', {
            status: response.status,
            statusText: response.statusText,
            textError: textError instanceof Error ? textError.message : String(textError)
          });
        }
        
        let errorMessage = `Ollama API 호출 실패: ${response.status} ${response.statusText}`;
        
        if (response.status === 404) {
          errorMessage = `Ollama 모델 '${model}'을 찾을 수 없습니다. 모델이 설치되어 있는지 확인하세요: ollama pull ${model}`;
        } else if (errorText) {
          try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.error || errorMessage;
          } catch {
            // JSON 파싱 실패 시 원본 에러 메시지 사용
            errorMessage = errorText || errorMessage;
          }
        }
        
        throw new Error(errorMessage);
      }

      // 응답 본문 파싱
      // Ollama는 NDJSON (Newline Delimited JSON) 형식으로 응답할 수 있습니다
      const contentType = response.headers.get('content-type') || '';
      const isNDJSON = contentType.includes('application/x-ndjson') || contentType.includes('ndjson');
      
      let data: any;
      let content = '';
      
      let responseText = '';
      try {
        responseText = await response.text();
        
        if (isNDJSON) {
          // NDJSON 형식 처리: 각 줄을 개별 JSON 객체로 파싱
          const lines = responseText.trim().split('\n').filter((line): line is string => line.trim().length > 0);
          
          let lastData: any = null;
          const contentParts: string[] = [];
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            
            try {
              const lineData = JSON.parse(line);
              lastData = lineData; // 마지막 줄의 메타데이터 사용
              
              // message.content가 있으면 합치기
              if (lineData.message?.content) {
                contentParts.push(lineData.message.content);
              }
              
              // done이 true이면 완료
              if (lineData.done === true) {
                break;
              }
            } catch (lineParseError) {
              // 에러 발생 시에만 로깅
              logger.warn('Ollama NDJSON 라인 파싱 실패', {
                lineIndex: i,
                linePreview: line.substring(0, 200),
                error: lineParseError instanceof Error ? lineParseError.message : String(lineParseError),
                responseTextLength: responseText.length,
                responseTextPreview: responseText.substring(0, 500),
                responseTextFull: responseText
              });
              // 계속 진행
            }
          }
          
          // content 합치기
          content = contentParts.join('');
          
          // 마지막 데이터를 메인 데이터로 사용 (메타데이터 포함)
          data = lastData || {};
          
          // content를 message에 설정
          if (data.message) {
            data.message.content = content;
          } else {
            data.message = { role: 'assistant', content };
          }
        } else {
          // 일반 JSON 형식 처리
          try {
            data = JSON.parse(responseText);
            content = data.message?.content || '';
          } catch (parseError) {
            // 에러 발생 시에만 상세 로깅
            logger.error('Ollama API 응답 JSON 파싱 실패', {
              parseError: parseError instanceof Error ? parseError.message : String(parseError),
              contentType,
              isNDJSON,
              responseTextLength: responseText.length,
              responseTextPreview: responseText.substring(0, 500),
              responseTextFull: responseText,
              status: response.status,
              statusText: response.statusText,
              headers: Object.fromEntries(response.headers.entries())
            });
            throw new Error(`Ollama 응답 JSON 파싱 실패: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
          }
        }
      } catch (textError) {
        // 에러 발생 시에만 상세 로깅
        logger.error('Ollama API 응답 본문 읽기 실패', {
          textError: textError instanceof Error ? textError.message : String(textError),
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          contentType,
          isNDJSON,
          responseTextLength: responseText.length,
          responseTextPreview: responseText.substring(0, 500),
          responseTextFull: responseText
        });
        throw textError;
      }
      
      // content가 없으면 data.message?.content에서 가져오기
      if (!content && data.message?.content) {
        content = data.message.content;
      }
      
      if (!content) {
        // 에러 발생 시에만 상세 로깅
        logger.error('Ollama 응답이 비어있습니다', {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          contentType,
          isNDJSON,
          responseTextLength: responseText.length,
          responseTextPreview: responseText.substring(0, 500),
          responseTextFull: responseText,
          fullResponse: data
        });
        throw new Error('Ollama 응답이 비어있습니다.');
      }

      // 비용 모니터링 (Ollama는 로컬이므로 비용 0)
      const promptTokens = data.prompt_eval_count || 0;
      const completionTokens = data.eval_count || 0;
      this.calculateAndLogCost('ollama', promptTokens, completionTokens);

      // Given: Ollama 응답 내용 (JSON 형식이어야 하지만 추가 텍스트가 포함될 수 있음)
      // When: JSON 파싱 시도
      // Ollama는 format: 'json' 옵션을 사용하더라도 일부 모델은 JSON 뒤에 추가 텍스트를 포함할 수 있습니다
      // 따라서 먼저 extractJSON으로 정리한 후 파싱을 시도합니다
      let cleanedContent = content;
      const extractedJson = this.extractJSON(content);
      if (extractedJson) {
        cleanedContent = extractedJson;
      } else {
        // extractJSON이 실패한 경우, 수동으로 첫 번째 '{'부터 마지막 '}'까지 추출
        const firstBrace = content.indexOf('{');
        const lastBrace = content.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          cleanedContent = content.substring(firstBrace, lastBrace + 1).trim();
        }
      }
      
      // JSON 파싱을 시도하기 전에 한 번 더 정리
      // "Unexpected non-whitespace character after JSON" 에러를 방지하기 위해
      // 첫 번째 '{'부터 마지막 '}'까지만 추출하고, 그 사이의 모든 텍스트를 제거
      let finalJson = cleanedContent;
      const firstBraceFinal = finalJson.indexOf('{');
      const lastBraceFinal = finalJson.lastIndexOf('}');
      
      if (firstBraceFinal !== -1 && lastBraceFinal !== -1 && lastBraceFinal > firstBraceFinal) {
        finalJson = finalJson.substring(firstBraceFinal, lastBraceFinal + 1).trim();
        
        // JSON.parse()가 성공할 때까지 끝 부분을 점진적으로 제거
        let validJson = null;
        for (let i = finalJson.length; i > 0; i--) {
          const testJson = finalJson.substring(0, i).trim();
          if (testJson.endsWith('}')) {
            try {
              JSON.parse(testJson);
              validJson = testJson;
              break;
            } catch {
              // 계속 시도
            }
          }
        }
        
        if (validJson) {
          finalJson = validJson;
        }
      }
      
      const parseResult = this.parseLLMResponse(finalJson);
      if (!parseResult.success) {
        // Then: 파싱 실패 시 상세한 에러 정보와 함께 예외 발생
        logger.error('Ollama 응답 파싱 실패', {
          error: parseResult.error,
          contentLength: content.length,
          cleanedLength: cleanedContent.length,
          finalLength: finalJson.length,
          contentPreview: content.substring(0, 500),
          cleanedPreview: cleanedContent.substring(0, 500),
          finalPreview: finalJson.substring(0, 500),
          contentFull: content.length < 2000 ? content : content.substring(0, 1000) + '...' + content.substring(content.length - 1000),
          model: mementoConfig.ollamaModel,
          baseUrl: mementoConfig.ollamaBaseUrl,
          requestBody: {
            ...requestBody,
            messages: requestBody.messages.map((msg: { role: string; content: string }) => ({
              role: msg.role,
              contentLength: msg.content.length,
              contentPreview: msg.content.substring(0, 500),
              contentFull: msg.content.length < 2000 ? msg.content : msg.content.substring(0, 1000) + '...' + msg.content.substring(msg.content.length - 1000)
            }))
          },
          promptLength: prompt.length,
          promptPreview: prompt.substring(0, 500),
          promptFull: prompt.length < 2000 ? prompt : prompt.substring(0, 1000) + '...' + prompt.substring(prompt.length - 1000),
          responseTextLength: responseText.length,
          responseTextPreview: responseText.substring(0, 500),
          responseTextFull: responseText,
          contentType,
          isNDJSON,
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries())
        });
        throw new Error(`LLM 응답 파싱 실패: ${parseResult.error}`);
      }
      return parseResult;
    } catch (error) {
      // 에러 발생 시에만 상세 로깅
      logger.error('Ollama 호출 실패', { 
        error: error instanceof Error ? error.message : String(error),
        baseUrl: mementoConfig.ollamaBaseUrl,
        model: mementoConfig.ollamaModel,
        requestBody: {
          ...requestBody,
          messages: requestBody.messages.map(msg => ({
            role: msg.role,
            contentLength: msg.content.length,
            contentPreview: msg.content.substring(0, 500),
            contentFull: msg.content.length < 2000 ? msg.content : msg.content.substring(0, 1000) + '...' + msg.content.substring(msg.content.length - 1000)
          }))
        },
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 500),
        promptFull: prompt.length < 2000 ? prompt : prompt.substring(0, 1000) + '...' + prompt.substring(prompt.length - 1000)
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
   * LLM 응답에서 JSON 객체 추출
   * JSON 뒤에 추가 텍스트가 있어도 첫 번째 유효한 JSON만 추출
   * 
   * Given: LLM 응답 텍스트 (JSON 형식이어야 하지만 추가 텍스트가 포함될 수 있음)
   * When: JSON 객체 추출 시도
   * Then: 유효한 JSON 객체만 반환 (추가 텍스트 제거)
   */
  private extractJSON(text: string): string | null {
    if (!text || typeof text !== 'string') {
      return null;
    }
    
    let jsonText = text.trim();
    
    // 마크다운 코드 블록 제거
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```.*$/s, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```.*$/s, '');
    }

    // 첫 번째 '{'부터 시작하는 JSON 객체 찾기
    const firstBrace = jsonText.indexOf('{');
    if (firstBrace === -1) {
      logger.warn('JSON 객체 시작 문자({)를 찾을 수 없습니다', {
        textLength: jsonText.length,
        textPreview: jsonText.substring(0, 200)
      });
      return null;
    }

    // 중괄호 매칭하여 JSON 객체 끝 찾기
    // 이 방법은 JSON 뒤에 추가 텍스트가 있어도 정확하게 JSON 객체만 추출할 수 있습니다
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    let jsonEnd = -1;
    
    for (let i = firstBrace; i < jsonText.length; i++) {
      const char = jsonText[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            // JSON 객체 끝 찾음
            jsonEnd = i + 1;
            break;
          }
        }
      }
    }
    
    if (jsonEnd === -1) {
      // 중괄호가 닫히지 않음 - 경고 로그
      logger.warn('JSON 객체가 완전히 닫히지 않았습니다', {
        braceCount,
        textLength: jsonText.length,
        extractedPreview: jsonText.substring(firstBrace, Math.min(firstBrace + 200, jsonText.length))
      });
      // 그래도 시도해보기 (마지막 '}'까지 추출)
      const lastBrace = jsonText.lastIndexOf('}');
      if (lastBrace !== -1 && lastBrace > firstBrace) {
        return jsonText.substring(firstBrace, lastBrace + 1);
      }
      return jsonText.substring(firstBrace);
    }
    
    // JSON 객체만 추출 (추가 텍스트 제거)
    const extracted = jsonText.substring(firstBrace, jsonEnd).trim();
    
    // 추출된 JSON이 유효한지 빠르게 확인
    // 이 검증은 JSON.parse()가 실패하지 않도록 보장합니다
    try {
      const parsed = JSON.parse(extracted);
      // 파싱 성공 시 유효한 JSON 반환
      return extracted;
    } catch (error) {
      // 유효하지 않은 JSON인 경우, 에러 타입에 따라 처리
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isTrailingTextError = errorMsg.includes('Unexpected non-whitespace character after JSON');
      
      if (isTrailingTextError) {
        // JSON 뒤에 추가 텍스트가 있는 경우, 더 정확하게 추출 시도
        // 중괄호 매칭이 정확했지만, JSON.parse()가 여전히 추가 텍스트를 감지
        // 이는 JSON 내부에 문제가 있거나, 추출 범위가 정확하지 않을 수 있음
        // 점진적으로 JSON 끝을 조정하여 유효한 JSON 찾기
        let validJson = null;
        for (let i = extracted.length; i > 0; i--) {
          const testJson = extracted.substring(0, i).trim();
          if (testJson.endsWith('}')) {
            try {
              JSON.parse(testJson);
              validJson = testJson;
              logger.debug('JSON 점진적 추출 성공 (extractJSON 내부)', {
                originalLength: extracted.length,
                validLength: validJson.length,
                removedChars: extracted.length - validJson.length
              });
              break;
            } catch {
              // 계속 시도
            }
          }
        }
        
        if (validJson) {
          return validJson;
        }
      }
      
      // 유효한 JSON을 찾지 못한 경우, 로그를 남기고 추출된 JSON 반환
      // parseLLMResponse에서 추가 정리 시도
      logger.warn('추출된 JSON이 유효하지 않습니다', {
        error: errorMsg,
        extractedLength: extracted.length,
        extractedPreview: extracted.substring(0, 200),
        originalPreview: jsonText.substring(0, 300)
      });
      // 그래도 반환 (parseLLMResponse에서 추가 정리 시도)
      return extracted;
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
      // Given: LLM 응답 텍스트 (JSON 형식이어야 함)
      // When: JSON 추출 및 파싱 시도
      
      // JSON 추출 (마크다운 코드 블록 및 추가 텍스트 제거)
      let jsonText = this.extractJSON(responseText);
      
      if (!jsonText) {
        // JSON 추출 실패 시 원본 텍스트에서 직접 시도
        logger.warn('JSON 추출 실패, 원본 텍스트에서 직접 파싱 시도', {
          responseLength: responseText.length,
          responsePreview: responseText.substring(0, 200)
        });
        jsonText = responseText.trim();
      }

      // JSON 파싱 시도 (여러 방법)
      let parsed: { relations?: Array<{
        target_id: string;
        relation_type: string;
        confidence: number;
        reasoning?: string;
      }> };
      
      try {
        // 첫 번째 시도: extractJSON으로 추출한 JSON 파싱
        // extractJSON이 이미 유효한 JSON만 반환하도록 보장하지만, 
        // 일부 모델은 JSON 뒤에 추가 텍스트를 포함할 수 있으므로 추가 정리 필요
        // JSON.parse()가 실패할 수 있으므로, 먼저 정리된 JSON인지 확인
        let trimmedJson = jsonText.trim();
        
        // JSON 뒤에 추가 텍스트가 있을 수 있으므로, 첫 번째 '{'부터 마지막 '}'까지만 추출
        const firstBrace = trimmedJson.indexOf('{');
        const lastBrace = trimmedJson.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          trimmedJson = trimmedJson.substring(firstBrace, lastBrace + 1).trim();
        }
        
        parsed = JSON.parse(trimmedJson);
        logger.debug('JSON 파싱 성공 (첫 번째 시도)');
      } catch (parseError) {
        // 첫 번째 시도 실패 시, 더 공격적인 정리 시도
        const firstError = parseError instanceof Error ? parseError.message : String(parseError);
        
        // JSON 파싱 에러가 "Unexpected non-whitespace character after JSON"인 경우
        // JSON 뒤에 추가 텍스트가 있다는 의미이므로, extractJSON을 다시 사용하거나
        // 더 정확한 JSON 추출 시도
        const isTrailingTextError = firstError.includes('Unexpected non-whitespace character after JSON');
        
        logger.warn('JSON 파싱 실패, 추가 정리 후 재시도', {
          error: firstError,
          isTrailingTextError,
          jsonLength: jsonText.length,
          jsonPreview: jsonText.substring(0, 300),
          jsonFull: jsonText.length < 1000 ? jsonText : jsonText.substring(0, 500) + '...' + jsonText.substring(jsonText.length - 500)
        });
        
        // 추가 정리: 첫 번째 '{'부터 마지막 '}'까지 추출
        // extractJSON이 이미 이를 수행했지만, 다시 시도하여 더 정확하게 추출
        let cleanedJson = jsonText.trim();
        
        // extractJSON을 다시 호출하여 더 정확한 추출 시도
        if (isTrailingTextError) {
          // "Unexpected non-whitespace character after JSON" 에러는 JSON 뒤에 추가 텍스트가 있다는 의미
          // extractJSON이 이미 이를 처리했지만, 여전히 문제가 있을 수 있으므로 더 정확하게 추출
          const reExtracted = this.extractJSON(responseText);
          if (reExtracted && reExtracted !== jsonText) {
            cleanedJson = reExtracted.trim();
            logger.debug('JSON 재추출 완료 (trailing text 제거)', {
              originalLength: jsonText.length,
              cleanedLength: cleanedJson.length
            });
          } else {
            // extractJSON이 실패한 경우, 수동으로 첫 번째 '{'부터 마지막 '}'까지 추출
            // 그리고 JSON.parse()가 성공할 때까지 끝 부분을 점진적으로 제거
            let firstBrace = cleanedJson.indexOf('{');
            let lastBrace = cleanedJson.lastIndexOf('}');
            
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
              // 먼저 첫 번째 '{'부터 마지막 '}'까지 추출
              cleanedJson = cleanedJson.substring(firstBrace, lastBrace + 1).trim();
              
              // JSON.parse()가 성공할 때까지 끝 부분을 점진적으로 제거
              let attemptJson = cleanedJson;
              let foundValidJson = false;
              
              for (let i = attemptJson.length; i > 0 && !foundValidJson; i--) {
                const testJson = attemptJson.substring(0, i);
                // 마지막 문자가 '}'인지 확인
                if (testJson.endsWith('}')) {
                  try {
                    JSON.parse(testJson);
                    cleanedJson = testJson;
                    foundValidJson = true;
                    logger.debug('JSON 점진적 추출 성공', {
                      originalLength: jsonText.length,
                      cleanedLength: cleanedJson.length,
                      removedChars: attemptJson.length - cleanedJson.length
                    });
                  } catch {
                    // 계속 시도
                  }
                }
              }
              
              if (!foundValidJson) {
                logger.debug('JSON 수동 정리 완료 (점진적 추출 실패)', {
                  originalLength: jsonText.length,
                  cleanedLength: cleanedJson.length,
                  cleanedPreview: cleanedJson.substring(0, 300)
                });
              }
            }
          }
        } else {
          // 다른 종류의 에러인 경우, 기본 정리 시도
          const firstBrace = cleanedJson.indexOf('{');
          const lastBrace = cleanedJson.lastIndexOf('}');
          
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleanedJson = cleanedJson.substring(firstBrace, lastBrace + 1);
            logger.debug('JSON 정리 완료', {
              originalLength: jsonText.length,
              cleanedLength: cleanedJson.length,
              cleanedPreview: cleanedJson.substring(0, 300)
            });
          }
        }
        
        // 두 번째 시도: 정리된 JSON 파싱
        try {
          parsed = JSON.parse(cleanedJson);
          logger.debug('JSON 파싱 성공 (두 번째 시도)');
        } catch (secondError) {
          // 두 번째 시도도 실패 - 원본에서 직접 추출 시도
          logger.warn('정리된 JSON 파싱도 실패, 원본에서 직접 추출 시도', {
            secondError: secondError instanceof Error ? secondError.message : String(secondError),
            cleanedLength: cleanedJson.length,
            cleanedPreview: cleanedJson.substring(0, 300)
          });
          
          // 원본 텍스트에서 다시 추출
          const reExtracted = this.extractJSON(responseText);
          if (reExtracted && reExtracted !== jsonText && reExtracted !== cleanedJson) {
            try {
              parsed = JSON.parse(reExtracted);
              logger.debug('JSON 파싱 성공 (재추출 시도)');
            } catch (thirdError) {
              // 최종 실패
              logger.error('JSON 파싱 최종 실패', {
                firstError,
                secondError: secondError instanceof Error ? secondError.message : String(secondError),
                thirdError: thirdError instanceof Error ? thirdError.message : String(thirdError),
                originalLength: responseText.length,
                originalPreview: responseText.substring(0, 500),
                extractedLength: reExtracted?.length || 0,
                extractedPreview: reExtracted?.substring(0, 500) || 'null'
              });
              
              return {
                success: false,
                relations: [],
                error: `JSON 파싱 실패: ${thirdError instanceof Error ? thirdError.message : String(thirdError)}`
              };
            }
          } else {
            // 최종 실패
            logger.error('JSON 파싱 최종 실패', {
              firstError,
              secondError: secondError instanceof Error ? secondError.message : String(secondError),
              originalLength: responseText.length,
              originalPreview: responseText.substring(0, 500),
              cleanedLength: cleanedJson.length,
              cleanedPreview: cleanedJson.substring(0, 500)
            });
            
            return {
              success: false,
              relations: [],
              error: `JSON 파싱 실패: ${secondError instanceof Error ? secondError.message : String(secondError)}`
            };
          }
        }
      }

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
      } else if (this.preferredProvider === 'ollama' || (this.preferredProvider === null && mementoConfig.llmProvider === 'ollama')) {
        parsedResponse = await this.extractWithOllama(prompt);
      } else if (this.preferredProvider === null && mementoConfig.llmProvider === 'auto') {
        // auto 모드에서 모든 프로바이더 시도
        try {
          parsedResponse = await this.extractWithOpenAI(prompt);
        } catch (openaiError) {
          try {
            parsedResponse = await this.extractWithGemini(prompt);
          } catch (geminiError) {
            parsedResponse = await this.extractWithOllama(prompt);
          }
        }
      } else {
        throw new Error('사용 가능한 LLM 서비스가 없습니다.');
      }
    } catch (error) {
      // LLM 호출 실패 시 명확한 에러 메시지와 함께 예외를 던짐
      // 호출자가 실패를 인지하고 적절한 fallback 전략을 사용할 수 있도록 함
      const errorMessage = error instanceof Error ? error.message : String(error);
      // provider 정보를 정확하게 추출
      let actualProvider: string | null = this.preferredProvider;
      if (actualProvider === null) {
        // preferredProvider가 null인 경우, 환경 변수에서 확인
        actualProvider = mementoConfig.llmProvider || 'auto';
      }
      
      const errorDetails = {
        error: errorMessage,
        memoryId: newMemory.id,
        provider: actualProvider,
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

/**
 * Triple 추출 서비스
 * LLM을 사용하여 Episodic Memory의 observation에서 (subject, predicate, object) 형태의 지식 그래프 트리플을 추출합니다.
 * 
 * AriGraph 파이프라인의 핵심 컴포넌트로, Episodic Memory에서 Semantic Memory로의 자동 학습을 지원합니다.
 * 
 * 비용 최적화 전략:
 * - Rate limit (토큰 버킷 알고리즘)
 * - 캐싱 (TTL 기반)
 * - 비용 모니터링
 * - 에러 처리 및 폴백
 */

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { mementoConfig } from '../../shared/config/index.js';
import { CacheService } from '../../infrastructure/cache/cache-service.js';
import { PromptTemplateLoader } from '../../shared/utils/prompt-template-loader.js';
import { PredicateCanonicalizer } from './predicate-canonicalizer.js';
import { EntityLinker } from './entity-linker.js';
import { tripleExtractionLogger } from '../../infrastructure/logging/triple-extraction-logger.js';
import { TripleCacheService } from '../../shared/utils/triple-cache.js';
import { TripleExtractionStatisticsService } from './triple-extraction-statistics.js';
import type {
  Triple,
  TripleExtractionResult,
  TripleExtractionOptions,
  TripleExtractionFailureReason,
  ExtractionInfo,
  ExtractionSteps
} from '../../shared/types/triple-extraction.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * 토큰 버킷 Rate Limiter
 * LLM 호출 빈도를 제한하여 비용을 절감합니다.
 */
class TokenBucketRateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second
  private lastRefill: number;
  private lock: Promise<void> = Promise.resolve();

  constructor(capacity: number = 1, refillRate: number = 1) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async consume(): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      this.lock = this.lock.then(async () => {
        this.refill();

        if (this.tokens >= 1) {
          this.tokens -= 1;
          resolve(true);
          return;
        }

        const waitTime = (1 - this.tokens) / this.refillRate * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
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

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
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
 * Triple 추출 서비스
 */
export class TripleExtractionService {
  private openaiClient: OpenAI | null = null;
  private geminiClient: GoogleGenerativeAI | null = null;
  private readonly preferredProvider: 'openai' | 'gemini' | 'ollama' | null;
  private readonly cache: TripleCacheService; // PRD 6.11: Triple 추출 결과 캐싱 구현
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly costMetrics: LLMCostMetrics;
  private readonly canonicalizer: PredicateCanonicalizer;
  private readonly entityLinker: EntityLinker;
  private readonly statistics: TripleExtractionStatisticsService; // PRD 8.1: Triple 추출 통계 수집

  // 기본 설정
  private readonly DEFAULT_TEMPERATURE = 0.3;
  private readonly DEFAULT_MAX_TOKENS = 2000;
  private readonly CACHE_SIZE = 100; // PRD 7.3: 캐시 크기 100개 항목
  private readonly CACHE_TTL_MS = 6 * 60 * 60 * 1000; // PRD 7.3: 캐싱 TTL 6시간
  private readonly RATE_LIMITER_CAPACITY = 1;
  private readonly RATE_LIMITER_REFILL_RATE = 1; // 초당 1회
  
  // 로깅 설정
  private readonly SUCCESS_SAMPLING_RATE = 0.1; // 성공 케이스 10% 샘플링

  constructor() {
    this.preferredProvider = this.initializeClients();
    // PRD 6.11: Triple 추출 결과 캐싱 구현
    // PRD 6.12: 캐시 키 생성 로직 구현 (content_hash 기반)
    // PRD 6.13: 캐시 TTL 기반 자동 무효화 구현
    this.cache = new TripleCacheService(this.CACHE_SIZE, this.CACHE_TTL_MS);
    this.rateLimiter = new TokenBucketRateLimiter(
      this.RATE_LIMITER_CAPACITY,
      this.RATE_LIMITER_REFILL_RATE
    );
    this.costMetrics = {
      totalCalls: 0,
      totalTokens: 0,
      totalCost: 0,
      lastReset: Date.now()
    };
    this.canonicalizer = new PredicateCanonicalizer();
    this.entityLinker = new EntityLinker();
    // PRD 8.1: Triple 추출 통계 수집
    this.statistics = new TripleExtractionStatisticsService();
  }

  /**
   * LLM 클라이언트 초기화
   * 환경 변수 LLM_PROVIDER에 따라 프로바이더 선택
   */
  private initializeClients(): 'openai' | 'gemini' | 'ollama' | null {
    const preferredProvider = mementoConfig.llmProvider || 'auto';
    
    const initOpenAI = (): 'openai' | null => {
      if (!mementoConfig.openaiApiKey) {
        return null;
      }
      try {
        this.openaiClient = new OpenAI({ apiKey: mementoConfig.openaiApiKey });
        logger.info('TripleExtractionService: OpenAI 클라이언트 초기화 완료');
        return 'openai';
      } catch (error) {
        logger.warn('TripleExtractionService: OpenAI 초기화 실패', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        return null;
      }
    };

    const initGemini = (): 'gemini' | null => {
      if (!mementoConfig.geminiApiKey) {
        return null;
      }
      try {
        this.geminiClient = new GoogleGenerativeAI(mementoConfig.geminiApiKey);
        logger.info('TripleExtractionService: Gemini 클라이언트 초기화 완료');
        return 'gemini';
      } catch (error) {
        logger.warn('TripleExtractionService: Gemini 초기화 실패', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        return null;
      }
    };

    // 프로바이더 선택 로직
    if (preferredProvider === 'openai') {
      const result = initOpenAI();
      if (result) return result;
      return initGemini();
    } else if (preferredProvider === 'gemini') {
      const result = initGemini();
      if (result) return result;
      return initOpenAI();
    } else {
      // 'auto' 또는 'ollama': OpenAI -> Gemini 순서
      const result = initOpenAI();
      if (result) return result;
      return initGemini();
    }
  }

  /**
   * LLM 서비스 사용 가능 여부 확인
   */
  isAvailable(): boolean {
    return this.preferredProvider !== null;
  }

  /**
   * Observation 텍스트에서 Triple 추출
   * 
   * @param observation Episodic Memory의 content (observation 텍스트)
   * @param options 추출 옵션
   * @param memoryId Episodic Memory ID (로깅용, 선택사항)
   * @returns Triple 추출 결과
   */
  async extractTriples(
    observation: string,
    options: TripleExtractionOptions = {},
    memoryId?: string
  ): Promise<TripleExtractionResult> {
    if (!observation || observation.trim().length === 0) {
      const result = this.createFailureResult('no_triple', 'Observation이 비어있습니다.');
      // 실패 케이스는 항상 로깅
      this.logExtractionResult(result, memoryId, observation, 'Observation이 비어있습니다.').catch(err => {
        logger.error('TripleExtractionService: 로깅 실패', { error: err });
      });
      return result;
    }

    // PRD 6.14: TripleExtractionService에 캐싱 통합
    // 캐시 히트 시 LLM 호출 생략
    const extractionStartTime = Date.now();
    const cached = this.cache.get(observation);
    if (cached) {
      logger.debug('TripleExtractionService: 캐시 히트', {
        contentLength: observation.length,
        tripleCount: cached.triples.length
      });
      
      // PRD 8.1: Triple 추출 통계 수집 - 캐시 히트 기록
      const extractionTime = Date.now() - extractionStartTime;
      this.statistics.recordExtraction(cached, extractionTime, true, 0, 0, 0);
      
      return cached;
    }

    // Rate limit 확인
    await this.rateLimiter.consume();

    try {
      const provider = options.provider || this.preferredProvider || 'auto';
      const { result, rawLLMOutput } = await this.extractWithLLM(observation, provider, options);
      
      // PRD 6.14: TripleExtractionService에 캐싱 통합
      // 성공한 Triple 추출 결과만 캐시에 저장
      // TripleCacheService.set() 내부에서 triples.length > 0 체크
      this.cache.set(observation, result);
      
      // PRD 8.1: Triple 추출 통계 수집
      const extractionTime = Date.now() - extractionStartTime;
      const costMetrics = this.getCostMetrics();
      // 이번 호출의 토큰과 비용은 정확히 측정하기 어려우므로, 전체 누적값 사용 (추정)
      const llmCalls = 1; // 이번 호출
      const tokens = costMetrics.totalTokens; // 누적 토큰 (추정)
      const cost = costMetrics.totalCost; // 누적 비용 (추정)
      this.statistics.recordExtraction(result, extractionTime, false, llmCalls, tokens, cost);
      
      // rawLLMOutput 저장 정책 적용 (비동기, 블로킹하지 않음)
      this.logExtractionResult(result, memoryId, observation, rawLLMOutput).catch(err => {
        logger.error('TripleExtractionService: 로깅 실패', { error: err });
      });
      
      return result;
    } catch (error) {
      // 에러 타입 분류
      const errorType = this.classifyErrorType(error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // 상세 에러 로깅
      logger.error('TripleExtractionService: Triple 추출 실패', {
        error: errorMessage,
        errorType,
        observation: observation.substring(0, 100), // 로그용 일부만
        retryable: errorType === 'network' || errorType === 'rate_limit' || errorType === 'timeout',
        // API 키 오류는 재시도 불가 (즉시 실패)
        immediateFailure: errorType === 'api_key'
      });
      
      // 실패 결과 생성
      // 에러 타입에 따라 더 구체적인 실패 사유 제공
      const failureReason: TripleExtractionFailureReason = 'llm_api_error';
      const result = this.createFailureResult(failureReason, errorMessage);
      
      // 실패 케이스는 항상 로깅
      // 에러가 발생해도 Episodic Memory는 정상 저장되도록 보장 (remember tool에서 처리)
      this.logExtractionResult(result, memoryId, observation, errorMessage).catch(err => {
        logger.error('TripleExtractionService: 로깅 실패', { error: err });
      });
      
      // 항상 TripleExtractionResult 반환 보장
      // 에러가 발생해도 메인 플로우는 계속 진행
      return result;
    }
  }

  /**
   * LLM을 사용하여 Triple 추출
   * 
   * @param observation Observation 텍스트
   * @param provider LLM Provider
   * @param options 추출 옵션
   * @returns Triple 추출 결과와 rawLLMOutput
   */
  private async extractWithLLM(
    observation: string,
    provider: 'openai' | 'gemini' | 'ollama' | 'auto',
    options: TripleExtractionOptions
  ): Promise<{ result: TripleExtractionResult; rawLLMOutput: string }> {
    // 프롬프트 템플릿 로드 및 렌더링
    const prompt = PromptTemplateLoader.loadAndRender('triple-extraction', {
      observation
    });

    // Provider 선택 및 호출
    const actualProvider = provider === 'auto' 
      ? (this.preferredProvider || 'openai')
      : provider;

    let rawLLMOutput: string;
    let triples: Triple[] = [];

    try {
      switch (actualProvider) {
        case 'openai':
          rawLLMOutput = await this.extractWithOpenAI(prompt, options);
          break;
        case 'gemini':
          rawLLMOutput = await this.extractWithGemini(prompt, options);
          break;
        case 'ollama':
          rawLLMOutput = await this.extractWithOllama(prompt, options);
          break;
        default:
          throw new Error(`지원하지 않는 LLM Provider: ${actualProvider}`);
      }

      // JSON 파싱 및 Triple 추출
      const parseResult = this.parseLLMResponse(rawLLMOutput);
      if (parseResult.success) {
        triples = parseResult.triples;
        
        // Triple이 추출되지 않은 경우 no_triple로 분류
        if (triples.length === 0) {
          return {
            result: this.createFailureResult('no_triple', rawLLMOutput),
            rawLLMOutput
          };
        }
        
        // 구조가 모호한 경우 (일부만 유효) - 유효한 triple은 반환하되 경고
        if (parseResult.errorType === 'structure') {
          logger.warn('TripleExtractionService: 일부 triple이 유효하지 않음', {
            validTriples: triples.length,
            error: parseResult.error
          });
          // 유효한 triple은 반환하되, ambiguous_structure는 후처리에서 처리 가능하도록 정보 제공
          // 현재는 유효한 것만 반환 (성공으로 처리)
        }
      } else {
        // 파싱 실패 시 실패 사유에 따라 분류
        const failureReason = this.classifyFailureReason(
          parseResult.error,
          rawLLMOutput,
          parseResult.errorType
        );
        return {
          result: this.createFailureResult(failureReason, rawLLMOutput),
          rawLLMOutput
        };
      }
    } catch (error) {
      // 에러 타입 분류 및 상세 로깅
      const errorType = this.classifyErrorType(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('TripleExtractionService: LLM 호출 실패', {
        error: errorMessage,
        errorType,
        provider: actualProvider,
        retryable: errorType === 'network' || errorType === 'rate_limit' || errorType === 'timeout'
      });
      
      throw error; // 상위로 전파하여 llm_api_error로 처리
    }

    // Triple 정규화 및 steps 추적
    const steps = this.trackExtractionSteps(triples);

    // 성공 결과 생성
    // rawLLMOutput은 로그 파일에만 저장하므로 extractionInfo에는 포함하지 않음
    // (DB에 저장하지 않음)
    const extractionInfo: ExtractionInfo = {
      steps
      // rawLLMOutput은 로그 파일에만 저장 (DB 저장 안 함)
    };

    return {
      result: {
        triples,
        extractionInfo
      },
      rawLLMOutput
    };
  }

  /**
   * OpenAI를 사용하여 Triple 추출
   */
  private async extractWithOpenAI(
    prompt: string,
    options: TripleExtractionOptions
  ): Promise<string> {
    if (!this.openaiClient) {
      throw new Error('OpenAI 클라이언트가 초기화되지 않았습니다.');
    }

    try {
      const model = mementoConfig.openaiLlmModel || 'gpt-4o-mini';
      const temperature = options.temperature ?? this.DEFAULT_TEMPERATURE;
      const maxTokens = options.maxTokens ?? this.DEFAULT_MAX_TOKENS;

      const response = await this.openaiClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a knowledge graph extractor. Extract triples (subject, predicate, object) from observations and return JSON format only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' } // JSON 모드 강제
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI 응답이 비어있습니다.');
      }

      // 비용 모니터링
      const promptTokens = response.usage?.prompt_tokens || 0;
      const completionTokens = response.usage?.completion_tokens || 0;
      this.updateCostMetrics('openai', promptTokens, completionTokens);

      return content;
    } catch (error) {
      logger.error('TripleExtractionService: OpenAI 호출 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Gemini를 사용하여 Triple 추출
   */
  private async extractWithGemini(
    prompt: string,
    options: TripleExtractionOptions
  ): Promise<string> {
    if (!this.geminiClient) {
      throw new Error('Gemini 클라이언트가 초기화되지 않았습니다.');
    }

    try {
      const modelName = mementoConfig.geminiModel || 'gemini-1.5-flash';
      const model = this.geminiClient.getGenerativeModel({ model: modelName });
      const temperature = options.temperature ?? this.DEFAULT_TEMPERATURE;
      const maxTokens = options.maxTokens ?? this.DEFAULT_MAX_TOKENS;

      const result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json'
        }
      });

      const response = result.response;
      const text = response.text();
      if (!text) {
        throw new Error('Gemini 응답이 비어있습니다.');
      }

      // 비용 모니터링 (Gemini는 usage 정보를 직접 제공하지 않으므로 대략적 추정)
      const estimatedPromptTokens = Math.ceil(prompt.length / 4);
      const estimatedCompletionTokens = Math.ceil(text.length / 4);
      this.updateCostMetrics('gemini', estimatedPromptTokens, estimatedCompletionTokens);

      return text;
    } catch (error) {
      logger.error('TripleExtractionService: Gemini 호출 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Ollama를 사용하여 Triple 추출
   */
  private async extractWithOllama(
    prompt: string,
    options: TripleExtractionOptions
  ): Promise<string> {
    const baseUrl = mementoConfig.ollamaBaseUrl || 'http://localhost:11434';
    const model = mementoConfig.ollamaModel || 'llama3';
    const temperature = options.temperature ?? this.DEFAULT_TEMPERATURE;
    const maxTokens = options.maxTokens ?? this.DEFAULT_MAX_TOKENS;

    const requestBody = {
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a knowledge graph extractor. Extract triples (subject, predicate, object) from observations and return JSON format only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      options: {
        temperature,
        num_predict: maxTokens
      },
      format: 'json' as const
    };

    try {
      // Ollama 모델 존재 여부 확인
      const modelExists = await this.checkOllamaModel(baseUrl, model);
      if (!modelExists) {
        throw new Error(
          `Ollama 모델 '${model}'이 설치되지 않았습니다. ` +
          `다음 명령어로 모델을 설치하세요: ollama pull ${model}`
        );
      }

      const apiUrl = `${baseUrl}/api/chat`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000) // 60초 타임아웃
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Ollama API 호출 실패: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
      }

      // NDJSON 형식 처리
      const contentType = response.headers.get('content-type') || '';
      const isNDJSON = contentType.includes('application/x-ndjson') || contentType.includes('ndjson');
      
      let content = '';
      const responseText = await response.text();

      if (isNDJSON) {
        const lines = responseText.trim().split('\n').filter(line => line.trim().length > 0);
        const contentParts: string[] = [];
        
        for (const line of lines) {
          try {
            const lineData = JSON.parse(line);
            if (lineData.message?.content) {
              contentParts.push(lineData.message.content);
            }
            if (lineData.done === true) {
              break;
            }
          } catch {
            // 라인 파싱 실패 시 무시
          }
        }
        content = contentParts.join('');
      } else {
        const data = JSON.parse(responseText);
        content = data.message?.content || '';
      }

      if (!content) {
        throw new Error('Ollama 응답이 비어있습니다.');
      }

      // 비용 모니터링 (Ollama는 로컬이므로 비용 0, 토큰 수만 추적)
      const estimatedPromptTokens = Math.ceil(prompt.length / 4);
      const estimatedCompletionTokens = Math.ceil(content.length / 4);
      this.updateCostMetrics('ollama', estimatedPromptTokens, estimatedCompletionTokens);

      return content;
    } catch (error) {
      logger.error('TripleExtractionService: Ollama 호출 실패', {
        error: error instanceof Error ? error.message : String(error),
        baseUrl,
        model
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
    } catch {
      return false;
    }
  }

  /**
   * LLM 응답을 파싱하여 Triple 배열 추출
   * 
   * @param responseText LLM 원본 응답 텍스트
   * @returns 파싱 결과 (success, triples, error)
   */
  private parseLLMResponse(responseText: string): { success: boolean; triples: Triple[]; error?: string; errorType?: 'parse' | 'structure' | 'no_triple' } {
    try {
      // JSON 추출 (마크다운 코드 블록 제거)
      let jsonText = this.extractJSON(responseText);
      if (!jsonText) {
        jsonText = responseText.trim();
      }

      // JSON 파싱
      const parsed = JSON.parse(jsonText);

      // triples 배열 추출
      if (!parsed.triples || !Array.isArray(parsed.triples)) {
        return {
          success: false,
          triples: [],
          error: 'triples 배열이 없거나 유효하지 않습니다.',
          errorType: 'parse'
        };
      }

      // Triple 유효성 검증
      const validTriples: Triple[] = [];
      
      for (const triple of parsed.triples) {
        if (this.isValidTriple(triple)) {
          validTriples.push({
            subject: String(triple.subject).trim(),
            predicate: String(triple.predicate).trim(),
            object: String(triple.object).trim()
          });
        }
      }

      // 모든 triple이 유효하지 않은 경우
      if (validTriples.length === 0 && parsed.triples.length > 0) {
        return {
          success: false,
          triples: [],
          error: '모든 triple이 유효하지 않습니다.',
          errorType: 'no_triple'
        };
      }

      // 일부 triple만 유효한 경우 (유효한 것만 반환, ambiguous_structure는 별도 감지)
      // 대부분이 유효하지 않으면 ambiguous_structure로 분류
      const invalidRatio = (parsed.triples.length - validTriples.length) / parsed.triples.length;
      if (invalidRatio > 0.5 && parsed.triples.length > 1) {
        // 유효한 triple은 반환하되, 구조가 모호함을 표시
        return {
          success: true,
          triples: validTriples,
          error: `일부 triple이 유효하지 않습니다. (유효: ${validTriples.length}/${parsed.triples.length})`,
          errorType: 'structure'
        };
      }

      return {
        success: true,
        triples: validTriples
      };
    } catch (error) {
      return {
        success: false,
        triples: [],
        error: error instanceof Error ? error.message : 'JSON 파싱 실패',
        errorType: 'parse'
      };
    }
  }

  /**
   * JSON 텍스트에서 JSON 객체 추출
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

    // 첫 번째 '{'부터 마지막 '}'까지 추출
    const firstBrace = jsonText.indexOf('{');
    const lastBrace = jsonText.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    return jsonText.substring(firstBrace, lastBrace + 1).trim();
  }

  /**
   * Triple 유효성 검증
   */
  private isValidTriple(triple: any): boolean {
    return (
      triple &&
      typeof triple === 'object' &&
      typeof triple.subject === 'string' &&
      typeof triple.predicate === 'string' &&
      typeof triple.object === 'string' &&
      triple.subject.trim().length > 0 &&
      triple.predicate.trim().length > 0 &&
      triple.object.trim().length > 0
    );
  }

  /**
   * 비용 메트릭 업데이트
   */
  private updateCostMetrics(
    provider: 'openai' | 'gemini' | 'ollama',
    promptTokens: number,
    completionTokens: number
  ): void {
    this.costMetrics.totalCalls += 1;
    this.costMetrics.totalTokens += promptTokens + completionTokens;

    // 비용 계산 (간단한 추정)
    let cost = 0;
    if (provider === 'openai') {
      // GPT-4o-mini 기준: $0.15 / 1M input tokens, $0.60 / 1M output tokens
      cost = (promptTokens / 1_000_000) * 0.15 + (completionTokens / 1_000_000) * 0.60;
    } else if (provider === 'gemini') {
      // Gemini 1.5 Flash 기준: $0.075 / 1M input tokens, $0.30 / 1M output tokens
      cost = (promptTokens / 1_000_000) * 0.075 + (completionTokens / 1_000_000) * 0.30;
    }
    // Ollama는 로컬이므로 비용 0

    this.costMetrics.totalCost += cost;
  }

  /**
   * 실패 사유 분류
   * 에러 타입과 컨텍스트를 기반으로 적절한 실패 사유를 반환합니다.
   * 
   * @param error 에러 메시지 또는 파싱 결과의 error
   * @param rawLLMOutput 원본 LLM 응답 (선택사항)
   * @param errorType 파싱 결과의 에러 타입 (선택사항)
   * @returns 분류된 실패 사유
   */
  private classifyFailureReason(
    error?: string,
    rawLLMOutput?: string,
    errorType?: 'parse' | 'structure' | 'no_triple'
  ): TripleExtractionFailureReason {
    // errorType이 명시된 경우 우선 사용
    if (errorType === 'parse') {
      return 'llm_parse_fail';
    }
    if (errorType === 'structure') {
      return 'ambiguous_structure';
    }
    if (errorType === 'no_triple') {
      return 'no_triple';
    }

    // errorType이 없으면 에러 메시지 기반으로 분류
    if (!error) {
      return 'no_triple';
    }

    const errorLower = error.toLowerCase();

    // JSON 파싱 관련 에러
    if (
      errorLower.includes('json') ||
      errorLower.includes('parse') ||
      errorLower.includes('syntax') ||
      errorLower.includes('triples 배열이 없거나')
    ) {
      return 'llm_parse_fail';
    }

    // 구조 관련 에러 (모호한 구조)
    if (
      errorLower.includes('구조') ||
      errorLower.includes('structure') ||
      errorLower.includes('ambiguous') ||
      errorLower.includes('유효하지 않습니다')
    ) {
      return 'ambiguous_structure';
    }

    // Triple이 없는 경우
    if (
      errorLower.includes('triple') && 
      (errorLower.includes('없') || errorLower.includes('empty') || errorLower.includes('no'))
    ) {
      return 'no_triple';
    }

    // 기본값: 파싱 실패로 간주
    return 'llm_parse_fail';
  }

  /**
   * Triple 추출 결과 로깅
   * rawLLMOutput 저장 정책에 따라 로그 파일에 저장합니다.
   * 
   * 저장 정책:
   * - 성공 케이스: 10% 샘플링
   * - 실패 케이스: 100% 저장
   * - PII 마스킹은 로거에서 처리
   * 
   * @param result Triple 추출 결과
   * @param memoryId Episodic Memory ID (선택사항)
   * @param observation Observation 텍스트 (선택사항)
   * @param rawLLMOutput 원본 LLM 응답 (로깅용)
   */
  private async logExtractionResult(
    result: TripleExtractionResult,
    memoryId: string | undefined,
    observation: string | undefined,
    rawLLMOutput: string
  ): Promise<void> {
    const isSuccess = result.triples.length > 0;
    const isFailure = !isSuccess || result.extractionInfo.failureReason !== undefined;

    // 저장 정책 적용
    let shouldLog = false;

    if (isFailure) {
      // 실패 케이스: 100% 저장
      shouldLog = true;
    } else if (isSuccess) {
      // 성공 케이스: 10% 샘플링
      shouldLog = Math.random() < this.SUCCESS_SAMPLING_RATE;
    }

    if (!shouldLog) {
      return;
    }

    // rawLLMOutput을 포함하여 로깅
    // 로거에서 PII 마스킹을 처리하므로 원본 rawLLMOutput 전달
    const resultWithRawOutput: TripleExtractionResult = {
      ...result,
      extractionInfo: {
        ...result.extractionInfo,
        rawLLMOutput // 로거에서 마스킹 처리
      }
    };

    await tripleExtractionLogger.logExtraction(
      resultWithRawOutput,
      memoryId,
      observation
    );
  }

  /**
   * 에러 타입 분류
   * 에러의 특성에 따라 분류하여 적절한 처리 전략을 수립합니다.
   * 
   * @param error 에러 객체
   * @returns 에러 타입
   */
  private classifyErrorType(error: unknown): 'network' | 'api_key' | 'rate_limit' | 'timeout' | 'unknown' {
    if (!(error instanceof Error)) {
      return 'unknown';
    }

    const errorMessage = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();

    // 네트워크 오류
    if (
      errorMessage.includes('network') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('enotfound') ||
      errorMessage.includes('timeout') ||
      errorName.includes('network')
    ) {
      return 'network';
    }

    // API 키 오류
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

    // Rate Limit 오류
    if (
      errorMessage.includes('rate limit') ||
      errorMessage.includes('ratelimit') ||
      errorMessage.includes('too many requests') ||
      errorMessage.includes('429')
    ) {
      return 'rate_limit';
    }

    // 타임아웃 오류
    if (
      errorMessage.includes('timeout') ||
      errorMessage.includes('timed out') ||
      errorName.includes('timeout')
    ) {
      return 'timeout';
    }

    return 'unknown';
  }

  /**
   * Triple 추출 단계별 성공 여부 추적
   * 각 triple에 대해 canonicalization과 entityLinking을 수행하여 steps를 생성합니다.
   * 
   * @param triples 추출된 triple 배열
   * @returns 추적된 steps 정보
   */
  private trackExtractionSteps(triples: Triple[]): ExtractionSteps {
    let canonicalizationSuccess = false;
    let entityLinkingSuccess = false;

    // Triple이 없으면 모두 false 반환
    if (triples.length === 0) {
      return {
        canonicalization: false,
        entityLinking: false
      };
    }

    // 각 triple에 대해 정규화 수행
    for (const triple of triples) {
      // Predicate 정규화 (Canonicalization)
      if (!canonicalizationSuccess) {
        const canonicalResult = this.canonicalizer.canonicalize(triple.predicate);
        if (canonicalResult.success) {
          canonicalizationSuccess = true;
        }
      }

      // Subject Entity Linking
      if (!entityLinkingSuccess) {
        const subjectResult = this.entityLinker.link(triple.subject);
        if (subjectResult.success) {
          entityLinkingSuccess = true;
        }
      }

      // Object Entity Linking
      if (!entityLinkingSuccess) {
        const objectResult = this.entityLinker.link(triple.object);
        if (objectResult.success) {
          entityLinkingSuccess = true;
        }
      }

      // 둘 다 성공했으면 조기 종료
      if (canonicalizationSuccess && entityLinkingSuccess) {
        break;
      }
    }

    return {
      canonicalization: canonicalizationSuccess,
      entityLinking: entityLinkingSuccess
    };
  }

  /**
   * 실패 결과 생성
   * 
   * @param failureReason 실패 사유
   * @param rawLLMOutput 원본 LLM 응답 또는 에러 메시지 (선택사항)
   * @returns 실패 결과
   */
  private createFailureResult(
    failureReason: TripleExtractionFailureReason,
    rawLLMOutput?: string
  ): TripleExtractionResult {
    const extractionInfo: ExtractionInfo = {
      failureReason,
      steps: {
        canonicalization: false,
        entityLinking: false
      },
      rawLLMOutput: rawLLMOutput
    };

    return {
      triples: [],
      extractionInfo
    };
  }

  /**
   * 비용 통계 조회
   */
  getCostMetrics(): LLMCostMetrics {
    return { ...this.costMetrics };
  }

  /**
   * Triple 추출 통계 조회
   * 
   * PRD 8.1: Triple 추출 통계
   * - 성공률: 성공한 Triple 추출 수 / 전체 시도 수
   * - 평균 추출 시간
   * - LLM 호출 횟수 및 비용
   * - 실패 사유별 통계
   * 
   * @returns Triple 추출 통계
   */
  getStatistics() {
    return this.statistics.getStatistics();
  }

  /**
   * 실패 사유별 통계 조회
   * 
   * PRD 8.1: 실패 사유별 통계
   * 
   * @returns 실패 사유별 통계
   */
  getFailureReasonStatistics() {
    return this.statistics.getFailureReasonStatistics();
  }
}


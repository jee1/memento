/**
 * MiniLM 임베딩 서비스
 * all-MiniLM-L6-v2 모델을 사용한 경량 임베딩 서비스
 * 
 * 클린코드 원칙:
 * - 단일 책임 원칙: 임베딩 생성만 담당
 * - 의존성 역전: 인터페이스에 의존
 * - 개방-폐쇄: 확장에는 열려있고 수정에는 닫혀있음
 */

import { pipeline, env } from '@xenova/transformers';
import type { 
  EmbeddingServiceInterface, 
  EmbeddingResult, 
  SimilarityResult, 
  EmbeddingData 
} from '../../../types/embedding.types.js';

// Node.js 환경에서 Worker 스레드 사용 비활성화
// 이는 ERR_WORKER_PATH 에러를 방지합니다
if (typeof process !== 'undefined' && process.env) {
  // 환경 변수가 설정되지 않은 경우에만 기본값 설정
  if (!process.env.ENABLE_WORKER) {
    env.useBrowserCache = false;
    env.useCustomCache = false;
    // Worker 스레드 완전 비활성화를 위한 추가 설정
    // MCP 서버와 HTTP 서버 간 일관성을 위해 명시적 설정
    if (typeof env.allowLocalModels === 'undefined') {
      env.allowLocalModels = false;
    }
    // WASM 백엔드 사용 (Worker 스레드 없이 동작)
    if (typeof env.backends === 'undefined') {
      // env.backends는 공식 지원 여부가 불확실하므로 주석 처리
      // env.backends = { onnx: 'cpu' };
    }
  }
}

export class MiniLMEmbeddingService implements EmbeddingServiceInterface {
  // 상수 정의
  private static readonly MODEL_NAME = 'all-MiniLM-L6-v2';
  private static readonly DIMENSIONS = 384;
  private static readonly MAX_TOKENS = 256;
  private static readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간
  
  private readonly modelName = MiniLMEmbeddingService.MODEL_NAME;
  private readonly dimensions = MiniLMEmbeddingService.DIMENSIONS;
  private readonly maxTokens = MiniLMEmbeddingService.MAX_TOKENS;
  private model: any = null;
  private loadingPromise: Promise<any> | null = null;
  private readonly cache = new Map<string, EmbeddingResult>();

  constructor() {
    // stderr로 로그 출력 (MCP 프로토콜 준수)
    process.stderr.write('✅ MiniLM 임베딩 서비스 초기화 완료\n');
  }

  /**
   * 텍스트를 임베딩 벡터로 변환
   * TDD: 빈 텍스트 검증, 모델 로딩, 캐싱 적용
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult | null> {
    this.validateInput(text);
    
    const cacheKey = this.generateCacheKey(text);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const model = await this.getModel();
      const processedText = this.preprocessText(text);
      
      const result = await model(processedText, {
        pooling: 'mean',
        normalize: true
      });

      // result가 이미 배열이거나 data 속성을 가진 객체일 수 있음
      const embedding = Array.isArray(result) ? result : Array.from(result.data || result);
      const embeddingResult: EmbeddingResult = {
        embedding,
        model: this.modelName,
        usage: {
          prompt_tokens: this.estimateTokens(text),
          total_tokens: this.estimateTokens(text)
        }
      };

      this.cache.set(cacheKey, embeddingResult);
      return embeddingResult;

    } catch (error) {
      console.error('❌ MiniLM 임베딩 생성 실패:', error);
      throw new Error(`MiniLM 임베딩 생성 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 쿼리와 유사한 임베딩 검색
   * TDD: 빈 배열 처리, 임계값 적용, 개수 제한
   */
  async searchSimilar(
    query: string,
    embeddings: EmbeddingData[],
    limit: number = 10,
    threshold: number = 0.7
  ): Promise<SimilarityResult[]> {
    if (embeddings.length === 0) {
      return [];
    }

    const queryEmbedding = await this.generateEmbedding(query);
    if (!queryEmbedding) {
      return [];
    }

    const similarities = embeddings.map(item => {
      const similarity = this.calculateCosineSimilarity(
        queryEmbedding.embedding, 
        item.embedding
      );
      return {
        id: item.id,
        content: item.content,
        similarity,
        score: similarity
      };
    });

    return similarities
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * 서비스 사용 가능 여부 확인
   * TDD: 모델 로딩 상태 확인
   */
  isAvailable(): boolean {
    // MiniLM은 항상 사용 가능 (모델이 로드되지 않아도 사용 가능)
    // 실제 모델 로딩은 generateEmbedding 호출 시 lazy loading
    return true;
  }

  /**
   * 모델 정보 반환
   * TDD: 올바른 정보 반환
   */
  getModelInfo(): { model: string; dimensions: number; maxTokens: number } {
    return {
      model: this.modelName,
      dimensions: this.dimensions,
      maxTokens: this.maxTokens
    };
  }

  /**
   * 입력 검증
   * 클린코드: 단일 책임 원칙 - 검증만 담당
   */
  private validateInput(text: string): void {
    if (!text || text.trim().length === 0) {
      throw new Error('텍스트가 비어있습니다');
    }
  }

  /**
   * 모델 로딩 (지연 로딩)
   * 클린코드: 단일 책임 원칙 - 모델 로딩만 담당
   */
  private async getModel(): Promise<any> {
    if (this.model) {
      return this.model;
    }

    if (this.loadingPromise) {
      return await this.loadingPromise;
    }

    this.loadingPromise = this.loadModel();
    this.model = await this.loadingPromise;
    return this.model;
  }

  /**
   * 실제 모델 로딩
   * Node.js 환경에서 Worker 스레드 문제를 방지하기 위해 옵션 설정
   */
  private async loadModel(): Promise<any> {
    try {
      // Node.js 환경에서 Worker 스레드 사용을 비활성화
      // 이는 ERR_WORKER_PATH 에러를 방지합니다
      const model = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        {
          // quantized 모델 사용 (메모리 사용량 감소)
          quantized: true
        }
      );
      console.log('✅ MiniLM 모델 로딩 완료');
      return model;
    } catch (error) {
      // ERR_WORKER_PATH 에러는 Node.js 환경에서 onnxruntime-web의 Worker가 
      // blob URL을 지원하지 않아 발생하는 환경 문제입니다.
      // 이 경우 경고만 출력하고 fallback(TF-IDF)이 사용되도록 합니다.
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isWorkerPathError = errorMessage.includes('ERR_WORKER_PATH') || 
                                errorMessage.includes('blob:nodedata');
      
      // 에러 로깅을 한 번만 출력하도록 조건부 처리
      if (!(global as any).__minilmModelLoadWarningShown) {
        if (isWorkerPathError) {
          console.warn('⚠️ MiniLM 모델 로딩 실패 (Node.js 환경 제한, TF-IDF fallback 사용):', errorMessage);
          console.warn('💡 해결 방법: 환경 변수 ENABLE_WORKER=false 설정 또는 onnxruntime-node 설치 확인');
        } else {
          console.error('❌ MiniLM 모델 로딩 실패:', error);
        }
        (global as any).__minilmModelLoadWarningShown = true;
      }
      
      throw new Error(`모델 로딩 실패: ${errorMessage}`);
    }
  }

  /**
   * 텍스트 전처리
   * 클린코드: 단일 책임 원칙 - 전처리만 담당
   */
  private preprocessText(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .substring(0, this.maxTokens * 4); // 토큰 수 제한
  }

  /**
   * 캐시 키 생성
   */
  private generateCacheKey(text: string): string {
    return `minilm:${this.hashText(text)}`;
  }

  /**
   * 텍스트 해시 생성
   */
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit 정수로 변환
    }
    return hash.toString(36);
  }

  /**
   * 토큰 수 추정
   */
  private estimateTokens(text: string): number {
    // 간단한 토큰 추정 (실제로는 더 정교한 방법 필요)
    return Math.ceil(text.length / 4);
  }

  /**
   * 코사인 유사도 계산
   * 클린코드: 단일 책임 원칙 - 수학 계산만 담당
   */
  private calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('벡터 차원이 일치하지 않습니다');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      const a = vecA[i] ?? 0;
      const b = vecB[i] ?? 0;
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * 캐시 정리
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 메모리 사용량 확인
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

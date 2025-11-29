/**
 * 통합 임베딩 서비스
 * 4가지 임베딩 제공자 중 선택하여 사용
 * 
 * 클린코드 원칙:
 * - 단일 책임 원칙: 임베딩 서비스 통합만 담당
 * - 의존성 역전: 팩토리에 의존
 * - 전략 패턴: 제공자 선택 로직 분리
 */

import type { 
  EmbeddingServiceInterface, 
  EmbeddingResult, 
  SimilarityResult, 
  EmbeddingData,
  EmbeddingProvider 
} from '../../../../shared/types/embedding.types.js';
import { EmbeddingProviderFactory } from '../providers/embedding-provider-factory.js';

/**
 * 통합 임베딩 서비스
 * 순환 의존성을 방지하기 위해 팩토리 패턴 사용
 */
export class UnifiedEmbeddingService implements EmbeddingServiceInterface {
  private factory: EmbeddingProviderFactory;
  private currentProvider: EmbeddingServiceInterface | null = null;
  private currentProviderName: EmbeddingProvider | null = null;
  private fallbackProviders: EmbeddingProvider[] = ['minilm', 'openai', 'gemini', 'tfidf'];

  constructor() {
    this.factory = EmbeddingProviderFactory.getInstance();
    // stderr로 로그 출력 (MCP 프로토콜 준수)
    process.stderr.write('✅ 통합 임베딩 서비스 초기화 완료\n');
    this.syncFallbackProviders();
    process.stderr.write(`📋 사용 가능한 제공자: ${this.factory.getAvailableProviders().map(p => p.name).join(', ')}\n`);
  }

  /**
   * 텍스트를 임베딩 벡터로 변환
   * TDD: 제공자 선택, 폴백 처리, 에러 핸들링
   */
  async generateEmbedding(text: string, preferredProvider?: EmbeddingProvider): Promise<EmbeddingResult | null> {
    this.validateInput(text);

    try {
      const selection = await this.selectProvider(preferredProvider);
      if (!selection) {
        throw new Error('사용 가능한 임베딩 제공자가 없습니다');
      }

      this.currentProvider = selection.service;
      this.currentProviderName = selection.provider;
      const result = await selection.service.generateEmbedding(text);
      
      if (result) {
        // provider 정보 추가
        result.provider = selection.provider;
        console.log(`✅ 임베딩 생성 완료 (${selection.provider})`);
        return result;
      }

      // 폴백 시도
      return await this.tryFallbackProviders(text);

    } catch (error) {
      console.error('❌ 임베딩 생성 실패:', error);
      this.handleProviderFailure(this.currentProviderName);
      
      // 폴백 시도
      try {
        return await this.tryFallbackProviders(text);
      } catch (fallbackError) {
        throw new Error(`모든 임베딩 제공자 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * 쿼리와 유사한 임베딩 검색
   * TDD: 제공자 선택, 폴백 처리
   */
  async searchSimilar(
    query: string,
    embeddings: EmbeddingData[],
    limit: number = 10,
    threshold: number = 0.7,
    preferredProvider?: EmbeddingProvider
  ): Promise<SimilarityResult[]> {
    this.validateInput(query);

    try {
      const provider = await this.selectProvider(preferredProvider);
      if (!provider) {
        throw new Error('사용 가능한 임베딩 제공자가 없습니다');
      }

      this.currentProvider = provider.service;
      this.currentProviderName = provider.provider;
      const results = await provider.service.searchSimilar(query, embeddings, limit, threshold);
      
      if (results.length > 0) {
        console.log(`✅ 유사도 검색 완료 (${this.getCurrentProviderName()})`);
        return results;
      }

      // 폴백 시도
      return await this.tryFallbackSearch(query, embeddings, limit, threshold);

    } catch (error) {
      console.error('❌ 유사도 검색 실패:', error);
      this.handleProviderFailure(this.currentProviderName);
      
      // 폴백 시도
      try {
        return await this.tryFallbackSearch(query, embeddings, limit, threshold);
      } catch (fallbackError) {
        console.warn('⚠️ 모든 제공자 실패, 빈 결과 반환');
        return [];
      }
    }
  }

  /**
   * 서비스 사용 가능 여부 확인
   * TDD: 최소 하나의 제공자라도 사용 가능해야 함
   */
  isAvailable(): boolean {
    const availableProviders = this.factory.getAvailableProviders();
    return availableProviders.some(p => p.available);
  }

  /**
   * 현재 사용 중인 모델 정보 반환
   */
  getModelInfo(): { model: string; dimensions: number; maxTokens: number } {
    if (this.currentProvider) {
      return this.currentProvider.getModelInfo();
    }

    // 기본값 반환 (MiniLM 기준)
    return {
      model: 'unified-embedding',
      dimensions: 384,
      maxTokens: 256
    };
  }

  /**
   * 사용 가능한 제공자 목록 반환
   */
  getAvailableProviders(): string[] {
    return this.factory.getAvailableProviders()
      .filter(p => p.available)
      .map(p => p.name);
  }

  /**
   * 현재 사용 중인 제공자 이름 반환
   */
  getCurrentProviderName(): string {
    return this.currentProviderName ?? 'none';
  }

  /**
   * 폴백 제공자 설정
   */
  setFallbackProviders(providers: EmbeddingProvider[]): void {
    this.fallbackProviders = Array.from(new Set(providers)) as EmbeddingProvider[];
    this.syncFallbackProviders();
  }

  private syncFallbackProviders(): void {
    const orderedProviders = this.factory.getAvailableProviders().map(p => p.name as EmbeddingProvider);
    const merged = [...orderedProviders, ...this.fallbackProviders];
    this.fallbackProviders = Array.from(new Set(merged)) as EmbeddingProvider[];
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
   * 제공자 선택
   * 클린코드: 단일 책임 원칙 - 선택 로직만 담당
   */
  private async selectProvider(
    preferredProvider?: EmbeddingProvider
  ): Promise<{ service: EmbeddingServiceInterface; provider: EmbeddingProvider } | null> {
    const { service, decision } = await this.factory.selectProviderWithHealthCheck(preferredProvider);
    this.syncFallbackProviders();
    if (!service) {
      return null;
    }
    return { service, provider: decision.selectedProvider };
  }

  /**
   * 폴백 제공자 시도
   * 클린코드: 단일 책임 원칙 - 폴백 처리만 담당
   */
  private async tryFallbackProviders(text: string): Promise<EmbeddingResult | null> {
    const { service, decision } = await this.factory.selectProviderWithHealthCheck();
    if (!service) {
      throw new Error('모든 폴백 제공자 실패');
    }
    console.log(`🔄 폴백 시도: ${decision.selectedProvider}`);
    const result = await service.generateEmbedding(text);
    if (result) {
      this.currentProvider = service;
      this.currentProviderName = decision.selectedProvider;
      result.provider = decision.selectedProvider;
      return result;
    }
    throw new Error('모든 폴백 제공자 실패');
  }

  /**
   * 폴백 검색 시도
   */
  private async tryFallbackSearch(
    query: string,
    embeddings: EmbeddingData[],
    limit: number,
    threshold: number
  ): Promise<SimilarityResult[]> {
    const { service, decision } = await this.factory.selectProviderWithHealthCheck();
    if (!service) {
      return [];
    }
    console.log(`🔄 폴백 검색 시도: ${decision.selectedProvider}`);
    const results = await service.searchSimilar(query, embeddings, limit, threshold);
    if (results.length > 0) {
      this.currentProvider = service;
      this.currentProviderName = decision.selectedProvider;
      return results;
    }
    return [];
  }

  private handleProviderFailure(provider: EmbeddingProvider | null): void {
    if (!provider) {
      return;
    }
    this.factory.handleProviderFailure(provider);
  }
}

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
} from '../types/embedding.types.js';
import { EmbeddingProviderFactory } from './embedding-provider-factory.js';

/**
 * 통합 임베딩 서비스
 * 순환 의존성을 방지하기 위해 팩토리 패턴 사용
 */
export class UnifiedEmbeddingService implements EmbeddingServiceInterface {
  private factory: EmbeddingProviderFactory;
  private currentProvider: EmbeddingServiceInterface | null = null;
  private fallbackProviders: EmbeddingProvider[] = ['minilm', 'openai', 'gemini', 'tfidf'];

  constructor() {
    this.factory = EmbeddingProviderFactory.getInstance();
    console.log('✅ 통합 임베딩 서비스 초기화 완료');
    console.log(`📋 사용 가능한 제공자: ${this.factory.getAvailableProviders().map(p => p.name).join(', ')}`);
  }

  /**
   * 텍스트를 임베딩 벡터로 변환
   * TDD: 제공자 선택, 폴백 처리, 에러 핸들링
   */
  async generateEmbedding(text: string, preferredProvider?: EmbeddingProvider): Promise<EmbeddingResult | null> {
    this.validateInput(text);

    try {
      const provider = this.selectProvider(preferredProvider);
      if (!provider) {
        throw new Error('사용 가능한 임베딩 제공자가 없습니다');
      }

      this.currentProvider = provider;
      const result = await provider.generateEmbedding(text);
      
      if (result) {
        // provider 정보 추가
        const providerName = this.getCurrentProviderName();
        result.provider = providerName as EmbeddingProvider;
        console.log(`✅ 임베딩 생성 완료 (${providerName})`);
        return result;
      }

      // 폴백 시도
      return await this.tryFallbackProviders(text);

    } catch (error) {
      console.error('❌ 임베딩 생성 실패:', error);
      
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
      const provider = this.selectProvider(preferredProvider);
      if (!provider) {
        throw new Error('사용 가능한 임베딩 제공자가 없습니다');
      }

      this.currentProvider = provider;
      const results = await provider.searchSimilar(query, embeddings, limit, threshold);
      
      if (results.length > 0) {
        console.log(`✅ 유사도 검색 완료 (${this.getCurrentProviderName()})`);
        return results;
      }

      // 폴백 시도
      return await this.tryFallbackSearch(query, embeddings, limit, threshold);

    } catch (error) {
      console.error('❌ 유사도 검색 실패:', error);
      
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
    if (!this.currentProvider) {
      return 'none';
    }

    try {
      const availableProviders = this.factory.getAvailableProviders();
      if (!availableProviders) {
        return 'unknown';
      }
      
      const current = availableProviders.find(p => 
        this.factory.getProvider(p.name) === this.currentProvider
      );
      
      return current?.name || 'unknown';
    } catch (error) {
      console.error('❌ 현재 제공자 이름 조회 실패:', error);
      return 'unknown';
    }
  }

  /**
   * 폴백 제공자 설정
   */
  setFallbackProviders(providers: EmbeddingProvider[]): void {
    this.fallbackProviders = providers;
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
  private selectProvider(preferredProvider?: EmbeddingProvider): EmbeddingServiceInterface | null {
    return this.factory.selectProvider(preferredProvider);
  }

  /**
   * 폴백 제공자 시도
   * 클린코드: 단일 책임 원칙 - 폴백 처리만 담당
   */
  private async tryFallbackProviders(text: string): Promise<EmbeddingResult | null> {
    for (const providerName of this.fallbackProviders) {
      try {
        const provider = this.factory.getProvider(providerName);
        if (provider && provider.isAvailable()) {
          console.log(`🔄 폴백 시도: ${providerName}`);
          const result = await provider.generateEmbedding(text);
          if (result) {
            this.currentProvider = provider;
            result.provider = providerName;
            return result;
          }
        }
      } catch (error) {
        console.warn(`⚠️ 폴백 제공자 ${providerName} 실패:`, error);
        continue;
      }
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
    for (const providerName of this.fallbackProviders) {
      try {
        const provider = this.factory.getProvider(providerName);
        if (provider && provider.isAvailable()) {
          console.log(`🔄 폴백 검색 시도: ${providerName}`);
          const results = await provider.searchSimilar(query, embeddings, limit, threshold);
          if (results.length > 0) {
            this.currentProvider = provider;
            return results;
          }
        }
      } catch (error) {
        console.warn(`⚠️ 폴백 검색 제공자 ${providerName} 실패:`, error);
        continue;
      }
    }
    
    return [];
  }
}

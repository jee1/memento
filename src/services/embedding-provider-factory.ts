/**
 * 임베딩 제공자 팩토리
 * 전략 패턴을 사용하여 순환 의존성 방지
 * 
 * 클린코드 원칙:
 * - 단일 책임 원칙: 제공자 생성만 담당
 * - 의존성 역전: 인터페이스에 의존
 * - 개방-폐쇄: 새로운 제공자 추가 용이
 */

import type { EmbeddingServiceInterface, EmbeddingProvider, ProviderInfo } from '../types/embedding.types.js';
import { mementoConfig } from '../config/index.js';
import { MiniLMEmbeddingService } from './minilm-embedding-service.js';
import { LightweightEmbeddingService } from './lightweight-embedding-service.js';
import { GeminiEmbeddingService } from './gemini-embedding-service.js';

/**
 * 임베딩 제공자 팩토리
 * 순환 의존성을 방지하기 위해 팩토리 패턴 사용
 */
export class EmbeddingProviderFactory {
  private static instance: EmbeddingProviderFactory;
  private providers: Map<EmbeddingProvider, EmbeddingServiceInterface> = new Map();

  private constructor() {
    this.initializeProviders();
  }

  /**
   * 싱글톤 인스턴스 반환
   */
  static getInstance(): EmbeddingProviderFactory {
    if (!EmbeddingProviderFactory.instance) {
      EmbeddingProviderFactory.instance = new EmbeddingProviderFactory();
    }
    return EmbeddingProviderFactory.instance;
  }

  /**
   * 제공자 초기화
   * 클린코드: 단일 책임 원칙 - 초기화만 담당
   */
  private initializeProviders(): void {
    this.providers.set('minilm', new MiniLMEmbeddingService());
    this.providers.set('tfidf', new LightweightEmbeddingService());
    this.providers.set('gemini', new GeminiEmbeddingService());
    // OpenAI는 설정에 따라 동적 생성
  }

  /**
   * 제공자 반환
   * 클린코드: 단일 책임 원칙 - 제공자 반환만 담당
   */
  getProvider(provider: EmbeddingProvider): EmbeddingServiceInterface | null {
    return this.providers.get(provider) || null;
  }

  /**
   * 사용 가능한 제공자 목록 반환
   * TDD: 각 제공자의 사용 가능 여부 확인
   */
  getAvailableProviders(): ProviderInfo[] {
    const providerInfos: ProviderInfo[] = [];

    // MiniLM
    const minilm = this.providers.get('minilm');
    providerInfos.push({
      name: 'minilm',
      available: minilm?.isAvailable() || false,
      priority: 1,
      cost: 'free',
      performance: 'high'
    });

    // TF-IDF (항상 사용 가능)
    const tfidf = this.providers.get('tfidf');
    providerInfos.push({
      name: 'tfidf',
      available: tfidf?.isAvailable() || false,
      priority: 4,
      cost: 'free',
      performance: 'low'
    });

    // Gemini
    const gemini = this.providers.get('gemini');
    providerInfos.push({
      name: 'gemini',
      available: gemini?.isAvailable() || false,
      priority: 2,
      cost: 'paid',
      performance: 'high'
    });

    // OpenAI (동적 생성)
    providerInfos.push({
      name: 'openai',
      available: this.isOpenAIAvailable(),
      priority: 3,
      cost: 'paid',
      performance: 'high'
    });

    return providerInfos.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 우선순위에 따른 제공자 선택
   * TDD: 사용 가능한 제공자 중 우선순위가 높은 것 선택
   */
  selectProvider(preferredProvider?: EmbeddingProvider): EmbeddingServiceInterface | null {
    const availableProviders = this.getAvailableProviders();
    
    // 1. 명시적으로 요청된 제공자 우선
    if (preferredProvider) {
      const preferred = availableProviders.find(p => p.name === preferredProvider && p.available);
      if (preferred) {
        console.log(`🎯 요청된 제공자 사용: ${preferredProvider}`);
        return this.getProvider(preferred.name);
      }
    }

    // 2. 설정에서 기본 제공자 사용
    const defaultProvider = mementoConfig.embeddingProvider;
    const defaultAvailable = availableProviders.find(p => p.name === defaultProvider && p.available);
    if (defaultAvailable) {
      console.log(`⚙️ 설정된 기본 제공자 사용: ${defaultProvider}`);
      return this.getProvider(defaultAvailable.name);
    }

    // 3. 사용 가능한 첫 번째 제공자 반환
    const firstAvailable = availableProviders.find(p => p.available);
    if (firstAvailable) {
      console.log(`🔄 사용 가능한 첫 번째 제공자 사용: ${firstAvailable.name}`);
      return this.getProvider(firstAvailable.name);
    }

    console.log('❌ 사용 가능한 제공자가 없습니다');
    return null;
  }

  /**
   * OpenAI 사용 가능 여부 확인
   * 클린코드: 단일 책임 원칙 - OpenAI 상태 확인만 담당
   */
  private isOpenAIAvailable(): boolean {
    // 환경 변수나 설정 확인
    return process.env.OPENAI_API_KEY !== undefined;
  }

  /**
   * 제공자 등록 (확장성)
   * 클린코드: 개방-폐쇄 원칙 - 확장에는 열려있음
   */
  registerProvider(provider: EmbeddingProvider, service: EmbeddingServiceInterface): void {
    this.providers.set(provider, service);
  }

  /**
   * 제공자 제거
   */
  unregisterProvider(provider: EmbeddingProvider): boolean {
    return this.providers.delete(provider);
  }

  /**
   * 모든 제공자 초기화
   */
  reset(): void {
    this.providers.clear();
    this.initializeProviders();
  }
}

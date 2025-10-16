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
import { OpenAIEmbeddingService } from './openai-embedding-service.js';

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
    this.providers.set('openai', new OpenAIEmbeddingService());
  }

  /**
   * 제공자 반환
   * 클린코드: 단일 책임 원칙 - 제공자 반환만 담당
   */
  getProvider(provider: EmbeddingProvider): EmbeddingServiceInterface | null {
    const normalized = this.normalizeProviderName(provider);
    if (!normalized) {
      return null;
    }
    return this.providers.get(normalized) || null;
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
      priority: 3,
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

    // OpenAI
    const openai = this.providers.get('openai');
    providerInfos.push({
      name: 'openai',
      available: openai?.isAvailable() || false,
      priority: 1,
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
      const normalizedPreferred = this.normalizeProviderName(preferredProvider);
      const preferred = normalizedPreferred
        ? availableProviders.find(p => p.name === normalizedPreferred && p.available)
        : undefined;
      if (preferred) {
        console.log(`🎯 요청된 제공자 사용: ${preferred.name}`);
        return this.getProvider(preferred.name);
      }
    }

    // 2. 설정에서 기본 제공자 사용
    const defaultProvider = this.normalizeProviderName(mementoConfig.embeddingProvider);
    const defaultAvailable = defaultProvider
      ? availableProviders.find(p => p.name === defaultProvider && p.available)
      : undefined;
    if (defaultAvailable) {
      console.log(`⚙️ 설정된 기본 제공자 사용: ${defaultAvailable.name}`);
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
    const openai = this.providers.get('openai');
    return openai?.isAvailable() ?? false;
  }

  /**
   * 제공자 등록 (확장성)
   * 클린코드: 개방-폐쇄 원칙 - 확장에는 열려있음
   */
  registerProvider(provider: EmbeddingProvider, service: EmbeddingServiceInterface): void {
    const normalized = this.normalizeProviderName(provider);
    if (!normalized) {
      return;
    }
    this.providers.set(normalized, service);
  }

  /**
   * 제공자 제거
   */
  unregisterProvider(provider: EmbeddingProvider): boolean {
    const normalized = this.normalizeProviderName(provider);
    return normalized ? this.providers.delete(normalized) : false;
  }

  /**
   * 모든 제공자 초기화
   */
  reset(): void {
    this.providers.clear();
    this.initializeProviders();
  }

  private normalizeProviderName(provider?: string | null): EmbeddingProvider | null {
    if (!provider) {
      return null;
    }
    const normalized = provider.toLowerCase();
    switch (normalized) {
      case 'tfidf':
        return 'tfidf';
      case 'minilm':
        return 'minilm';
      case 'openai':
        return 'openai';
      case 'gemini':
        return 'gemini';
      case 'lightweight':
        return 'tfidf';
      default:
        return null;
    }
  }
}

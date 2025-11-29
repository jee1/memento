/**
 * 임베딩 제공자 팩토리
 * 전략 패턴을 사용하여 순환 의존성 방지
 *
 * 클린코드 원칙:
 * - 단일 책임 원칙: 제공자 생성만 담당
 * - 의존성 역전: 인터페이스에 의존
 * - 개방-폐쇄: 새로운 제공자 추가 용이
 */

import type { EmbeddingServiceInterface, EmbeddingProvider, ProviderInfo } from '../../../../shared/types/embedding.types.js';
import type { ProviderFallbackDecision, ProviderHealthStatus } from '../../../../shared/types/embedding-provider-monitoring.types.js';
import { mementoConfig } from '../../../../shared/config/index.js';
import { MiniLMEmbeddingService } from '../services/minilm-embedding-service.js';
import { LightweightEmbeddingService } from '../services/lightweight-embedding-service.js';
import { GeminiEmbeddingService } from '../services/gemini-embedding-service.js';
import { OpenAIEmbeddingService } from '../services/openai-embedding-service.js';
import { ModelAvailabilityService } from '../domains/embedding/providers/model-availability-service.js';

/**
 * 임베딩 제공자 팩토리
 * 순환 의존성을 방지하기 위해 팩토리 패턴 사용
 */
export class EmbeddingProviderFactory {
  private static instance: EmbeddingProviderFactory;
  private providers: Map<EmbeddingProvider, EmbeddingServiceInterface> = new Map();
  private readonly availabilityService: ModelAvailabilityService;

  private constructor() {
    this.initializeProviders();
    this.availabilityService = new ModelAvailabilityService(
      provider => this.providers.get(provider) ?? null,
      () => this.getPriorityProviders()
    );
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
    this.providers.set('minilm', this.createService('minilm'));
    this.providers.set('tfidf', this.createService('tfidf'));
    this.providers.set('gemini', this.createService('gemini'));
    this.providers.set('openai', this.createService('openai'));
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
    const minilmStatus = this.availabilityService.getLastStatus('minilm');
    providerInfos.push({
      name: 'minilm',
      available: this.resolveAvailability('minilm', minilm, minilmStatus),
      priority: 3,
      cost: 'free',
      performance: 'high'
    });

    // TF-IDF (항상 사용 가능)
    const tfidf = this.providers.get('tfidf');
    providerInfos.push({
      name: 'tfidf',
      available: this.resolveAvailability('tfidf', tfidf, this.availabilityService.getLastStatus('tfidf')),
      priority: 4,
      cost: 'free',
      performance: 'low'
    });

    // Gemini
    const gemini = this.providers.get('gemini');
    const geminiStatus = this.availabilityService.getLastStatus('gemini');
    providerInfos.push({
      name: 'gemini',
      available: this.resolveAvailability('gemini', gemini, geminiStatus),
      priority: 2,
      cost: 'paid',
      performance: 'high'
    });

    // OpenAI
    const openai = this.providers.get('openai');
    const openaiStatus = this.availabilityService.getLastStatus('openai');
    providerInfos.push({
      name: 'openai',
      available: this.resolveAvailability('openai', openai, openaiStatus),
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

  async selectProviderWithHealthCheck(
    preferredProvider?: EmbeddingProvider
  ): Promise<{ service: EmbeddingServiceInterface | null; decision: ProviderFallbackDecision }> {
    const decision = await this.availabilityService.selectBestProvider(preferredProvider);
    const service = this.getProvider(decision.selectedProvider);
    return { service, decision };
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

  private resolveAvailability(
    provider: EmbeddingProvider,
    service: EmbeddingServiceInterface | undefined | null,
    status?: ProviderHealthStatus
  ): boolean {
    if (status) {
      return status.state === 'available';
    }
    return service?.isAvailable() ?? false;
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

  private getPriorityProviders(): EmbeddingProvider[] {
    return Array.from(this.providers.keys());
  }

  handleProviderFailure(provider: EmbeddingProvider): void {
    const normalized = this.normalizeProviderName(provider);
    if (!normalized) {
      return;
    }
    console.warn(`⚠️ ${normalized} 제공자 재초기화 시도`);
    this.providers.set(normalized, this.createService(normalized));
  }

  getProviderName(service: EmbeddingServiceInterface | null): EmbeddingProvider | null {
    if (!service) {
      return null;
    }
    for (const [name, instance] of this.providers.entries()) {
      if (instance === service) {
        return name;
      }
    }
    return null;
  }

  private createService(provider: EmbeddingProvider): EmbeddingServiceInterface {
    switch (provider) {
      case 'minilm':
        return new MiniLMEmbeddingService();
      case 'tfidf':
        return new LightweightEmbeddingService();
      case 'gemini':
        return new GeminiEmbeddingService();
      case 'openai':
        return new OpenAIEmbeddingService();
      default:
        return new LightweightEmbeddingService();
    }
  }
}

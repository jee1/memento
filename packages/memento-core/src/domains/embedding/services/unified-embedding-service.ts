/**
 * 통합 임베딩 서비스
 * 4가지 임베딩 제공자 중 선택하여 사용
 * 
 * 클린코드 원칙:
 * - 단일 책임 원칙: 임베딩 서비스 통합만 담당
 * - 의존성 역전: 팩토리에 의존
 * - 전략 패턴: 제공자 선택 로직 분리
 */

import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { isCliQuiet } from '../../../shared/utils/logger.js';
import type { 
  EmbeddingServiceInterface, 
  EmbeddingResult, 
  EmbeddingProvider 
} from '../../../shared/types/embedding.types.js';
import { EmbeddingProviderFactory } from '../providers/embedding-provider-factory.js';
import { VECTOR_SEARCH } from '../../../shared/config/constants.js';
import type { EmbeddingRole } from '../../../shared/config/embedding-models.js';
import { LocalEmbeddingService } from './local-embedding-service.js';

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
    // 초기화 로그는 MCP 프로토콜 준수를 위해 출력하지 않음
    this.syncFallbackProviders();
  }

  /**
   * 저장할 글을 기억 벡터로 변환
   * TDD: 제공자 선택, 폴백 처리, 에러 핸들링
   */
  async generateEmbedding(text: string, preferredProvider?: EmbeddingProvider): Promise<EmbeddingResult | null> {
    return this.embed(text, 'passage', preferredProvider);
  }

  /**
   * 지정한 제공자만으로 기억 벡터를 만든다 (#1729). 실패하면 다른 제공자로 넘어가지 않고 throw 한다.
   * 재색인과 모델 이주가 쓴다. 넘어가면 원문이 외부 임베딩 API 로 나가거나 다른 제공자 행이 쌓인다.
   */
  async generateEmbeddingStrict(text: string, provider: EmbeddingProvider): Promise<EmbeddingResult> {
    this.validateInput(text);
    // offline strict 에서 원격 제공자는 getProvider 가 throw 한다.
    const service = this.factory.getProvider(provider);
    if (!service) {
      throw new Error(`임베딩 제공자 ${provider} 를 쓸 수 없습니다`);
    }
    const result = await service.generateEmbedding(text);
    if (!result) {
      throw new Error(`임베딩 제공자 ${provider} 가 결과를 돌려주지 않았습니다`);
    }
    // 제공자 서비스가 안에서 다른 제공자로 넘어간 결과(openai 의 TF-IDF 대체 등)는 받지 않는다.
    if (result.provider && result.provider !== provider) {
      throw new Error(`임베딩 제공자 ${provider} 대신 ${result.provider} 결과가 왔습니다`);
    }
    this.currentProvider = service;
    this.currentProviderName = provider;
    result.provider = provider;
    return result;
  }

  /**
   * 검색어를 질의 벡터로 변환한다 (#1729). 로컬 임베딩 모델만 역할 접두를 달리 붙이고,
   * 다른 제공자는 generateEmbedding 과 같다. 기억끼리 비교에는 쓰지 않는다.
   */
  async embedQuery(text: string, preferredProvider?: EmbeddingProvider): Promise<EmbeddingResult | null> {
    return this.embed(text, 'query', preferredProvider);
  }

  private async embed(
    text: string,
    role: EmbeddingRole,
    preferredProvider?: EmbeddingProvider
  ): Promise<EmbeddingResult | null> {
    this.validateInput(text);

    try {
      const selection = await this.selectProvider(preferredProvider);
      if (!selection) {
        throw new Error('사용 가능한 임베딩 제공자가 없습니다');
      }

      this.currentProvider = selection.service;
      this.currentProviderName = selection.provider;
      const result = await embedForRole(selection.service, text, role);
      
      if (result) {
        // provider 정보 추가
        result.provider = selection.provider;
        // 로그는 디버그 모드에서만 출력 (MCP 프로토콜 준수)
        return result;
      }

      // 폴백 시도
      return await this.tryFallbackProviders(text, role);

    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      if (!isCliQuiet()) process.stderr.write(`❌ 임베딩 생성 실패: ${maskedError.message}\n`);
      this.handleProviderFailure(this.currentProviderName);
      
      // 폴백 시도
      try {
        return await this.tryFallbackProviders(text, role);
      } catch (fallbackError) {
        // eslint-disable-next-line preserve-caught-error -- the message is masked; a raw cause would expose unmasked PII
        throw new Error(`모든 임베딩 제공자 실패: ${maskedError.message}`);
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
   * 
   * 왜 이 메서드가 중요한가?
   * - fallback 발생 시 차원 정보가 정확히 반환되어야 함
   * - "expected 384 vs actual 512" 에러 방지를 위해 현재 제공자의 정확한 차원 반환 필요
   */
  getModelInfo(): { model: string; dimensions: number; maxTokens: number } {
    if (this.currentProvider) {
      return this.currentProvider.getModelInfo();
    }

    // currentProvider가 없으면 currentProviderName 기반으로 차원 추정
    // 왜 필요한가? fallback 후에도 정확한 차원 정보 제공
    if (this.currentProviderName) {
      const providerDimensions = VECTOR_SEARCH.PROVIDER_DIMENSIONS[this.currentProviderName as keyof typeof VECTOR_SEARCH.PROVIDER_DIMENSIONS];
      if (providerDimensions) {
        return {
          model: `unified-embedding-${this.currentProviderName}`,
          dimensions: providerDimensions,
          maxTokens: 256
        };
      }
    }

    // 기본값 반환 (TF-IDF 기준 - 가장 안정적인 fallback)
    // 왜 TF-IDF인가? 가장 안정적이고 항상 사용 가능한 제공자
    return {
      model: 'unified-embedding',
      dimensions: VECTOR_SEARCH.DEFAULT_DIMENSIONS, // 512
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
   * 마지막으로 사용된 임베딩 제공자 이름 반환 (진단용)
   * recall 도구에서 TF-IDF fallback 감지에 사용됨
   */
  getCurrentProviderName(): EmbeddingProvider | null {
    return this.currentProviderName;
  }

  /**
   * 마지막으로 선택된 제공자 서비스 인스턴스 (#1112 윈도 임베딩 접근용).
   * 인터페이스에 없는 제공자 전용 기능(로컬 임베딩 generateWindowEmbeddings)을 호출하려면 필요하다.
   */
  getCurrentProviderService(): EmbeddingServiceInterface | null {
    return this.currentProvider;
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
   * 
   * 왜 차원 정보 동기화가 필요한가?
   * - MiniLM(384) → TF-IDF(512) fallback 시 차원 정보가 달라짐
   * - getModelInfo()가 정확한 차원을 반환하도록 currentProvider 업데이트 필수
   */
  private async tryFallbackProviders(text: string, role: EmbeddingRole): Promise<EmbeddingResult | null> {
    const { service, decision } = await this.factory.selectProviderWithHealthCheck();
    if (!service) {
      throw new Error('모든 폴백 제공자 실패');
    }
    // 로그는 디버그 모드에서만 출력 (MCP 프로토콜 준수)
    const result = await embedForRole(service, text, role);
    if (result) {
      // fallback 발생 시 currentProvider와 currentProviderName 업데이트
      // 왜 필요한가? getModelInfo()가 정확한 차원을 반환하도록 보장
      this.currentProvider = service;
      this.currentProviderName = decision.selectedProvider;
      result.provider = decision.selectedProvider;
      
      // 차원 정보 검증: 결과의 차원이 제공자 차원과 일치하는지 확인
      const expectedDimensions = VECTOR_SEARCH.PROVIDER_DIMENSIONS[decision.selectedProvider as keyof typeof VECTOR_SEARCH.PROVIDER_DIMENSIONS];
      if (expectedDimensions && result.embedding.length !== expectedDimensions) {
        // 차원 불일치 경고 (하지만 결과는 반환)
        if (!isCliQuiet()) process.stderr.write(`⚠️ 차원 불일치: 예상 ${expectedDimensions}, 실제 ${result.embedding.length} (provider: ${decision.selectedProvider})\n`);
      }
      
      return result;
    }
    throw new Error('모든 폴백 제공자 실패');
  }

  private handleProviderFailure(provider: EmbeddingProvider | null): void {
    if (!provider) {
      return;
    }
    this.factory.handleProviderFailure(provider);
  }
}

function embedForRole(
  service: EmbeddingServiceInterface,
  text: string,
  role: EmbeddingRole
): Promise<EmbeddingResult | null> {
  return role === 'query' && service instanceof LocalEmbeddingService
    ? service.embedQuery(text)
    : service.generateEmbedding(text);
}

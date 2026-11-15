/**
 * 벡터 검색 서비스
 * 단일 책임 원칙(SRP) 적용 - 검색 기능만 담당
 */

import type { 
  VectorSearchQuery, 
  VectorSearchResult, 
  VectorSearchOptions
} from '../../../../shared/types/vector-search.types.js';
import type { VectorSearchRepository } from '../../../../shared/interfaces/database.interface.js';
import { VECTOR_SEARCH_CONFIG } from '../../../../shared/config/vector-search.config.js';

export class VectorSearchService {
  constructor(
    private repository: VectorSearchRepository,
    private config = VECTOR_SEARCH_CONFIG
  ) {}

  /**
   * 벡터 검색 실행
   */
  async search(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    this.validateQuery(query);
    
    try {
      return await this.repository.search(query);
    } catch (error) {
      throw new Error(`벡터 검색 실패: ${error}`, { cause: error });
    }
  }

  /**
   * 하이브리드 검색 실행
   */
  async hybridSearch(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    this.validateQuery(query);
    
    try {
      return await this.repository.hybridSearch(query);
    } catch (error) {
      throw new Error(`하이브리드 검색 실패: ${error}`, { cause: error });
    }
  }

  /**
   * 검색 쿼리 유효성 검증
   */
  private validateQuery(query: VectorSearchQuery): void {
    const expectedDimensions = this.getExpectedDimensions(query.provider);
    if (!query.queryVector || query.queryVector.length !== expectedDimensions) {
      throw new Error(`벡터 차원 불일치: 예상 ${expectedDimensions}, 실제 ${query.queryVector?.length || 0}`);
    }

    if (query.options.limit && (query.options.limit < 1 || query.options.limit > 100)) {
      throw new Error('검색 제한은 1-100 사이여야 합니다');
    }
  }

  private getExpectedDimensions(provider?: string): number {
    // provider가 없을 때도 repository의 getTableName과 동일하게 'tfidf'의 차원을 사용
    // 왜 필요한가? repository에서 getTableName(provider ?? 'tfidf')는 'tfidf' 테이블(512차원)을 선택하므로
    // 차원 계산도 동일하게 'tfidf'의 차원(512)을 사용해야 차원 불일치 오류를 방지할 수 있음
    const effectiveProvider = provider ?? 'tfidf';
    return this.config.providerDimensions[effectiveProvider] ?? this.config.defaultDimensions;
  }

  /**
   * 기본 옵션 적용
   */
  applyDefaultOptions(options: VectorSearchOptions): VectorSearchOptions {
    return {
      limit: this.config.defaultLimit,
      threshold: this.config.defaultThreshold,
      includeContent: true,
      ...options
    };
  }
}

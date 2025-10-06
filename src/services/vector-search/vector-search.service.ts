/**
 * 벡터 검색 서비스
 * 단일 책임 원칙(SRP) 적용 - 검색 기능만 담당
 */

import type { 
  VectorSearchQuery, 
  VectorSearchResult, 
  VectorSearchOptions 
} from '../../types/vector-search.types';
import type { VectorSearchRepository } from '../../interfaces/database.interface';
import { VECTOR_SEARCH_CONFIG } from '../../config/vector-search.config';

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
      throw new Error(`벡터 검색 실패: ${error}`);
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
      throw new Error(`하이브리드 검색 실패: ${error}`);
    }
  }

  /**
   * 검색 쿼리 유효성 검증
   */
  private validateQuery(query: VectorSearchQuery): void {
    if (!query.queryVector || query.queryVector.length !== this.config.defaultDimensions) {
      throw new Error(`벡터 차원 불일치: 예상 ${this.config.defaultDimensions}, 실제 ${query.queryVector?.length || 0}`);
    }

    if (query.options.limit && (query.options.limit < 1 || query.options.limit > 100)) {
      throw new Error('검색 제한은 1-100 사이여야 합니다');
    }
  }

  /**
   * 기본 옵션 적용
   */
  applyDefaultOptions(options: VectorSearchOptions): VectorSearchOptions {
    return {
      limit: this.config.defaultLimit,
      threshold: this.config.defaultThreshold,
      includeContent: true,
      includeMetadata: false,
      ...options
    };
  }
}

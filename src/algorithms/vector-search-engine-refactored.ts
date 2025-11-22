/**
 * 유지보수성과 테스트 가능성을 향상시키기 위해 클린코드 원칙을 적용합니다.
 * 기존 VectorSearchEngine의 대체품으로 점진적 마이그레이션을 지원합니다.
 */

import Database from 'better-sqlite3';
import { VectorSearchContainer } from '../services/vector-search/vector-search-container';
import { VectorSearchFactory } from '../factories/vector-search.factory';
import type { 
  VectorSearchQuery, 
  VectorSearchResult, 
  VectorIndexStatus,
  PerformanceTestResult 
} from '../types/vector-search.types';

/**
 * 리팩토링된 벡터 검색 엔진으로 기존 코드와의 호환성을 유지하면서 개선된 구조를 제공합니다.
 * 기존 VectorSearchEngine과 동일한 인터페이스를 제공하여 기존 코드 수정 없이 사용 가능하도록 합니다.
 */
export class VectorSearchEngineRefactored {
  private container: VectorSearchContainer;

  constructor() {
    this.container = VectorSearchContainer.getInstance();
  }

  /**
   * 벡터 검색 기능이 없으면 검색이 실패할 수 있으므로, 데이터베이스 연결을 설정하고 벡터 검색 기능의 사용 가능 여부를 확인합니다.
   */
  initialize(db: Database.Database): void {
    this.container.setDatabase(db);
  }

  /**
   * 쿼리 벡터와 유사한 메모리를 검색하여 의미적으로 관련된 결과를 제공합니다.
   * 리팩토링된 서비스를 통해 개선된 검색 기능을 제공합니다.
   */
  async search(
    queryVector: number[], 
    options: any = {},
    provider: string = 'tfidf'
  ): Promise<VectorSearchResult[]> {
    const query: VectorSearchQuery = {
      queryVector,
      options,
      provider
    };

    const facade = this.container.getFacade();
    return await facade.search(query);
  }

  /**
   * 하이브리드 검색 실행
   */
  async hybridSearch(
    queryVector: number[],
    textQuery: string,
    options: any = {},
    provider: string = 'tfidf'
  ): Promise<VectorSearchResult[]> {
    const query: VectorSearchQuery = {
      queryVector,
      textQuery,
      options,
      provider
    };

    const facade = this.container.getFacade();
    return await facade.hybridSearch(query);
  }

  /**
   * 벡터 인덱스 상태 확인
   */
  getIndexStatus(): VectorIndexStatus {
    const facade = this.container.getFacade();
    return facade.getIndexStatus();
  }

  /**
   * 벡터 인덱스 재구성
   */
  async rebuildIndex(): Promise<boolean> {
    const facade = this.container.getFacade();
    return await facade.rebuildIndex();
  }

  /**
   * 벡터 검색 성능 테스트
   */
  async performanceTest(
    queryVector: number[], 
    iterations: number = 10
  ): Promise<PerformanceTestResult> {
    const facade = this.container.getFacade();
    return await facade.runPerformanceTest(queryVector, iterations);
  }

  /**
   * 벡터 차원 확인
   */
  getDimensions(): number {
    return 384; // 기본 차원
  }

  /**
   * VEC 사용 가능 여부 확인
   */
  isAvailable(): boolean {
    const facade = this.container.getFacade();
    return facade.isAvailable();
  }

  /**
   * 데이터베이스 연결 상태 확인
   */
  isConnected(): boolean {
    return this.container.isConnected();
  }
}

// 기존 인터페이스와 호환성을 위한 팩토리 함수들
export function getVectorSearchEngine(): VectorSearchEngineRefactored {
  return new VectorSearchEngineRefactored();
}

export function createVectorSearchEngine(): VectorSearchEngineRefactored {
  return new VectorSearchEngineRefactored();
}

export function resetVectorSearchEngine(): void {
  const container = VectorSearchContainer.getInstance();
  container.reset();
}

// 기존 타입들 재export (호환성 유지)
export type {
  VectorSearchResult,
  VectorSearchOptions,
  VectorIndexStatus,
  PerformanceTestResult
} from '../types/vector-search.types';

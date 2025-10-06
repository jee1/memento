/**
 * 리팩토링된 벡터 검색 엔진
 * 클린코드 원칙을 적용한 새로운 구현
 * 기존 VectorSearchEngine의 대체품
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
 * 리팩토링된 벡터 검색 엔진
 * 기존 VectorSearchEngine과 동일한 인터페이스 제공
 */
export class VectorSearchEngineRefactored {
  private container: VectorSearchContainer;

  constructor() {
    this.container = VectorSearchContainer.getInstance();
  }

  /**
   * 데이터베이스 초기화
   */
  initialize(db: Database.Database): void {
    this.container.setDatabase(db);
  }

  /**
   * 벡터 검색 실행
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

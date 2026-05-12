/**
 * 의미적 유사성을 기반으로 한 고성능 벡터 검색을 제공합니다.
 * sqlite-vec를 사용하여 대용량 벡터 데이터에서도 빠른 유사도 검색을 수행합니다.
 * Memento MCP Server의 핵심 벡터 검색 컴포넌트로서 의미 기반 검색 기능을 제공합니다.
 * 
 * 리팩토링: VectorSearchContainer와 Facade 패턴을 사용하여 개선된 구조를 활용합니다.
 * 기존 인터페이스는 유지하여 하위 호환성을 보장합니다.
 */

import Database from 'better-sqlite3';
import { VECTOR_SEARCH } from '../../../shared/config/constants.js';
import type {
VectorSearchQuery
} from '../../../shared/types/vector-search.types.js';
import { getVectorTableName as getValidatedVectorTableName } from '../../../shared/utils/sql-security-validator.js';
import { VectorSearchContainer } from '../services/vector-search/vector-search-container.js';

// 기존 인터페이스 유지 (하위 호환성)
export interface VectorSearchResult {
  memory_id: string;
  similarity: number;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed?: string;
  pinned: boolean;
  tags?: string[];
  project_id?: string | null;
  owner_id?: string | null;
}

export interface VectorSearchOptions {
  limit?: number;
  threshold?: number;  // 관련성이 낮은 결과를 필터링하여 검색 품질을 향상시키기 위한 최소 유사도 임계값
  types?: string[];    // 특정 메모리 타입만 검색하여 정확한 결과를 제공하기 위한 다중 메모리 타입 필터
  includeContent?: boolean;
  includeMetadata?: boolean; // 상세한 분석을 위해 메타데이터 포함 여부를 제어합니다.
  project_id?: string;
  owner_id?: string | string[];
}

export interface VectorIndexStatus {
  available: boolean;
  tableExists: boolean;
  recordCount: number;
  dimensions: number;
  vecExtensionLoaded: boolean;
}

/**
 * 벡터 검색 엔진
 * 리팩토링된 구조를 사용하여 개선된 유지보수성과 테스트 가능성을 제공합니다.
 */
export class VectorSearchEngine {
  private container: VectorSearchContainer;

  constructor() {
    this.container = VectorSearchContainer.getInstance();
  }

  /**
   * 데이터베이스 연결을 설정하고 벡터 검색 기능의 사용 가능 여부를 확인합니다.
   */
  initialize(db: Database.Database | null): void {
    if (db) {
      this.container.setDatabase(db);
    } else {
      // null인 경우 명시적으로 연결 해제
      this.container.reset();
    }
  }

  /**
   * 쿼리 벡터와 유사한 메모리를 검색하여 의미적으로 관련된 결과를 제공합니다.
   */
  async search(
    queryVector: number[], 
    options: VectorSearchOptions = {},
    provider: string = 'tfidf'
  ): Promise<VectorSearchResult[]> {
    if (!this.container.isConnected()) {
      return [];
    }
    
    const query: VectorSearchQuery = {
      queryVector,
      options,
      provider
    };

    const facade = this.container.getFacade();
    return await facade.search(query);
  }

  /**
   * 벡터 검색과 메타데이터 검색을 결합하여 검색 정확도와 포괄성을 동시에 확보합니다.
   */
  async hybridSearch(
    queryVector: number[],
    textQuery: string,
    options: VectorSearchOptions = {},
    provider: string = 'tfidf'
  ): Promise<VectorSearchResult[]> {
    if (!this.container.isConnected()) {
      return [];
    }
    
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
   * 벡터 검색 기능의 현재 상태를 확인하여 사용 가능 여부와 인덱스 정보를 제공합니다.
   */
  getIndexStatus(): VectorIndexStatus {
    if (!this.container.isConnected()) {
      return {
        available: false,
        tableExists: false,
        recordCount: 0,
        dimensions: VECTOR_SEARCH.PROVIDER_DIMENSIONS.tfidf, // TF-IDF 기본 차원
        vecExtensionLoaded: false
      };
    }
    
    try {
      const facade = this.container.getFacade();
      const status = facade.getIndexStatus();
      // dimensions를 512로 설정 (기존 동작 유지)
      return {
        ...status,
        dimensions: VECTOR_SEARCH.PROVIDER_DIMENSIONS.tfidf
      };
    } catch {
      return {
        available: false,
        tableExists: false,
        recordCount: 0,
        dimensions: VECTOR_SEARCH.PROVIDER_DIMENSIONS.tfidf, // TF-IDF 기본 차원
        vecExtensionLoaded: false
      };
    }
  }

  /**
   * 벡터 인덱스를 재구성하여 검색 성능을 최적화합니다.
   */
  async rebuildIndex(): Promise<boolean> {
    if (!this.container.isConnected()) {
      return false;
    }
    
    try {
      const facade = this.container.getFacade();
      return await facade.rebuildIndex();
    } catch {
      return false;
    }
  }

  /**
   * 벡터 검색의 성능을 측정하여 최적화 지점을 파악합니다.
   */
  async performanceTest(queryVector: number[], iterations: number = VECTOR_SEARCH.PERFORMANCE_TEST_ITERATIONS): Promise<{
    averageTime: number;
    minTime: number;
    maxTime: number;
    results: number;
    successRate: number;
  }> {
    if (!this.container.isConnected()) {
      return {
        averageTime: 0,
        minTime: 0,
        maxTime: 0,
        results: 0,
        successRate: 0
      };
    }
    
    try {
      const facade = this.container.getFacade();
      return await facade.runPerformanceTest(queryVector, iterations);
    } catch {
      return {
        averageTime: 0,
        minTime: 0,
        maxTime: 0,
        results: 0,
        successRate: 0
      };
    }
  }

  /**
   * 특정 provider의 벡터 차원을 조회하여 벡터 검색 시 차원 정보를 제공합니다.
   */
  getDimensions(provider: string = 'tfidf'): number {
    // 기존 동작 유지: provider별 차원 반환
    const providerDimensions: Record<string, number> = {
      lightweight: VECTOR_SEARCH.PROVIDER_DIMENSIONS.lightweight,
      tfidf: VECTOR_SEARCH.PROVIDER_DIMENSIONS.tfidf,
      minilm: VECTOR_SEARCH.PROVIDER_DIMENSIONS.minilm,
      openai: VECTOR_SEARCH.PROVIDER_DIMENSIONS.openai,
      gemini: VECTOR_SEARCH.PROVIDER_DIMENSIONS.gemini
    };
    return providerDimensions[provider.toLowerCase()] ?? VECTOR_SEARCH.PROVIDER_DIMENSIONS.minilm;
  }

  /**
   * 각 임베딩 provider별로 다른 벡터 테이블을 사용하여 차원 불일치를 방지합니다.
   * provider에 따라 적절한 테이블명을 반환하여 정확한 검색을 보장합니다.
   * SQL Injection 방지를 위해 화이트리스트 기반 검증을 수행합니다.
   * 
   * @internal 테스트를 위해 public으로 유지
   */
  getVectorTableName(provider: string): string {
    return getValidatedVectorTableName(provider);
  }

  /**
   * 벡터 검색 기능이 사용 가능한지 확인하여 호출자가 적절한 처리를 할 수 있도록 합니다.
   */
  isAvailable(): boolean {
    if (!this.container.isConnected()) {
      return false;
    }
    try {
      const facade = this.container.getFacade();
      return facade.isAvailable();
    } catch {
      return false;
    }
  }

  /**
   * 데이터베이스 연결 상태를 확인하여 검색 실행 전 안전성을 보장합니다.
   */
  isConnected(): boolean {
    return this.container.isConnected();
  }
}

// 전역에서 단일 인스턴스를 공유하여 메모리 사용을 최적화하고 일관된 상태를 유지합니다.
let vectorSearchEngineInstance: VectorSearchEngine | null = null;

export function getVectorSearchEngine(): VectorSearchEngine {
  if (!vectorSearchEngineInstance) {
    vectorSearchEngineInstance = new VectorSearchEngine();
  }
  return vectorSearchEngineInstance;
}

export function createVectorSearchEngine(): VectorSearchEngine {
  return new VectorSearchEngine();
}

export function resetVectorSearchEngine(): void {
  vectorSearchEngineInstance = null;
}

/**
 * 벡터 검색 파사드
 * 의존성 주입을 통한 통합 인터페이스 제공
 */

import type { 
  VectorSearchQuery, 
  VectorSearchResult, 
  VectorIndexStatus,
  PerformanceTestResult,
  ProviderHybridQuery,
  ProviderHybridResult,
  UnifiedSearchResponse
} from '../../types/vector-search.types';
import { VectorSearchService } from './vector-search.service';
import { VectorIndexManager } from './vector-index-manager';
import { VectorPerformanceTester } from './vector-performance-tester';
import type { 
  VectorSearchRepository, 
  VectorIndexRepository, 
  VectorPerformanceRepository 
} from '../../interfaces/database.interface';
import { UnifiedEmbeddingService } from '../unified-embedding-service.js';

export class VectorSearchFacade {
  private searchService: VectorSearchService;
  private indexManager: VectorIndexManager;
  private performanceTester: VectorPerformanceTester;

  constructor(
    searchRepository: VectorSearchRepository,
    indexRepository: VectorIndexRepository,
    performanceRepository: VectorPerformanceRepository
  ) {
    this.searchService = new VectorSearchService(searchRepository);
    this.indexManager = new VectorIndexManager(indexRepository);
    this.performanceTester = new VectorPerformanceTester(performanceRepository);
  }

  /**
   * 벡터 검색 실행
   */
  async search(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    return await this.searchService.search(query);
  }

  /**
   * 하이브리드 검색 실행
   */
  async hybridSearch(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    return await this.searchService.hybridSearch(query);
  }

  async providerHybridSearch(
    query: ProviderHybridQuery,
    embeddingService: UnifiedEmbeddingService
  ): Promise<ProviderHybridResult[]> {
    return await this.searchService.providerHybridSearch(embeddingService, query);
  }

  async unifiedSearch(
    query: ProviderHybridQuery,
    embeddingService: UnifiedEmbeddingService
  ): Promise<UnifiedSearchResponse> {
    return await this.searchService.unifiedSearch(embeddingService, query);
  }

  /**
   * 인덱스 상태 확인
   */
  getIndexStatus(): VectorIndexStatus {
    return this.indexManager.getIndexStatus();
  }

  /**
   * 인덱스 재구성
   */
  async rebuildIndex(): Promise<boolean> {
    return await this.indexManager.rebuildIndex();
  }

  /**
   * VEC 사용 가능 여부 확인
   */
  isAvailable(): boolean {
    return this.indexManager.isAvailable();
  }

  /**
   * 성능 테스트 실행
   */
  async runPerformanceTest(
    queryVector: number[], 
    iterations: number = 10
  ): Promise<PerformanceTestResult> {
    return await this.performanceTester.runPerformanceTest(queryVector, iterations);
  }

  /**
   * 성능 테스트 결과 분석
   */
  analyzePerformance(result: PerformanceTestResult): {
    performance: 'excellent' | 'good' | 'fair' | 'poor';
    recommendations: string[];
  } {
    return this.performanceTester.analyzeResults(result);
  }

  /**
   * 성능 테스트 리포트 생성
   */
  generatePerformanceReport(result: PerformanceTestResult): string {
    return this.performanceTester.generateReport(result);
  }

  /**
   * 인덱스 상태 요약
   */
  getStatusSummary(): string {
    return this.indexManager.getStatusSummary();
  }

  /**
   * 전체 시스템 상태 확인
   */
  getSystemStatus(): {
    available: boolean;
    indexStatus: VectorIndexStatus;
    summary: string;
  } {
    const indexStatus = this.getIndexStatus();
    const available = this.isAvailable();
    
    return {
      available,
      indexStatus,
      summary: this.getStatusSummary()
    };
  }
}

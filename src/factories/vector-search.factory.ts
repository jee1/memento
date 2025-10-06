/**
 * 벡터 검색 팩토리
 * 의존성 주입을 통한 객체 생성 관리
 */

import Database from 'better-sqlite3';
import { VectorSearchFacade } from '../services/vector-search/vector-search-facade';
import { VectorSearchRepositoryImpl } from '../repositories/vector-search.repository';
import { VectorPerformanceRepositoryImpl } from '../repositories/vector-performance.repository';
import type { VectorSearchFacade as IVectorSearchFacade } from '../services/vector-search/vector-search-facade';

export class VectorSearchFactory {
  /**
   * 벡터 검색 파사드 생성
   */
  static createFacade(db: Database.Database): IVectorSearchFacade {
    // 리포지토리 인스턴스 생성
    const searchRepository = new VectorSearchRepositoryImpl(db);
    const performanceRepository = new VectorPerformanceRepositoryImpl(db);
    
    // 인덱스 리포지토리는 검색 리포지토리를 재사용
    const indexRepository = searchRepository;
    
    // 파사드 생성 및 반환
    return new VectorSearchFacade(
      searchRepository,
      indexRepository,
      performanceRepository
    );
  }

  /**
   * 벡터 검색 서비스만 생성 (경량화)
   */
  static async createSearchService(db: Database.Database) {
    const searchRepository = new VectorSearchRepositoryImpl(db);
    const { VectorSearchService } = await import('../services/vector-search/vector-search.service');
    return new VectorSearchService(searchRepository);
  }

  /**
   * 인덱스 매니저만 생성
   */
  static async createIndexManager(db: Database.Database) {
    const searchRepository = new VectorSearchRepositoryImpl(db);
    const { VectorIndexManager } = await import('../services/vector-search/vector-index-manager');
    return new VectorIndexManager(searchRepository);
  }

  /**
   * 성능 테스터만 생성
   */
  static async createPerformanceTester(db: Database.Database) {
    const performanceRepository = new VectorPerformanceRepositoryImpl(db);
    const { VectorPerformanceTester } = await import('../services/vector-search/vector-performance-tester');
    return new VectorPerformanceTester(performanceRepository);
  }
}

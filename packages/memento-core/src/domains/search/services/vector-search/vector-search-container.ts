/**
 * 벡터 검색 컨테이너
 * 의존성 주입 컨테이너 역할
 */

import Database from 'better-sqlite3';
import { VectorPerformanceRepositoryImpl } from '../../repositories/vector-performance.repository.js';
import { VectorSearchRepositoryImpl } from '../../repositories/vector-search.repository.js';
import { VectorIndexManager } from './vector-index-manager.js';
import { VectorPerformanceTester } from './vector-performance-tester.js';
import { VectorSearchService } from './vector-search.service.js';

interface VectorSearchServices {
  searchService: VectorSearchService;
  indexManager: VectorIndexManager;
  performanceTester: VectorPerformanceTester;
}

export class VectorSearchContainer {
  private static instance: VectorSearchContainer | null = null;
  private services: VectorSearchServices | null = null;
  private db: Database.Database | null = null;

  private constructor() {}

  /**
   * 싱글톤 인스턴스 반환
   */
  static getInstance(): VectorSearchContainer {
    if (!VectorSearchContainer.instance) {
      VectorSearchContainer.instance = new VectorSearchContainer();
    }
    return VectorSearchContainer.instance;
  }

  /**
   * 데이터베이스 연결 설정
   */
  setDatabase(db: Database.Database): void {
    this.db = db;
    this.services = null;
  }

  getServices(): VectorSearchServices {
    if (!this.services) {
      if (!this.db) {
        throw new Error('데이터베이스가 설정되지 않았습니다');
      }
      const searchRepository = new VectorSearchRepositoryImpl(this.db);
      this.services = {
        searchService: new VectorSearchService(searchRepository),
        indexManager: new VectorIndexManager(searchRepository),
        performanceTester: new VectorPerformanceTester(new VectorPerformanceRepositoryImpl(this.db)),
      };
    }
    return this.services;
  }

  /**
   * 컨테이너 초기화
   */
  reset(): void {
    this.services = null;
    this.db = null;
  }

  /**
   * 데이터베이스 연결 상태 확인
   */
  isConnected(): boolean {
    return this.db !== null;
  }
}

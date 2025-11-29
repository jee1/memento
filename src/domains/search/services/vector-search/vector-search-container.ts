/**
 * 벡터 검색 컨테이너
 * 의존성 주입 컨테이너 역할
 */

import Database from 'better-sqlite3';
import { VectorSearchFacade } from './vector-search-facade';
import { VectorSearchRepositoryImpl } from '../../repositories/vector-search.repository';
import { VectorPerformanceRepositoryImpl } from '../../repositories/vector-performance.repository';
import type { VectorSearchConfig } from '../../types/vector-search.types';

export class VectorSearchContainer {
  private static instance: VectorSearchContainer | null = null;
  private facade: VectorSearchFacade | null = null;
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
    this.facade = null; // 기존 파사드 무효화
  }

  /**
   * 벡터 검색 파사드 반환
   */
  getFacade(): VectorSearchFacade {
    if (!this.facade) {
      if (!this.db) {
        throw new Error('데이터베이스가 설정되지 않았습니다');
      }
      this.facade = this.createFacade();
    }
    return this.facade;
  }

  /**
   * 파사드 생성
   */
  private createFacade(): VectorSearchFacade {
    if (!this.db) {
      throw new Error('데이터베이스가 설정되지 않았습니다');
    }

    const searchRepository = new VectorSearchRepositoryImpl(this.db);
    const performanceRepository = new VectorPerformanceRepositoryImpl(this.db);
    
    return new VectorSearchFacade(
      searchRepository,
      searchRepository, // 인덱스 리포지토리로 재사용
      performanceRepository
    );
  }

  /**
   * 컨테이너 초기화
   */
  reset(): void {
    this.facade = null;
    this.db = null;
  }

  /**
   * 데이터베이스 연결 상태 확인
   */
  isConnected(): boolean {
    return this.db !== null;
  }

  /**
   * 파사드 상태 확인
   */
  isFacadeReady(): boolean {
    return this.facade !== null;
  }
}

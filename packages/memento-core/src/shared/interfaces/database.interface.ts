/**
 * 데이터베이스 추상화 인터페이스
 * 의존성 역전 원칙(DIP) 적용
 */

export interface PreparedStatement {
  all(...params: any[]): any[];
  get(...params: any[]): any;
  run(...params: any[]): { changes: number; lastInsertRowid: number };
}

export interface DatabaseConnection {
  prepare(sql: string): PreparedStatement;
  exec(sql: string): void;
  close(): void;
  isOpen(): boolean;
}

export interface VectorSearchRepository {
  search(query: VectorSearchQuery): Promise<VectorSearchResult[]>;
  hybridSearch(query: VectorSearchQuery): Promise<VectorSearchResult[]>; // HybridSearchResult[]에서 VectorSearchResult[]로 변경
  getIndexStatus(): VectorIndexStatus;
  rebuildIndex(): Promise<boolean>;
  getTableName(provider: string): string;
  checkVecAvailability(): boolean;
}

export interface VectorIndexRepository {
  getIndexStatus(): VectorIndexStatus;
  rebuildIndex(): Promise<boolean>;
  checkAvailability(): boolean;
}

export interface VectorPerformanceRepository {
  runPerformanceTest(
    queryVector: number[], 
    iterations: number
  ): Promise<PerformanceTestResult>;
}

// 타입 import
import type {
PerformanceTestResult,
VectorIndexStatus,
VectorSearchQuery,
VectorSearchResult
} from '../types/vector-search.types';

/**
 * 데이터베이스 최적화 서비스 인터페이스 (DIP)
 * 도메인/툴은 이 인터페이스만 참조하고, 인프라 구현체를 주입받음.
 */

/** 툴/컨텍스트에서 사용하는 인덱스 추천 타입 (인프라 IndexRecommendation과 호환) */
export interface IIndexRecommendation {
  table: string;
  columns: string[];
  type: 'btree' | 'fts' | 'partial';
  priority: 'high' | 'medium' | 'low';
  reason: string;
  estimatedImprovement: string;
}

export interface IDatabaseOptimizer {
  analyzeDatabase(): Promise<void>;
  generateIndexRecommendations(): Promise<IIndexRecommendation[]>;
  createIndex(name: string, table: string, columns: string[], unique?: boolean): Promise<void>;
  generateOptimizationReport(): Promise<string>;
}

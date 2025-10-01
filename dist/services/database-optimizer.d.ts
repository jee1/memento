/**
 * 데이터베이스 성능 최적화 서비스
 * 인덱스 최적화, 쿼리 분석, 성능 튜닝
 */
import Database from 'better-sqlite3';
export interface IndexRecommendation {
    table: string;
    columns: string[];
    type: 'btree' | 'fts' | 'partial';
    priority: 'high' | 'medium' | 'low';
    reason: string;
    estimatedImprovement: string;
}
export interface QueryAnalysis {
    query: string;
    executionTime: number;
    explainPlan: any[];
    recommendations: string[];
    complexity: 'simple' | 'medium' | 'complex';
}
export interface DatabaseStats {
    tableStats: Record<string, {
        rowCount: number;
        size: number;
        indexCount: number;
        lastAnalyzed: Date;
    }>;
    indexStats: Record<string, {
        name: string;
        table: string;
        columns: string[];
        size: number;
        usage: number;
    }>;
    queryStats: {
        totalQueries: number;
        averageTime: number;
        slowQueries: QueryAnalysis[];
    };
}
export declare class DatabaseOptimizer {
    private db;
    private queryHistory;
    constructor(db: Database.Database);
    /**
     * 데이터베이스 성능 분석
     */
    analyzePerformance(): Promise<DatabaseStats>;
    /**
     * 테이블 분석
     */
    private analyzeTables;
    /**
     * 인덱스 분석
     */
    private analyzeIndexes;
    /**
     * 쿼리 분석
     */
    private analyzeQueries;
    /**
     * 인덱스 추천 생성
     */
    generateIndexRecommendations(): Promise<IndexRecommendation[]>;
    /**
     * 쿼리 패턴 분석
     */
    private analyzeQueryPatterns;
    /**
     * 쿼리 추천 생성
     */
    private generateQueryRecommendations;
    /**
     * 쿼리 복잡도 평가
     */
    private assessQueryComplexity;
    /**
     * 쿼리 실행 통계 기록
     */
    recordQuery(query: string, executionTime: number): void;
    /**
     * 인덱스 생성
     */
    createIndex(name: string, table: string, columns: string[], unique?: boolean): Promise<void>;
    /**
     * 인덱스 삭제
     */
    dropIndex(name: string): Promise<void>;
    /**
     * 데이터베이스 분석 실행
     */
    analyzeDatabase(): Promise<void>;
    /**
     * 쿼리에서 컬럼 추출
     */
    private extractColumnsFromQuery;
    /**
     * 조건에서 컬럼 추출
     */
    private extractColumnFromCondition;
    /**
     * 인덱스 SQL에서 컬럼 추출
     */
    private extractColumnsFromIndexSQL;
    /**
     * 성능 최적화 리포트 생성
     */
    generateOptimizationReport(): Promise<string>;
}
//# sourceMappingURL=database-optimizer.d.ts.map
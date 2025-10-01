/**
 * 하이브리드 검색 엔진
 * FTS5 텍스트 검색 + 벡터 검색 결합
 */
import type { MemorySearchFilters } from '../types/index.js';
export interface HybridSearchQuery {
    query: string;
    filters?: MemorySearchFilters | undefined;
    limit?: number | undefined;
    vectorWeight?: number | undefined;
    textWeight?: number | undefined;
}
export interface HybridSearchResult {
    id: string;
    content: string;
    type: string;
    importance: number;
    created_at: string;
    last_accessed?: string | undefined;
    pinned: boolean;
    tags?: string[] | undefined;
    textScore: number;
    vectorScore: number;
    finalScore: number;
    recall_reason: string;
}
export declare class HybridSearchEngine {
    private textSearchEngine;
    private embeddingService;
    private readonly defaultVectorWeight;
    private readonly defaultTextWeight;
    private searchStats;
    private adaptiveWeights;
    constructor();
    /**
     * 하이브리드 검색 실행 - 적응형 가중치 적용
     */
    search(db: any, query: HybridSearchQuery): Promise<{
        items: HybridSearchResult[];
        total_count: number;
        query_time: number;
    }>;
    /**
     * 텍스트 검색과 벡터 검색 결과 결합
     */
    private combineResults;
    /**
     * 하이브리드 검색 이유 생성
     */
    private generateHybridReason;
    /**
     * 적응형 가중치 계산
     */
    private calculateAdaptiveWeights;
    /**
     * 쿼리 특성 분석
     */
    private analyzeQuery;
    /**
     * 쿼리 정규화
     */
    private normalizeQuery;
    /**
     * 검색 통계 업데이트
     */
    private updateSearchStats;
    /**
     * 검색 통계 정보
     */
    getSearchStats(db: any): Promise<{
        textSearchAvailable: boolean;
        vectorSearchAvailable: boolean;
        embeddingStats: any;
        searchStats: Map<string, {
            textHits: number;
            vectorHits: number;
            totalSearches: number;
        }>;
        adaptiveWeights: Map<string, {
            vectorWeight: number;
            textWeight: number;
        }>;
    }>;
    /**
     * 임베딩 서비스 사용 가능 여부 확인
     */
    isEmbeddingAvailable(): boolean;
}
//# sourceMappingURL=hybrid-search-engine.d.ts.map
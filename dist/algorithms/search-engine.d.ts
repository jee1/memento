/**
 * 개선된 검색 엔진 구현
 * FTS5 + 랭킹 알고리즘 + 필터링 결합
 */
import type { MemorySearchFilters } from '../types/index.js';
export interface SearchQuery {
    query: string;
    filters?: MemorySearchFilters | undefined;
    limit?: number | undefined;
}
export interface SearchResult {
    id: string;
    content: string;
    type: string;
    importance: number;
    created_at: string;
    last_accessed?: string;
    pinned: boolean;
    tags?: string[];
    score: number;
    recall_reason: string;
}
export declare class SearchEngine {
    private ranking;
    constructor();
    /**
     * 개선된 검색 구현 - FTS5 최적화
     */
    search(db: any, query: SearchQuery): Promise<{
        items: SearchResult[];
        total_count: number;
        query_time: number;
    }>;
    /**
     * FTS5 검색 쿼리 구성
     * 아키텍처 문서에 따른 쿼리 전처리 구현
     */
    private buildFTSQuery;
    /**
     * 쿼리 전처리 - 아키텍처 문서의 전처리 과정 구현
     */
    private preprocessQuery;
    /**
     * FTS5 안전 쿼리 생성
     */
    private makeFTSSafe;
    /**
     * 데이터베이스 쿼리 실행
     */
    private executeQuery;
    /**
     * 랭킹 알고리즘 적용 - FTS5 랭킹 활용
     */
    private applyRanking;
    /**
     * FTS5 사용 가능 여부 확인
     */
    private checkFTS5Availability;
    /**
     * 검색 이유 생성
     */
    private generateRecallReason;
}
//# sourceMappingURL=search-engine.d.ts.map
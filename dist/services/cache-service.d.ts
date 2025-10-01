/**
 * 메모리 캐싱 서비스
 * 검색 결과 및 자주 사용되는 데이터 캐싱
 */
export interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
    accessCount: number;
    lastAccessed: number;
}
export interface CacheStats {
    hits: number;
    misses: number;
    totalRequests: number;
    hitRate: number;
    size: number;
    memoryUsage: number;
}
export declare class CacheService<T = any> {
    private cache;
    private hits;
    private misses;
    private maxSize;
    private defaultTTL;
    constructor(maxSize?: number, defaultTTL?: number);
    /**
     * 캐시에서 데이터 가져오기
     */
    get(key: string): T | null;
    /**
     * 캐시에 데이터 저장
     */
    set(key: string, data: T, ttl?: number): void;
    /**
     * 캐시에서 데이터 삭제
     */
    delete(key: string): boolean;
    /**
     * 캐시 비우기
     */
    clear(): void;
    /**
     * 캐시에 데이터가 있는지 확인
     */
    has(key: string): boolean;
    /**
     * 캐시 통계 반환
     */
    getStats(): CacheStats;
    /**
     * LRU 방식으로 오래된 항목 제거
     */
    private evictLeastRecentlyUsed;
    /**
     * 만료된 항목 정리
     */
    cleanup(): number;
    /**
     * 캐시 키 생성 (검색용)
     */
    generateSearchKey(query: string, filters?: any, limit?: number): string;
    /**
     * 캐시 키 생성 (메모리용)
     */
    generateMemoryKey(memoryId: string): string;
    /**
     * 캐시 키 생성 (통계용)
     */
    generateStatsKey(type: string): string;
}
/**
 * 검색 결과 캐시 서비스
 */
export declare class SearchCacheService {
    private cache;
    private searchStats;
    private queryPatternCache;
    constructor(maxSize?: number, ttl?: number);
    /**
     * 검색 결과 캐시에서 가져오기 - 패턴 매칭 개선
     */
    getSearchResults(query: string, filters?: any, limit?: number): any[] | null;
    /**
     * 검색 결과 캐시에 저장 - 다중 키 저장
     */
    setSearchResults(query: string, results: any[], filters?: any, limit?: number, ttl?: number): void;
    /**
     * 검색 결과 캐시 무효화
     */
    invalidateSearchResults(pattern?: string): void;
    /**
     * 메모리 변경 시 관련 검색 결과 무효화
     */
    invalidateByMemoryId(memoryId: string): void;
    /**
     * 쿼리 정규화
     */
    private normalizeQuery;
    /**
     * 유사한 결과 찾기
     */
    private findSimilarResults;
    /**
     * 쿼리 패턴 캐시 업데이트
     */
    private updateQueryPatternCache;
    /**
     * 캐시 통계 반환
     */
    getStats(): {
        searchStats: {
            [k: string]: number;
        };
        topQueries: [string, number][];
        patternCacheSize: number;
        hits: number;
        misses: number;
        totalRequests: number;
        hitRate: number;
        size: number;
        memoryUsage: number;
    };
    /**
     * 캐시 정리
     */
    cleanup(): number;
}
/**
 * 임베딩 캐시 서비스
 */
export declare class EmbeddingCacheService {
    private cache;
    private embeddingStats;
    constructor(maxSize?: number, ttl?: number);
    /**
     * 임베딩 캐시에서 가져오기
     */
    getEmbedding(text: string): number[] | null;
    /**
     * 임베딩 캐시에 저장
     */
    setEmbedding(text: string, embedding: number[], ttl?: number): void;
    /**
     * 텍스트 해시 생성
     */
    private hashText;
    /**
     * 캐시 통계 반환
     */
    getStats(): {
        embeddingStats: {
            [k: string]: number;
        };
        topTexts: [string, number][];
        hits: number;
        misses: number;
        totalRequests: number;
        hitRate: number;
        size: number;
        memoryUsage: number;
    };
    /**
     * 캐시 정리
     */
    cleanup(): number;
}
//# sourceMappingURL=cache-service.d.ts.map
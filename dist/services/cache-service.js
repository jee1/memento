/**
 * 메모리 캐싱 서비스
 * 검색 결과 및 자주 사용되는 데이터 캐싱
 */
export class CacheService {
    cache = new Map();
    hits = 0;
    misses = 0;
    maxSize;
    defaultTTL;
    constructor(maxSize = 1000, defaultTTL = 300000) {
        this.maxSize = maxSize;
        this.defaultTTL = defaultTTL;
    }
    /**
     * 캐시에서 데이터 가져오기
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return null;
        }
        // TTL 확인
        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            this.misses++;
            return null;
        }
        // 접근 통계 업데이트
        entry.accessCount++;
        entry.lastAccessed = Date.now();
        this.hits++;
        return entry.data;
    }
    /**
     * 캐시에 데이터 저장
     */
    set(key, data, ttl) {
        // 캐시 크기 제한 확인
        if (this.cache.size >= this.maxSize) {
            this.evictLeastRecentlyUsed();
        }
        const entry = {
            data,
            timestamp: Date.now(),
            ttl: ttl || this.defaultTTL,
            accessCount: 0,
            lastAccessed: Date.now()
        };
        this.cache.set(key, entry);
    }
    /**
     * 캐시에서 데이터 삭제
     */
    delete(key) {
        return this.cache.delete(key);
    }
    /**
     * 캐시 비우기
     */
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }
    /**
     * 캐시에 데이터가 있는지 확인
     */
    has(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return false;
        // TTL 확인
        if (Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }
    /**
     * 캐시 통계 반환
     */
    getStats() {
        const totalRequests = this.hits + this.misses;
        const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;
        // 메모리 사용량 추정 (간단한 구현)
        let memoryUsage = 0;
        for (const [key, entry] of this.cache) {
            memoryUsage += key.length * 2; // 문자열 크기 (UTF-16)
            memoryUsage += JSON.stringify(entry.data).length * 2;
            memoryUsage += 100; // 메타데이터 오버헤드
        }
        return {
            hits: this.hits,
            misses: this.misses,
            totalRequests,
            hitRate,
            size: this.cache.size,
            memoryUsage
        };
    }
    /**
     * LRU 방식으로 오래된 항목 제거
     */
    evictLeastRecentlyUsed() {
        let oldestKey = '';
        let oldestTime = Date.now();
        for (const [key, entry] of this.cache) {
            if (entry.lastAccessed < oldestTime) {
                oldestTime = entry.lastAccessed;
                oldestKey = key;
            }
        }
        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }
    /**
     * 만료된 항목 정리
     */
    cleanup() {
        const now = Date.now();
        let cleanedCount = 0;
        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp > entry.ttl) {
                this.cache.delete(key);
                cleanedCount++;
            }
        }
        return cleanedCount;
    }
    /**
     * 캐시 키 생성 (검색용)
     */
    generateSearchKey(query, filters, limit) {
        const filterStr = filters ? JSON.stringify(filters) : '';
        return `search:${query}:${filterStr}:${limit || 10}`;
    }
    /**
     * 캐시 키 생성 (메모리용)
     */
    generateMemoryKey(memoryId) {
        return `memory:${memoryId}`;
    }
    /**
     * 캐시 키 생성 (통계용)
     */
    generateStatsKey(type) {
        return `stats:${type}`;
    }
}
/**
 * 검색 결과 캐시 서비스
 */
export class SearchCacheService {
    cache;
    searchStats = new Map();
    queryPatternCache = new Map(); // 쿼리 패턴 캐시
    constructor(maxSize = 1000, ttl = 600000) {
        this.cache = new CacheService(maxSize, ttl);
    }
    /**
     * 검색 결과 캐시에서 가져오기 - 패턴 매칭 개선
     */
    getSearchResults(query, filters, limit) {
        // 1. 정확한 키로 먼저 시도
        const exactKey = this.cache.generateSearchKey(query, filters, limit);
        let results = this.cache.get(exactKey);
        if (results) {
            this.searchStats.set(query, (this.searchStats.get(query) || 0) + 1);
            return results;
        }
        // 2. 부분 매칭으로 유사한 결과 찾기
        const normalizedQuery = this.normalizeQuery(query);
        const similarResults = this.findSimilarResults(normalizedQuery, filters, limit);
        if (similarResults) {
            // 유사한 결과를 현재 쿼리로도 캐시
            this.setSearchResults(query, similarResults, filters, limit, 300000); // 5분 TTL
            this.searchStats.set(query, (this.searchStats.get(query) || 0) + 1);
            return similarResults;
        }
        return null;
    }
    /**
     * 검색 결과 캐시에 저장 - 다중 키 저장
     */
    setSearchResults(query, results, filters, limit, ttl) {
        const key = this.cache.generateSearchKey(query, filters, limit);
        this.cache.set(key, results, ttl);
        // 정규화된 쿼리로도 저장
        const normalizedQuery = this.normalizeQuery(query);
        if (normalizedQuery !== query) {
            const normalizedKey = this.cache.generateSearchKey(normalizedQuery, filters || {}, limit);
            this.cache.set(normalizedKey, results, ttl);
        }
        // 쿼리 패턴 캐시 업데이트
        this.updateQueryPatternCache(query, results);
    }
    /**
     * 검색 결과 캐시 무효화
     */
    invalidateSearchResults(pattern) {
        if (pattern) {
            // 패턴에 맞는 키만 삭제
            for (const key of this.cache['cache'].keys()) {
                if (key.includes(pattern)) {
                    this.cache.delete(key);
                }
            }
        }
        else {
            // 모든 검색 결과 캐시 삭제
            for (const key of this.cache['cache'].keys()) {
                if (key.startsWith('search:')) {
                    this.cache.delete(key);
                }
            }
        }
    }
    /**
     * 메모리 변경 시 관련 검색 결과 무효화
     */
    invalidateByMemoryId(memoryId) {
        // 메모리 ID가 포함된 검색 결과 캐시 무효화
        this.invalidateSearchResults();
    }
    /**
     * 쿼리 정규화
     */
    normalizeQuery(query) {
        return query
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ') // 여러 공백을 하나로
            .replace(/[^\w\s가-힣]/g, ''); // 특수문자 제거
    }
    /**
     * 유사한 결과 찾기
     */
    findSimilarResults(normalizedQuery, filters, limit) {
        const words = normalizedQuery.split(' ').filter(w => w.length > 1);
        for (const [cachedQuery, results] of this.queryPatternCache) {
            const cachedWords = cachedQuery.split(' ').filter(w => w.length > 1);
            // 단어 겹침 비율 계산
            const intersection = words.filter(w => cachedWords.includes(w));
            const similarity = intersection.length / Math.max(words.length, cachedWords.length);
            if (similarity >= 0.6) { // 60% 이상 유사하면 반환
                return results;
            }
        }
        return null;
    }
    /**
     * 쿼리 패턴 캐시 업데이트
     */
    updateQueryPatternCache(query, results) {
        const normalizedQuery = this.normalizeQuery(query);
        this.queryPatternCache.set(normalizedQuery, results);
        // 패턴 캐시 크기 제한
        if (this.queryPatternCache.size > 100) {
            const firstKey = this.queryPatternCache.keys().next().value;
            if (firstKey) {
                this.queryPatternCache.delete(firstKey);
            }
        }
    }
    /**
     * 캐시 통계 반환
     */
    getStats() {
        const cacheStats = this.cache.getStats();
        const searchStats = Object.fromEntries(this.searchStats);
        return {
            ...cacheStats,
            searchStats,
            topQueries: Array.from(this.searchStats.entries())
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10),
            patternCacheSize: this.queryPatternCache.size
        };
    }
    /**
     * 캐시 정리
     */
    cleanup() {
        const cleaned = this.cache.cleanup();
        // 패턴 캐시도 정리
        if (this.queryPatternCache.size > 50) {
            const entries = Array.from(this.queryPatternCache.entries());
            this.queryPatternCache.clear();
            // 상위 25개만 유지
            entries.slice(0, 25).forEach(([key, value]) => {
                this.queryPatternCache.set(key, value);
            });
        }
        return cleaned;
    }
}
/**
 * 임베딩 캐시 서비스
 */
export class EmbeddingCacheService {
    cache;
    embeddingStats = new Map();
    constructor(maxSize = 1000, ttl = 3600000) {
        this.cache = new CacheService(maxSize, ttl);
    }
    /**
     * 임베딩 캐시에서 가져오기
     */
    getEmbedding(text) {
        const key = `embedding:${this.hashText(text)}`;
        const embedding = this.cache.get(key);
        if (embedding) {
            this.embeddingStats.set(text, (this.embeddingStats.get(text) || 0) + 1);
        }
        return embedding;
    }
    /**
     * 임베딩 캐시에 저장
     */
    setEmbedding(text, embedding, ttl) {
        const key = `embedding:${this.hashText(text)}`;
        this.cache.set(key, embedding, ttl);
    }
    /**
     * 텍스트 해시 생성
     */
    hashText(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 32비트 정수로 변환
        }
        return Math.abs(hash).toString(36);
    }
    /**
     * 캐시 통계 반환
     */
    getStats() {
        const cacheStats = this.cache.getStats();
        const embeddingStats = Object.fromEntries(this.embeddingStats);
        return {
            ...cacheStats,
            embeddingStats,
            topTexts: Array.from(this.embeddingStats.entries())
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10)
        };
    }
    /**
     * 캐시 정리
     */
    cleanup() {
        return this.cache.cleanup();
    }
}
//# sourceMappingURL=cache-service.js.map
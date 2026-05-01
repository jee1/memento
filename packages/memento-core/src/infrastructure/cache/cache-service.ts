/**
 * 메모리 캐싱 서비스
 * 검색 결과 및 자주 사용되는 데이터 캐싱
 */

/** One row in the search-result cache (opaque object shape per caller). */
export type CachedSearchHit = Record<string, unknown>;

/** Filters object serialized into search cache keys. */
export type SearchCacheFilters = Record<string, unknown>;

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

export class CacheService<T = unknown> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private hits: number = 0;
  private misses: number = 0;
  private maxSize: number;
  private defaultTTL: number;

  constructor(maxSize: number = 1000, defaultTTL: number = 300000) { // 5분 기본 TTL
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  /**
   * 캐시에서 데이터 가져오기
   */
  get(key: string): T | null {
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
  set(key: string, data: T, ttl?: number): void {
    // 기존 키가 아닌 경우에만 크기 제한 확인
    if (!this.cache.has(key) && this.cache.size >= this.maxSize) {
      this.evictLeastRecentlyUsed();
    }

    // 기존 항목이 있으면 접근 통계 업데이트
    const existingEntry = this.cache.get(key);
    const now = Date.now();
    
    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      ttl: ttl || this.defaultTTL,
      accessCount: existingEntry ? existingEntry.accessCount + 1 : 0,
      lastAccessed: now // set() 호출 시 lastAccessed를 현재 시간으로 업데이트 (LRU 정확성 보장)
    };

    this.cache.set(key, entry);
  }

  /**
   * 캐시에서 데이터 삭제
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 캐시 비우기
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 캐시에 데이터가 있는지 확인
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
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
  getStats(): CacheStats {
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
  private evictLeastRecentlyUsed(): void {
    let oldestKey = '';
    let oldestTime = Number.MAX_SAFE_INTEGER;

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
  cleanup(): number {
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
  generateSearchKey(query: string, filters?: SearchCacheFilters, limit?: number): string {
    const filterStr = filters ? JSON.stringify(filters) : '';
    return `search:${query}:${filterStr}:${limit || 10}`;
  }

  /**
   * 캐시 키 생성 (메모리용)
   */
  generateMemoryKey(memoryId: string): string {
    return `memory:${memoryId}`;
  }

  /**
   * 캐시 키 생성 (통계용)
   */
  generateStatsKey(type: string): string {
    return `stats:${type}`;
  }

  /**
   * 모든 키 반환
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 모든 값 반환
   */
  values(): T[] {
    return Array.from(this.cache.values()).map(entry => entry.data);
  }

  /**
   * 모든 키-값 쌍 반환
   */
  entries(): [string, T][] {
    return Array.from(this.cache.entries()).map(([key, entry]) => [key, entry.data]);
  }

  /**
   * 각 항목에 대해 콜백 실행
   */
  forEach(callback: (value: T, key: string) => void): void {
    for (const [key, entry] of this.cache) {
      callback(entry.data, key);
    }
  }

  /**
   * 가장 오래된 항목 반환 (LRU)
   */
  getLeastRecentlyUsed(): T | null {
    let oldestKey = '';
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    return oldestKey ? this.cache.get(oldestKey)?.data || null : null;
  }

  /**
   * 캐시 크기 반환
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 메모리 사용량 반환
   */
  getMemoryUsage(): number {
    let memoryUsage = 0;
    for (const [key, entry] of this.cache) {
      memoryUsage += key.length * 2; // 문자열 크기 (UTF-16)
      memoryUsage += JSON.stringify(entry.data).length * 2;
      memoryUsage += 100; // 메타데이터 오버헤드
    }
    return memoryUsage;
  }

  /**
   * 가장 오래된 항목 반환 (타임스탬프 기준)
   */
  getOldestEntry(): T | null {
    let oldestKey = '';
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    return oldestKey ? this.cache.get(oldestKey)?.data || null : null;
  }
}

/**
 * 검색 결과 캐시 서비스
 */
export class SearchCacheService {
  private cache: CacheService<CachedSearchHit[]>;
  private searchStats: Map<string, number> = new Map();
  private queryPatternCache: Map<string, CachedSearchHit[]> = new Map(); // 쿼리 패턴 캐시

  constructor(maxSize: number = 1000, ttl: number = 600000) { // 10분 TTL로 증가
    this.cache = new CacheService<CachedSearchHit[]>(maxSize, ttl);
  }

  /**
   * 검색 결과 캐시에서 가져오기 - 패턴 매칭 개선
   */
  getSearchResults(
    query: string,
    filters?: SearchCacheFilters,
    limit?: number,
  ): CachedSearchHit[] | null {
    // 1. 정확한 키로 먼저 시도
    const exactKey = this.cache.generateSearchKey(query, filters, limit);
    const results = this.cache.get(exactKey);
    
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
  setSearchResults(
    query: string,
    results: CachedSearchHit[],
    filters?: SearchCacheFilters,
    limit?: number,
    ttl?: number,
  ): void {
    const key = this.cache.generateSearchKey(query, filters, limit);
    this.cache.set(key, results, ttl);
    
    // 정규화된 쿼리로도 저장
    const normalizedQuery = this.normalizeQuery(query);
    if (normalizedQuery !== query) {
      // filters를 그대로 전달하여 캐시 키 일관성 유지
      // generateSearchKey 내부에서 filters가 undefined일 때 빈 문자열로 처리하므로
      // filters || {}를 사용하면 캐시 키 불일치 발생
      const normalizedKey = this.cache.generateSearchKey(normalizedQuery, filters, limit);
      this.cache.set(normalizedKey, results, ttl);
    }
    
    // 쿼리 패턴 캐시 업데이트
    this.updateQueryPatternCache(query, results);
  }

  /**
   * 검색 결과 캐시 무효화
   */
  invalidateSearchResults(pattern?: string): void {
    if (pattern) {
      // 패턴에 맞는 키만 삭제
      for (const key of this.cache['cache'].keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    } else {
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
  invalidateByMemoryId(_memoryId: string): void {
    // 메모리 ID가 포함된 검색 결과 캐시 무효화
    this.invalidateSearchResults();
  }

  /**
   * 쿼리 정규화
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ') // 여러 공백을 하나로
      .replace(/[^\w\s가-힣]/g, ''); // 특수문자 제거
  }

  /**
   * 유사한 결과 찾기
   */
  private findSimilarResults(
    normalizedQuery: string,
    _filters?: SearchCacheFilters,
    _limit?: number,
  ): CachedSearchHit[] | null {
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
  private updateQueryPatternCache(query: string, results: CachedSearchHit[]): void {
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
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10),
      patternCacheSize: this.queryPatternCache.size
    };
  }

  /**
   * 캐시 정리
   */
  cleanup(): number {
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
  private cache: CacheService<number[]>;
  private embeddingStats: Map<string, number> = new Map();

  constructor(maxSize: number = 1000, ttl: number = 3600000) { // 1시간 TTL
    this.cache = new CacheService<number[]>(maxSize, ttl);
  }

  /**
   * 임베딩 캐시에서 가져오기
   */
  getEmbedding(text: string): number[] | null {
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
  setEmbedding(text: string, embedding: number[], ttl?: number): void {
    const key = `embedding:${this.hashText(text)}`;
    this.cache.set(key, embedding, ttl);
  }

  /**
   * 텍스트 해시 생성
   */
  private hashText(text: string): string {
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
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
    };
  }

  /**
   * 캐시 정리
   */
  cleanup(): number {
    return this.cache.cleanup();
  }
}

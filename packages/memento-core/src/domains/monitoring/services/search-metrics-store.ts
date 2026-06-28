/**
 * In-memory search performance statistics
 */

export interface SearchStats {
  totalSearches: number;
  totalDuration: number;
  totalSearchTime: number;
  searchesByType: { text: number; vector: number; hybrid: number };
  cacheHits: number;
  cacheMisses: number;
  embeddingSearches: number;
}

export interface SearchMetricsSnapshot {
  totalSearches: number;
  averageSearchTime: number;
  searchByType: { text: number; vector: number; hybrid: number };
  cacheHitRate: number;
  embeddingSearchRate: number;
}

function createEmptyStats(): SearchStats {
  return {
    totalSearches: 0,
    totalDuration: 0,
    totalSearchTime: 0,
    searchesByType: { text: 0, vector: 0, hybrid: 0 },
    cacheHits: 0,
    cacheMisses: 0,
    embeddingSearches: 0
  };
}

export class SearchMetricsStore {
  private stats: SearchStats = createEmptyStats();

  recordSearch(type: 'text' | 'vector' | 'hybrid', duration: number, cacheHit: boolean = false): void {
    this.stats.totalSearches++;
    this.stats.totalDuration += duration;
    this.stats.totalSearchTime += duration;
    this.stats.searchesByType[type]++;

    if (type === 'vector') {
      this.stats.embeddingSearches++;
    }

    if (cacheHit) {
      this.stats.cacheHits++;
    } else {
      this.stats.cacheMisses++;
    }
  }

  getSearchMetrics(): SearchMetricsSnapshot {
    const stats = this.stats;
    const averageSearchTime = stats.totalSearches > 0 ? stats.totalDuration / stats.totalSearches : 0;
    const totalCacheRequests = stats.cacheHits + stats.cacheMisses;
    const cacheHitRate = totalCacheRequests > 0 ? stats.cacheHits / totalCacheRequests : 0;
    const embeddingSearchRate = stats.totalSearches > 0 ? stats.embeddingSearches / stats.totalSearches : 0;

    return {
      totalSearches: stats.totalSearches,
      averageSearchTime,
      searchByType: stats.searchesByType,
      cacheHitRate,
      embeddingSearchRate
    };
  }

  resetStats(): void {
    this.stats = createEmptyStats();
  }

  importFromExportData(search: {
    total?: number;
    totalSearches?: number;
    averageSearchTime?: number;
    searchByType?: { text: number; vector: number; hybrid: number };
    cacheHitRate?: number;
    embeddingSearchRate?: number;
  }): void {
    const totalSearches = search.totalSearches ?? search.total ?? 0;
    const averageSearchTime = search.averageSearchTime ?? 0;
    this.stats = {
      totalSearches,
      totalDuration: averageSearchTime * totalSearches,
      totalSearchTime: averageSearchTime * totalSearches,
      searchesByType: search.searchByType ?? { text: 0, vector: 0, hybrid: 0 },
      cacheHits: Math.round((search.cacheHitRate ?? 0) * totalSearches),
      cacheMisses: Math.round((1 - (search.cacheHitRate ?? 0)) * totalSearches),
      embeddingSearches: Math.round((search.embeddingSearchRate ?? 0) * totalSearches)
    };
  }
}

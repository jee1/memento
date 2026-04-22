import type { ICacheService } from '../../../shared/interfaces/cache.interface.js';

type CacheEntry<T> = {
  data: T;
  timestamp: number;
  ttl: number;
  lastAccessed: number;
};

export class RelationCache<T> implements ICacheService<T> {
  private readonly cache = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly maxSize: number = 1000,
    private readonly defaultTTL: number = 300000,
  ) {}

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    entry.lastAccessed = Date.now();
    return entry.data;
  }

  set(key: string, data: T, ttl: number = this.defaultTTL): void {
    const now = Date.now();
    const existingEntry = this.cache.get(key);

    if (!existingEntry && this.cache.size >= this.maxSize) {
      this.evictLeastRecentlyUsed();
    }

    this.cache.set(key, {
      data,
      timestamp: now,
      ttl,
      lastAccessed: now,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  keys(): string[] {
    this.pruneExpired();
    return [...this.cache.keys()];
  }

  private evictLeastRecentlyUsed(): void {
    let oldestKey: string | undefined;
    let oldestAccess = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestAccess) {
        oldestAccess = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
    }
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }
}

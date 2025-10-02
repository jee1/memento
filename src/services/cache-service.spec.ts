import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheService, type CacheEntry, type CacheStats } from './cache-service.js';

describe('CacheService', () => {
  let cacheService: CacheService<string>;

  beforeEach(() => {
    cacheService = new CacheService<string>(10, 1000); // 10개 최대, 1초 TTL
  });

  describe('생성자', () => {
    it('기본 설정으로 생성되어야 함', () => {
      const defaultCache = new CacheService();
      expect(defaultCache).toBeInstanceOf(CacheService);
    });

    it('사용자 정의 설정으로 생성되어야 함', () => {
      const customCache = new CacheService(100, 5000);
      expect(customCache).toBeInstanceOf(CacheService);
    });
  });

  describe('get', () => {
    it('존재하지 않는 키에 대해 null을 반환해야 함', () => {
      const result = cacheService.get('nonexistent');
      expect(result).toBeNull();
    });

    it('존재하는 키에 대해 데이터를 반환해야 함', () => {
      cacheService.set('test-key', 'test-value');
      const result = cacheService.get('test-key');
      expect(result).toBe('test-value');
    });

    it('만료된 항목에 대해 null을 반환해야 함', async () => {
      cacheService.set('test-key', 'test-value', 100); // 100ms TTL
      
      // 즉시 접근하면 데이터 반환
      expect(cacheService.get('test-key')).toBe('test-value');
      
      // 200ms 후 접근하면 null 반환
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(cacheService.get('test-key')).toBeNull();
    });

    it('접근 시 통계를 업데이트해야 함', () => {
      cacheService.set('test-key', 'test-value');
      
      // 첫 번째 접근 (hit)
      cacheService.get('test-key');
      const stats1 = cacheService.getStats();
      expect(stats1.hits).toBe(1);
      expect(stats1.misses).toBe(0);
      
      // 존재하지 않는 키 접근 (miss)
      cacheService.get('nonexistent');
      const stats2 = cacheService.getStats();
      expect(stats2.hits).toBe(1);
      expect(stats2.misses).toBe(1);
    });

    it('접근 시 lastAccessed를 업데이트해야 함', () => {
      cacheService.set('test-key', 'test-value');
      
      const beforeAccess = Date.now();
      cacheService.get('test-key');
      const afterAccess = Date.now();
      
      const entry = (cacheService as any).cache.get('test-key');
      expect(entry.lastAccessed).toBeGreaterThanOrEqual(beforeAccess);
      expect(entry.lastAccessed).toBeLessThanOrEqual(afterAccess);
    });
  });

  describe('set', () => {
    it('데이터를 성공적으로 저장해야 함', () => {
      cacheService.set('test-key', 'test-value');
      expect(cacheService.get('test-key')).toBe('test-value');
    });

    it('기본 TTL을 사용해야 함', () => {
      cacheService.set('test-key', 'test-value');
      const entry = (cacheService as any).cache.get('test-key');
      expect(entry.ttl).toBe(1000); // 기본 TTL
    });

    it('사용자 정의 TTL을 사용해야 함', () => {
      cacheService.set('test-key', 'test-value', 5000);
      const entry = (cacheService as any).cache.get('test-key');
      expect(entry.ttl).toBe(5000);
    });

    it('기존 키를 덮어써야 함', () => {
      cacheService.set('test-key', 'old-value');
      cacheService.set('test-key', 'new-value');
      expect(cacheService.get('test-key')).toBe('new-value');
    });

    it('최대 크기 초과 시 오래된 항목을 제거해야 함', () => {
      // 캐시를 가득 채움
      for (let i = 0; i < 10; i++) {
        cacheService.set(`key-${i}`, `value-${i}`);
      }
      
      // 새로운 항목 추가 (오래된 항목 제거)
      cacheService.set('new-key', 'new-value');
      
      expect(cacheService.get('key-0')).toBeNull(); // 가장 오래된 항목 제거됨
      expect(cacheService.get('new-key')).toBe('new-value'); // 새 항목은 존재
    });
  });

  describe('delete', () => {
    it('존재하는 키를 삭제해야 함', () => {
      cacheService.set('test-key', 'test-value');
      expect(cacheService.get('test-key')).toBe('test-value');
      
      cacheService.delete('test-key');
      expect(cacheService.get('test-key')).toBeNull();
    });

    it('존재하지 않는 키 삭제 시 false를 반환해야 함', () => {
      const result = cacheService.delete('nonexistent');
      expect(result).toBe(false);
    });

    it('존재하는 키 삭제 시 true를 반환해야 함', () => {
      cacheService.set('test-key', 'test-value');
      const result = cacheService.delete('test-key');
      expect(result).toBe(true);
    });
  });

  describe('clear', () => {
    it('모든 캐시를 비워야 함', () => {
      cacheService.set('key1', 'value1');
      cacheService.set('key2', 'value2');
      
      expect(cacheService.size()).toBe(2);
      
      cacheService.clear();
      
      expect(cacheService.size()).toBe(0);
      expect(cacheService.get('key1')).toBeNull();
      expect(cacheService.get('key2')).toBeNull();
    });
  });

  describe('size', () => {
    it('캐시 크기를 올바르게 반환해야 함', () => {
      expect(cacheService.size()).toBe(0);
      
      cacheService.set('key1', 'value1');
      expect(cacheService.size()).toBe(1);
      
      cacheService.set('key2', 'value2');
      expect(cacheService.size()).toBe(2);
    });
  });

  describe('getStats', () => {
    it('초기 통계를 올바르게 반환해야 함', () => {
      const stats = cacheService.getStats();
      
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.size).toBe(0);
    });

    it('접근 후 통계를 올바르게 업데이트해야 함', () => {
      cacheService.set('test-key', 'test-value');
      
      // Hit
      cacheService.get('test-key');
      // Miss
      cacheService.get('nonexistent');
      
      const stats = cacheService.getStats();
      
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.totalRequests).toBe(2);
      expect(stats.hitRate).toBe(0.5);
      expect(stats.size).toBe(1);
    });

    it('히트율을 올바르게 계산해야 함', () => {
      cacheService.set('test-key', 'test-value');
      
      // 3 hits, 1 miss
      cacheService.get('test-key');
      cacheService.get('test-key');
      cacheService.get('test-key');
      cacheService.get('nonexistent');
      
      const stats = cacheService.getStats();
      expect(stats.hitRate).toBe(0.75);
    });
  });

  describe('cleanup', () => {
    it('만료된 항목들을 제거해야 함', async () => {
      cacheService.set('key1', 'value1', 100); // 100ms TTL
      cacheService.set('key2', 'value2', 2000); // 2초 TTL
      
      expect(cacheService.size()).toBe(2);
      
      // 200ms 후 cleanup
      await new Promise(resolve => setTimeout(resolve, 200));
      cacheService.cleanup();
      
      expect(cacheService.size()).toBe(1);
      expect(cacheService.get('key1')).toBeNull();
      expect(cacheService.get('key2')).toBe('value2');
    });
  });

  describe('getMemoryUsage', () => {
    it('메모리 사용량을 추정해야 함', () => {
      cacheService.set('test-key', 'test-value');
      
      const memoryUsage = cacheService.getMemoryUsage();
      expect(memoryUsage).toBeGreaterThan(0);
    });
  });

  describe('getOldestEntry', () => {
    it('가장 오래된 항목을 반환해야 함', () => {
      cacheService.set('key1', 'value1');
      
      // 약간의 지연
      setTimeout(() => {
        cacheService.set('key2', 'value2');
      }, 10);
      
      const oldest = cacheService.getOldestEntry();
      expect(oldest).toBeDefined();
    });

    it('캐시가 비어있으면 null을 반환해야 함', () => {
      const oldest = cacheService.getOldestEntry();
      expect(oldest).toBeNull();
    });
  });

  describe('getLeastRecentlyUsed', () => {
    it('가장 최근에 사용되지 않은 항목을 반환해야 함', () => {
      cacheService.set('key1', 'value1');
      cacheService.set('key2', 'value2');
      
      // key1을 접근
      cacheService.get('key1');
      
      const lru = cacheService.getLeastRecentlyUsed();
      expect(lru).toBeDefined();
    });

    it('캐시가 비어있으면 null을 반환해야 함', () => {
      const lru = cacheService.getLeastRecentlyUsed();
      expect(lru).toBeNull();
    });
  });

  describe('has', () => {
    it('존재하는 키에 대해 true를 반환해야 함', () => {
      cacheService.set('test-key', 'test-value');
      expect(cacheService.has('test-key')).toBe(true);
    });

    it('존재하지 않는 키에 대해 false를 반환해야 함', () => {
      expect(cacheService.has('nonexistent')).toBe(false);
    });

    it('만료된 키에 대해 false를 반환해야 함', async () => {
      cacheService.set('test-key', 'test-value', 100);
      
      expect(cacheService.has('test-key')).toBe(true);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(cacheService.has('test-key')).toBe(false);
    });
  });

  describe('keys', () => {
    it('모든 키를 반환해야 함', () => {
      cacheService.set('key1', 'value1');
      cacheService.set('key2', 'value2');
      
      const keys = cacheService.keys();
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toHaveLength(2);
    });

    it('빈 캐시에 대해 빈 배열을 반환해야 함', () => {
      const keys = cacheService.keys();
      expect(keys).toEqual([]);
    });
  });

  describe('values', () => {
    it('모든 값을 반환해야 함', () => {
      cacheService.set('key1', 'value1');
      cacheService.set('key2', 'value2');
      
      const values = cacheService.values();
      expect(values).toContain('value1');
      expect(values).toContain('value2');
      expect(values).toHaveLength(2);
    });

    it('빈 캐시에 대해 빈 배열을 반환해야 함', () => {
      const values = cacheService.values();
      expect(values).toEqual([]);
    });
  });

  describe('entries', () => {
    it('모든 키-값 쌍을 반환해야 함', () => {
      cacheService.set('key1', 'value1');
      cacheService.set('key2', 'value2');
      
      const entries = cacheService.entries();
      expect(entries).toHaveLength(2);
      
      const entryMap = new Map(entries);
      expect(entryMap.get('key1')).toBe('value1');
      expect(entryMap.get('key2')).toBe('value2');
    });

    it('빈 캐시에 대해 빈 배열을 반환해야 함', () => {
      const entries = cacheService.entries();
      expect(entries).toEqual([]);
    });
  });

  describe('forEach', () => {
    it('각 항목에 대해 콜백을 실행해야 함', () => {
      cacheService.set('key1', 'value1');
      cacheService.set('key2', 'value2');
      
      const callback = vi.fn();
      cacheService.forEach(callback);
      
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith('value1', 'key1');
      expect(callback).toHaveBeenCalledWith('value2', 'key2');
    });
  });

  describe('LRU 정책', () => {
    it('최대 크기 초과 시 LRU 항목을 제거해야 함', () => {
      // 캐시를 가득 채움
      for (let i = 0; i < 10; i++) {
        cacheService.set(`key-${i}`, `value-${i}`);
      }
      
      // key-0을 접근하여 최근 사용으로 만듦
      cacheService.get('key-0');
      
      // 새로운 항목 추가
      cacheService.set('new-key', 'new-value');
      
      // key-1이 제거되어야 함 (key-0은 최근 접근됨)
      expect(cacheService.get('key-1')).toBeNull();
      expect(cacheService.get('key-0')).toBe('value-0');
      expect(cacheService.get('new-key')).toBe('new-value');
    });
  });
});

/**
 * TripleCacheService 단위 테스트
 * 
 * Given/When/Then 패턴을 따릅니다.
 * 
 * PRD 6.18: 캐싱 테스트 작성
 * - given: 동일한 content
 * - when: 두 번 추출
 * - then: 두 번째는 캐시에서 반환
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TripleCacheService } from '../triple-cache.js';
import type { TripleExtractionResult } from '../../services/triple-extraction/types/triple-extraction.js';

describe('TripleCacheService', () => {
  let cache: TripleCacheService;

  beforeEach(() => {
    cache = new TripleCacheService(100, 6 * 60 * 60 * 1000); // maxSize: 100, TTL: 6시간
  });

  afterEach(() => {
    cache.clear();
  });

  describe('generateCacheKey', () => {
    it('동일한 content는 동일한 캐시 키를 생성해야 함', () => {
      // Given: 동일한 content
      const content = 'Alice works at Microsoft. She is a data scientist.';

      // When: 캐시 키 생성 (두 번)
      const key1 = cache.generateCacheKey(content);
      const key2 = cache.generateCacheKey(content);

      // Then: 동일한 캐시 키 반환
      expect(key1).toBe(key2);
      expect(key1).toMatch(/^triple:[a-f0-9]{64}$/); // SHA-256 해시 형식
    });

    it('다른 content는 다른 캐시 키를 생성해야 함', () => {
      // Given: 다른 content
      const content1 = 'Alice works at Microsoft.';
      const content2 = 'Bob works at Google.';

      // When: 캐시 키 생성
      const key1 = cache.generateCacheKey(content1);
      const key2 = cache.generateCacheKey(content2);

      // Then: 다른 캐시 키 반환
      expect(key1).not.toBe(key2);
    });

    it('공백 차이도 다른 캐시 키를 생성해야 함', () => {
      // Given: 공백만 다른 content
      const content1 = 'Alice works at Microsoft.';
      const content2 = 'Alice  works  at  Microsoft.'; // 공백이 더 많음

      // When: 캐시 키 생성
      const key1 = cache.generateCacheKey(content1);
      const key2 = cache.generateCacheKey(content2);

      // Then: 다른 캐시 키 반환
      expect(key1).not.toBe(key2);
    });
  });

  describe('get / set', () => {
    it('성공한 Triple 추출 결과를 캐시에 저장하고 조회해야 함', () => {
      // Given: 성공한 Triple 추출 결과
      const content = 'Alice works at Microsoft.';
      const result: TripleExtractionResult = {
        triples: [
          {
            subject: 'Alice',
            predicate: 'works_at',
            object: 'Microsoft'
          }
        ],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };

      // When: 캐시에 저장 후 조회
      cache.set(content, result);
      const retrieved = cache.get(content);

      // Then: 저장된 결과가 반환되어야 함
      expect(retrieved).toBeDefined();
      expect(retrieved).toEqual(result);
      expect(retrieved!.triples.length).toBe(1);
      expect(retrieved!.triples[0].subject).toBe('Alice');
    });

    it('실패한 Triple 추출 결과는 캐시에 저장되지 않아야 함', () => {
      // Given: 실패한 Triple 추출 결과 (triples가 빈 배열)
      const content = 'Invalid content.';
      const result: TripleExtractionResult = {
        triples: [],
        extractionInfo: {
          failureReason: 'no_triple',
          steps: {
            canonicalization: false,
            entityLinking: false
          }
        }
      };

      // When: 캐시에 저장 시도 후 조회
      cache.set(content, result);
      const retrieved = cache.get(content);

      // Then: 캐시에 저장되지 않아야 함 (null 반환)
      expect(retrieved).toBeNull();
    });

    it('존재하지 않는 content는 null을 반환해야 함', () => {
      // When: 존재하지 않는 content 조회
      const retrieved = cache.get('Nonexistent content');

      // Then: null 반환
      expect(retrieved).toBeNull();
    });

    it('동일한 content로 두 번 저장하면 마지막 값이 저장되어야 함', () => {
      // Given: 동일한 content에 대한 두 개의 다른 결과
      const content = 'Alice works at Microsoft.';
      const result1: TripleExtractionResult = {
        triples: [
          {
            subject: 'Alice',
            predicate: 'works_at',
            object: 'Microsoft'
          }
        ],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };
      const result2: TripleExtractionResult = {
        triples: [
          {
            subject: 'Alice',
            predicate: 'works_at',
            object: 'Microsoft Corporation'
          }
        ],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };

      // When: 두 번 저장
      cache.set(content, result1);
      cache.set(content, result2);
      const retrieved = cache.get(content);

      // Then: 마지막 값이 반환되어야 함
      expect(retrieved).toBeDefined();
      expect(retrieved!.triples[0].object).toBe('Microsoft Corporation');
    });
  });

  describe('TTL 기반 자동 무효화', () => {
    it('TTL이 만료된 항목은 자동으로 제거되어야 함', () => {
      // Given: 시간 제어
      vi.useFakeTimers();
      const now = new Date('2024-01-01T00:00:00Z');
      vi.setSystemTime(now);

      // 짧은 TTL로 캐시 생성
      const shortTTLCache = new TripleCacheService(100, 1000); // 1초 TTL

      const content = 'Alice works at Microsoft.';
      const result: TripleExtractionResult = {
        triples: [
          {
            subject: 'Alice',
            predicate: 'works_at',
            object: 'Microsoft'
          }
        ],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };

      // 캐시에 저장
      shortTTLCache.set(content, result);
      expect(shortTTLCache.get(content)).toBeDefined();

      // 2초 후
      vi.advanceTimersByTime(2000);
      vi.useRealTimers();

      // When: cleanup 호출
      const cleaned = shortTTLCache.cleanup();

      // Then: 만료된 항목이 제거되어야 함
      expect(cleaned).toBeGreaterThan(0);
      expect(shortTTLCache.get(content)).toBeNull();
    });

    it('TTL이 만료되지 않은 항목은 유지되어야 함', () => {
      // Given: 시간 제어
      vi.useFakeTimers();
      const now = new Date('2024-01-01T00:00:00Z');
      vi.setSystemTime(now);

      // 짧은 TTL로 캐시 생성
      const shortTTLCache = new TripleCacheService(100, 5000); // 5초 TTL

      const content = 'Alice works at Microsoft.';
      const result: TripleExtractionResult = {
        triples: [
          {
            subject: 'Alice',
            predicate: 'works_at',
            object: 'Microsoft'
          }
        ],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };

      // 캐시에 저장
      shortTTLCache.set(content, result);

      // 2초 후 (TTL 미만)
      vi.advanceTimersByTime(2000);
      
      // When: cleanup 호출 (fake timers 유지 상태에서)
      const cleaned = shortTTLCache.cleanup();

      // Then: 만료되지 않은 항목은 유지되어야 함
      expect(cleaned).toBe(0);
      expect(shortTTLCache.get(content)).toBeDefined();
      
      // fake timers 정리
      vi.useRealTimers();
    });
  });

  describe('delete', () => {
    it('캐시에서 항목을 삭제할 수 있어야 함', () => {
      // Given: 캐시에 저장된 항목
      const content = 'Alice works at Microsoft.';
      const result: TripleExtractionResult = {
        triples: [
          {
            subject: 'Alice',
            predicate: 'works_at',
            object: 'Microsoft'
          }
        ],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };

      cache.set(content, result);
      expect(cache.get(content)).toBeDefined();

      // When: 삭제
      const deleted = cache.delete(content);

      // Then: 삭제 성공 및 조회 시 null 반환
      expect(deleted).toBe(true);
      expect(cache.get(content)).toBeNull();
    });

    it('존재하지 않는 항목 삭제 시 false 반환', () => {
      // When: 존재하지 않는 항목 삭제
      const deleted = cache.delete('Nonexistent content');

      // Then: false 반환
      expect(deleted).toBe(false);
    });
  });

  describe('clear', () => {
    it('캐시를 비울 수 있어야 함', () => {
      // Given: 여러 항목이 저장된 캐시
      const content1 = 'Alice works at Microsoft.';
      const content2 = 'Bob works at Google.';
      const result: TripleExtractionResult = {
        triples: [
          {
            subject: 'Alice',
            predicate: 'works_at',
            object: 'Microsoft'
          }
        ],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };

      cache.set(content1, result);
      cache.set(content2, result);
      expect(cache.size()).toBeGreaterThan(0);

      // When: 캐시 비우기
      cache.clear();

      // Then: 모든 항목이 제거되어야 함
      expect(cache.size()).toBe(0);
      expect(cache.get(content1)).toBeNull();
      expect(cache.get(content2)).toBeNull();
    });
  });

  describe('getStats', () => {
    it('캐시 통계를 반환해야 함', () => {
      // Given: 캐시에 저장된 항목
      const content = 'Alice works at Microsoft.';
      const result: TripleExtractionResult = {
        triples: [
          {
            subject: 'Alice',
            predicate: 'works_at',
            object: 'Microsoft'
          }
        ],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };

      cache.set(content, result);

      // When: 통계 조회
      const stats = cache.getStats();

      // Then: 통계 정보가 반환되어야 함
      expect(stats).toBeDefined();
      expect(stats.size).toBeGreaterThan(0);
    });
  });

  describe('size', () => {
    it('캐시 크기를 반환해야 함', () => {
      // Given: 빈 캐시
      expect(cache.size()).toBe(0);

      // When: 항목 저장
      const content = 'Alice works at Microsoft.';
      const result: TripleExtractionResult = {
        triples: [
          {
            subject: 'Alice',
            predicate: 'works_at',
            object: 'Microsoft'
          }
        ],
        extractionInfo: {
          steps: {
            canonicalization: true,
            entityLinking: true
          }
        }
      };

      cache.set(content, result);

      // Then: 크기가 증가해야 함
      expect(cache.size()).toBe(1);
    });
  });
});


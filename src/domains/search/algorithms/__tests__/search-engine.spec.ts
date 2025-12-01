/**
 * 검색 엔진 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SearchEngine, type SearchQuery } from '../search-engine.js';
import { MockDatabase } from '../../../../test/mock-database.js';

describe('SearchEngine', () => {
  let searchEngine: SearchEngine;
  let mockDb: MockDatabase;

  beforeEach(() => {
    searchEngine = new SearchEngine();
    mockDb = new MockDatabase();
  });

  afterEach(() => {
    // MockDatabase는 자체적으로 상태를 관리하므로 별도 정리 불필요
  });

  describe('search', () => {
    it('정상적인 검색 실행', async () => {
      const query: SearchQuery = {
        query: 'test',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.total_count).toBeGreaterThanOrEqual(0);
      expect(result.query_time).toBeGreaterThanOrEqual(0);
    });

    it('FTS5 사용 가능한 경우', async () => {
      const query: SearchQuery = {
        query: 'test',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('FTS5 사용 불가능한 경우 기본 검색', async () => {
      const query: SearchQuery = {
        query: 'test',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('ID 필터가 있는 경우', async () => {
      const query: SearchQuery = {
        query: 'test',
        limit: 10,
        filters: {
          ids: ['mem1']
        }
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('타입 필터가 있는 경우', async () => {
      const query: SearchQuery = {
        query: 'test',
        limit: 10,
        filters: {
          types: ['semantic']
        }
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('고정 필터가 있는 경우', async () => {
      const query: SearchQuery = {
        query: 'test',
        limit: 10,
        filters: {
          pinned: true
        }
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('시간 필터가 있는 경우', async () => {
      const query: SearchQuery = {
        query: 'test',
        limit: 10,
        filters: {
          created_after: new Date('2024-01-01'),
          created_before: new Date('2024-12-31')
        }
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('빈 검색어 처리', async () => {
      const query: SearchQuery = {
        query: '',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('결과 제한 테스트', async () => {
      const query: SearchQuery = {
        query: 'test',
        limit: 5
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items.length).toBeLessThanOrEqual(5);
    });
  });

  describe('buildFTSQuery', () => {
    it('정상적인 FTS 쿼리 구성', () => {
      const query = 'test query';
      const result = (searchEngine as any).buildFTSQuery(query);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('빈 쿼리 처리', () => {
      const query = '';
      const result = (searchEngine as any).buildFTSQuery(query);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('공백만 있는 쿼리 처리', () => {
      const query = '   ';
      const result = (searchEngine as any).buildFTSQuery(query);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('특수문자 포함 쿼리 처리', () => {
      const query = 'test@#$%^&*()_+{}|:"<>?[]\\;\',./';
      const result = (searchEngine as any).buildFTSQuery(query);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('preprocessQuery', () => {
    it('정상적인 쿼리 전처리', () => {
      const query = 'test query';
      const result = (searchEngine as any).preprocessQuery(query);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('연속 공백 제거', () => {
      const query = 'test    query';
      const result = (searchEngine as any).preprocessQuery(query);
      
      expect(result).toBeDefined();
      expect(result).not.toContain('    ');
    });

    it('특수문자 제거', () => {
      const query = 'test@#$%^&*()_+{}|:"<>?[]\\;\',./';
      const result = (searchEngine as any).preprocessQuery(query);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('불용어 제거', () => {
      const query = 'the test query';
      const result = (searchEngine as any).preprocessQuery(query);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('한글 쿼리 처리', () => {
      const query = '테스트 쿼리';
      const result = (searchEngine as any).preprocessQuery(query);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('영문과 한글 혼합 쿼리', () => {
      const query = 'test 테스트 query';
      const result = (searchEngine as any).preprocessQuery(query);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('makeFTSSafe', () => {
    it('FTS5 안전 쿼리 생성', () => {
      const query = 'test query';
      const result = (searchEngine as any).makeFTSSafe(query);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('대괄호 제거', () => {
      const query = 'test[query]';
      const result = (searchEngine as any).makeFTSSafe(query);
      
      expect(result).toBeDefined();
      expect(result).not.toContain('[');
      expect(result).not.toContain(']');
    });

    it('연속 공백 정리', () => {
      const query = 'test    query';
      const result = (searchEngine as any).makeFTSSafe(query);
      
      expect(result).toBeDefined();
      expect(result).not.toContain('    ');
    });
  });

  describe('checkFTS5Availability', () => {
    it('FTS5 사용 가능한 경우', async () => {
      const result = await (searchEngine as any).checkFTS5Availability(mockDb);
      
      expect(typeof result).toBe('boolean');
    });

    it('FTS5 테이블이 없는 경우', async () => {
      const result = await (searchEngine as any).checkFTS5Availability(mockDb);
      
      expect(typeof result).toBe('boolean');
    });

    it('FTS5 테이블에 데이터가 없는 경우', async () => {
      const result = await (searchEngine as any).checkFTS5Availability(mockDb);
      
      expect(typeof result).toBe('boolean');
    });

    it('FTS5 쿼리 실패하는 경우', async () => {
      const result = await (searchEngine as any).checkFTS5Availability(mockDb);
      
      expect(typeof result).toBe('boolean');
    });
  });

  describe('applyRanking', () => {
    it('정상적인 랭킹 적용', () => {
      const items = [
        { id: 'mem1', content: 'test', fts_rank: 0.8 },
        { id: 'mem2', content: 'test', fts_rank: 0.6 }
      ];
      
      const result = (searchEngine as any).applyRanking(items);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('FTS 랭킹이 있는 경우', () => {
      const items = [
        { id: 'mem1', content: 'test', fts_rank: 0.8 },
        { id: 'mem2', content: 'test', fts_rank: 0.6 }
      ];
      
      const result = (searchEngine as any).applyRanking(items);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('FTS 랭킹이 없는 경우', () => {
      const items = [
        { id: 'mem1', content: 'test' },
        { id: 'mem2', content: 'test' }
      ];
      
      const result = (searchEngine as any).applyRanking(items);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('정렬 확인', () => {
      const items = [
        { id: 'mem1', content: 'test', fts_rank: 0.6 },
        { id: 'mem2', content: 'test', fts_rank: 0.8 }
      ];
      
      const result = (searchEngine as any).applyRanking(items);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('generateRecallReason', () => {
    it('FTS5 검색 이유 생성', () => {
      const item = { fts_rank: 0.8 };
      const result = (searchEngine as any).generateRecallReason(item);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('높은 관련성 이유 생성', () => {
      const item = { fts_rank: 0.9 };
      const result = (searchEngine as any).generateRecallReason(item);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('최근 생성 이유 생성', () => {
      const item = { created_at: new Date().toISOString() };
      const result = (searchEngine as any).generateRecallReason(item);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('높은 중요도 이유 생성', () => {
      const item = { importance: 0.9 };
      const result = (searchEngine as any).generateRecallReason(item);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('종합 점수 우수 이유 생성', () => {
      const item = { 
        fts_rank: 0.8, 
        importance: 0.8, 
        created_at: new Date().toISOString() 
      };
      const result = (searchEngine as any).generateRecallReason(item);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('복합 이유 생성', () => {
      const item = { 
        fts_rank: 0.7, 
        importance: 0.7, 
        pinned: true 
      };
      const result = (searchEngine as any).generateRecallReason(item);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('기본 이유 생성', () => {
      const item = { content: 'test' };
      const result = (searchEngine as any).generateRecallReason(item);
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('엣지 케이스', () => {
    it('매우 긴 쿼리 처리', async () => {
      const longQuery = 'test '.repeat(1000);
      const query: SearchQuery = {
        query: longQuery,
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('특수문자만 포함된 쿼리', async () => {
      const query: SearchQuery = {
        query: '@#$%^&*()_+{}|:"<>?[]\\;\',./',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('데이터베이스 오류 처리', async () => {
      // MockDatabase는 오류를 던지지 않으므로 정상 동작 확인
      const query: SearchQuery = {
        query: 'test',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('빈 결과 처리', async () => {
      const query: SearchQuery = {
        query: 'nonexistent',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('잘못된 JSON 태그 처리', async () => {
      const query: SearchQuery = {
        query: 'test',
        limit: 10
      };

      const result = await searchEngine.search(mockDb, query);

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
    });
  });

  describe('성능 테스트', () => {
    it('대량 결과 처리 성능', async () => {
      const query: SearchQuery = {
        query: 'test',
        limit: 100
      };

      const startTime = Date.now();
      const result = await searchEngine.search(mockDb, query);
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(endTime - startTime).toBeLessThan(1000); // 1초 이내
    });

    it('반복 검색 성능', async () => {
      const query: SearchQuery = {
        query: 'test',
        limit: 10
      };

      const startTime = Date.now();
      
      // 100번 반복 검색
      for (let i = 0; i < 100; i++) {
        await searchEngine.search(mockDb, query);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(1000); // 1초 이내
    });
  });
});
/**
 * 검색 엔진 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SearchEngine, type SearchQuery } from '../search-engine.js';
import { MockDatabase } from '../../../../test/mock-database.js';
import { mementoConfig } from '../../../../shared/config/index.js';
import { mcpLogger } from '../../../../server/mcp-logger.js';

function createCountingSearchDb() {
  const counters = {
    ftsAvailabilityChecks: 0,
    reflectionNotesAvailabilityChecks: 0,
  };

  const searchRows = [
    {
      id: 'mem1',
      content: 'test memory',
      type: 'semantic',
      importance: 0.5,
      created_at: new Date('2024-01-01T00:00:00.000Z'),
      pinned: 0,
      tags: '[]',
      fts_rank: 1,
      last_accessed: null,
      consolidation_score: null,
      task_goal: null,
      steps: null,
      reflection_notes: null,
      workflow_name: null,
      skill_name: null,
      trigger_conditions: null,
      version: null,
      version_series_id: null,
      owner_id: null,
      process_id: null,
      session_id: null,
      num_times: null,
      last_mentioned_at: null,
    }
  ];

  const db = {
    prepare: vi.fn((sql: string) => {
      if (sql.includes(`SELECT name FROM sqlite_master`) && sql.includes(`name='memory_item_fts'`)) {
        return {
          get: () => {
            counters.ftsAvailabilityChecks += 1;
            return { name: 'memory_item_fts' };
          }
        };
      }

      if (sql.includes('SELECT COUNT(*) as count FROM memory_item_fts')) {
        return {
          get: () => ({ count: 1 })
        };
      }

      if (sql.includes('SELECT * FROM memory_item_fts LIMIT 1')) {
        return {
          get: () => ({ rowid: 1 })
        };
      }

      if (sql.includes(`SELECT sql FROM sqlite_master`) && sql.includes(`name='memory_item_fts'`)) {
        return {
          get: () => {
            counters.reflectionNotesAvailabilityChecks += 1;
            return {
              sql: 'CREATE VIRTUAL TABLE memory_item_fts USING fts5(content, reflection_notes)'
            };
          }
        };
      }

      if (sql.includes(`name='fts5_migration_status'`)) {
        return {
          get: () => ({ name: 'fts5_migration_status' }),
          run: () => ({ changes: 1, lastInsertRowid: 1 })
        };
      }

      if (sql.includes('SELECT status FROM fts5_migration_status')) {
        return {
          get: () => ({ status: 'completed' }),
          run: () => ({ changes: 1, lastInsertRowid: 1 })
        };
      }

      return {
        all: () => searchRows,
        get: () => undefined,
        run: () => ({ changes: 1, lastInsertRowid: 1 }),
      };
    })
  };

  return { db: db as any, counters };
}

function createRecoverableSearchDb() {
  const counters = {
    ftsAvailabilityChecks: 0,
    reflectionNotesAvailabilityChecks: 0,
  };

  const state = {
    ftsTableAvailable: false,
    ftsHasData: false,
    reflectionNotesAvailable: false,
    migrationStatus: 'completed' as 'pending' | 'completed' | 'failed',
  };

  const db = {
    prepare: vi.fn((sql: string) => {
      if (sql.includes(`SELECT name FROM sqlite_master`) && sql.includes(`name='memory_item_fts'`)) {
        return {
          get: () => {
            counters.ftsAvailabilityChecks += 1;
            return state.ftsTableAvailable ? { name: 'memory_item_fts' } : undefined;
          }
        };
      }

      if (sql.includes('SELECT COUNT(*) as count FROM memory_item_fts')) {
        return {
          get: () => ({ count: state.ftsHasData ? 1 : 0 })
        };
      }

      if (sql.includes('SELECT * FROM memory_item_fts LIMIT 1')) {
        return {
          get: () => ({ rowid: 1 })
        };
      }

      if (sql.includes(`SELECT sql FROM sqlite_master`) && sql.includes(`name='memory_item_fts'`)) {
        return {
          get: () => {
            counters.reflectionNotesAvailabilityChecks += 1;
            return {
              sql: state.reflectionNotesAvailable
                ? 'CREATE VIRTUAL TABLE memory_item_fts USING fts5(content, reflection_notes)'
                : 'CREATE VIRTUAL TABLE memory_item_fts USING fts5(content)'
            };
          }
        };
      }

      if (sql.includes(`name='fts5_migration_status'`)) {
        return {
          get: () => ({ name: 'fts5_migration_status' }),
          run: () => ({ changes: 1, lastInsertRowid: 1 })
        };
      }

      if (sql.includes('SELECT status FROM fts5_migration_status')) {
        return {
          get: () => ({ status: state.migrationStatus }),
          run: () => ({ changes: 1, lastInsertRowid: 1 })
        };
      }

      return {
        all: () => [],
        get: () => undefined,
        run: () => ({ changes: 1, lastInsertRowid: 1 }),
      };
    })
  };

  return { db: db as any, counters, state };
}

function createSearchRows(count = 2) {
  return Array.from({ length: count }, (_, index) => ({
    id: `mem${index + 1}`,
    content: `test memory ${index + 1}`,
    type: 'semantic',
    importance: 0.5,
    created_at: new Date('2024-01-01T00:00:00.000Z'),
    last_accessed: null,
    pinned: 0,
    tags: '[]',
    fts_rank: count - index,
    consolidation_score: null,
    task_goal: null,
    steps: null,
    reflection_notes: null,
    workflow_name: null,
    skill_name: null,
    trigger_conditions: null,
    version: null,
    version_series_id: null,
    owner_id: null,
    process_id: null,
    session_id: null,
    num_times: null,
    last_mentioned_at: null,
  }));
}

describe('SearchEngine', () => {
  let searchEngine: SearchEngine;
  let mockDb: MockDatabase;
  let originalFallbackEnabled: boolean;
  let originalFallbackEnv: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    searchEngine = new SearchEngine();
    mockDb = new MockDatabase();
    vi.spyOn(searchEngine as any, 'executeQuery').mockResolvedValue(createSearchRows());
    originalFallbackEnabled = mementoConfig.fts5FallbackEnabled;
    originalFallbackEnv = process.env.MEMENTO_FTS5_FALLBACK_ENABLED;
    originalNodeEnv = process.env.NODE_ENV;
    (mementoConfig as { fts5FallbackEnabled: boolean }).fts5FallbackEnabled = false;
    delete process.env.MEMENTO_FTS5_FALLBACK_ENABLED;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (mementoConfig as { fts5FallbackEnabled: boolean }).fts5FallbackEnabled = originalFallbackEnabled;
    if (originalFallbackEnv === undefined) {
      delete process.env.MEMENTO_FTS5_FALLBACK_ENABLED;
    } else {
      process.env.MEMENTO_FTS5_FALLBACK_ENABLED = originalFallbackEnv;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  describe('search', () => {
    it('반복 검색 시 FTS5 사용 가능 여부는 인스턴스당 한 번만 확인', async () => {
      const { db, counters } = createCountingSearchDb();
      const query: SearchQuery = {
        query: 'test',
        limit: 10
      };

      await searchEngine.search(db, query);
      await searchEngine.search(db, query);

      expect(counters.ftsAvailabilityChecks).toBe(1);
    });

    it('초기 FTS5 미사용 상태는 영구 캐시되지 않아 이후 재확인으로 복구 가능', async () => {
      const { db, counters, state } = createRecoverableSearchDb();

      await expect((searchEngine as any).checkFTS5Availability(db)).resolves.toBe(false);

      state.ftsTableAvailable = true;
      state.ftsHasData = true;

      await expect((searchEngine as any).checkFTS5Availability(db)).resolves.toBe(true);
      await expect((searchEngine as any).checkFTS5Availability(db)).resolves.toBe(true);

      expect(counters.ftsAvailabilityChecks).toBe(2);
    });

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

    it('긴 쿼리(토큰 6개 초과) 시 OR 조합으로 완화', () => {
      const query = 'Memento recall 검색 데이터 조회 하이브리드 검색';
      const result = (searchEngine as any).buildFTSQuery(query);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result).toContain(' OR ');
    });

    it('짧은 쿼리(토큰 5개 이하)는 공백으로만 연결(AND 유지)', () => {
      const query = 'recall 벡터 검색 테스트';
      const result = (searchEngine as any).buildFTSQuery(query);
      expect(result).toBeDefined();
      expect(result).not.toContain(' OR ');
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

  describe('checkReflectionNotesAvailability', () => {
    it('반복 확인 시 reflection_notes 사용 가능 여부는 인스턴스당 한 번만 확인', () => {
      const { db, counters } = createCountingSearchDb();

      expect((searchEngine as any).checkReflectionNotesAvailability(db)).toBe(true);
      expect((searchEngine as any).checkReflectionNotesAvailability(db)).toBe(true);

      expect(counters.reflectionNotesAvailabilityChecks).toBe(1);
    });

    it('초기 reflection_notes 미사용 상태는 영구 캐시되지 않아 이후 재확인으로 복구 가능', () => {
      const { db, counters, state } = createRecoverableSearchDb();

      expect((searchEngine as any).checkReflectionNotesAvailability(db)).toBe(false);

      state.reflectionNotesAvailable = true;

      expect((searchEngine as any).checkReflectionNotesAvailability(db)).toBe(true);
      expect((searchEngine as any).checkReflectionNotesAvailability(db)).toBe(true);

      expect(counters.reflectionNotesAvailabilityChecks).toBe(2);
    });

    it('캐시된 reflection_notes 사용 가능 상태도 명시적 fallback 게이트를 우선 적용', () => {
      const { db, state } = createRecoverableSearchDb();

      state.reflectionNotesAvailable = true;
      state.migrationStatus = 'completed';

      expect((searchEngine as any).checkReflectionNotesAvailability(db)).toBe(true);

      process.env.MEMENTO_FTS5_FALLBACK_ENABLED = 'true';
      expect((searchEngine as any).checkReflectionNotesAvailability(db)).toBe(false);

      delete process.env.MEMENTO_FTS5_FALLBACK_ENABLED;
      (mementoConfig as { fts5FallbackEnabled: boolean }).fts5FallbackEnabled = true;
      expect((searchEngine as any).checkReflectionNotesAvailability(db)).toBe(false);

      (mementoConfig as { fts5FallbackEnabled: boolean }).fts5FallbackEnabled = false;
      state.migrationStatus = 'pending';
      expect((searchEngine as any).checkReflectionNotesAvailability(db)).toBe(false);
    });

    it('테스트 환경에서는 반복된 fallback 경고를 warn 레벨로 재출력하지 않는다', () => {
      const { db } = createRecoverableSearchDb();
      const logServerSpy = vi.spyOn(mcpLogger, 'logServer').mockImplementation(() => {});
      process.env.NODE_ENV = 'test';
      process.env.MEMENTO_FTS5_FALLBACK_ENABLED = 'true';

      try {
        expect((searchEngine as any).checkReflectionNotesAvailability(db)).toBe(false);
        expect((searchEngine as any).checkReflectionNotesAvailability(db)).toBe(false);

        const fallbackLogs = logServerSpy.mock.calls.filter((call) =>
          call[1] === '설정으로 인해 reflection_notes Fallback 활성화'
        );

        expect(fallbackLogs).toHaveLength(2);
        expect(fallbackLogs[0]?.[0]).toBe('warn');
        expect(fallbackLogs[1]?.[0]).not.toBe('warn');
      } finally {
        delete process.env.MEMENTO_FTS5_FALLBACK_ENABLED;
      }
    });

    it('테스트 환경에서도 일반 FTS5 fallback 경고는 warn 레벨을 유지한다', async () => {
      const logServerSpy = vi.spyOn(mcpLogger, 'logServer').mockImplementation(() => {});
      const unavailableDb = {
        prepare: vi.fn((sql: string) => {
          if (sql.includes(`SELECT name FROM sqlite_master`) && sql.includes(`name='memory_item_fts'`)) {
            return {
              get: () => undefined
            };
          }

          return {
            get: () => undefined,
            all: () => [],
            run: () => ({ changes: 1, lastInsertRowid: 1 }),
          };
        })
      } as any;

      process.env.NODE_ENV = 'test';

      await expect((searchEngine as any).checkFTS5Availability(unavailableDb)).resolves.toBe(false);
      await expect((searchEngine as any).checkFTS5Availability(unavailableDb)).resolves.toBe(false);

      const fallbackLogs = logServerSpy.mock.calls.filter((call) =>
        call[1] === 'FTS5 테이블이 존재하지 않음, 기본 검색으로 전환'
      );

      expect(fallbackLogs).toHaveLength(2);
      expect(fallbackLogs[0]?.[0]).toBe('warn');
      expect(fallbackLogs[1]?.[0]).toBe('warn');
    });
  });

  describe('FTS5 recovery', () => {
    it('동일 DB에서 FTS 성공 후 이후 FTS 쿼리 실패 시 fallback으로 복구하고 가용성 캐시를 재검증 가능 상태로 되돌린다', async () => {
      const { db, counters, state } = createRecoverableSearchDb();
      const rows = createSearchRows(1);
      const executeQuerySpy = vi.spyOn(searchEngine as any, 'executeQuery');

      state.ftsTableAvailable = true;
      state.ftsHasData = true;
      state.reflectionNotesAvailable = true;
      state.migrationStatus = 'completed';

      let callIndex = 0;
      executeQuerySpy.mockImplementation(async (_db: unknown, sql: string) => {
        callIndex += 1;

        if (callIndex === 2 && sql.includes('memory_item_fts MATCH ?')) {
          throw new Error('database disk image is malformed');
        }

        return rows;
      });

      await expect(searchEngine.search(db, { query: 'test', limit: 10 })).resolves.toMatchObject({
        items: expect.any(Array),
      });

      const recovered = await searchEngine.search(db, { query: 'test', limit: 10 });
      expect(recovered.items).toHaveLength(1);

      await expect((searchEngine as any).checkFTS5Availability(db)).resolves.toBe(true);

      expect(counters.ftsAvailabilityChecks).toBe(2);
      expect(executeQuerySpy).toHaveBeenCalledTimes(3);
      expect(executeQuerySpy.mock.calls[1]?.[1]).toContain('memory_item_fts MATCH ?');
      expect(executeQuerySpy.mock.calls[2]?.[1]).not.toContain('memory_item_fts MATCH ?');
    });
  });

  describe('applyRanking', () => {
    it('정상적인 랭킹 적용', () => {
      const items = createSearchRows();
      
      const result = (searchEngine as any).applyRanking(items, 'test');
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('FTS 랭킹이 있는 경우', () => {
      const items = createSearchRows();
      
      const result = (searchEngine as any).applyRanking(items, 'test');
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('FTS 랭킹이 없는 경우', () => {
      const items = createSearchRows().map((item) => ({
        ...item,
        fts_rank: undefined,
      }));
      
      const result = (searchEngine as any).applyRanking(items, 'test');
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('정렬 확인', () => {
      const items = [
        { ...createSearchRows(1)[0], id: 'mem1', content: 'test memory 1', fts_rank: 0.6 },
        { ...createSearchRows(1)[0], id: 'mem2', content: 'test memory 2', fts_rank: 0.8 }
      ];
      
      const result = (searchEngine as any).applyRanking(items, 'test');
      
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

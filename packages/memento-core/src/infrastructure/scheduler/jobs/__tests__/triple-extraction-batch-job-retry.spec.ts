/**
 * T016: batch policy · eligibility · retry transition
 *
 * 순수 정책 해석(resolveTripleExtractionBatchPolicy), 순수 재시도 자격 판정
 * (parseRetryEligibility), 정렬된 스냅샷 위에서의 후보 선택(selectTripleExtractionCandidates),
 * 그리고 canonical metadata 빌더를 검증한다.
 *
 * 하드 규칙:
 * - 잘못된 설정은 DB 접근 전에 예외를 던진다.
 * - 재시도 metadata는 손상 시에도 절대 보정/기본값 대체하지 않고 제외 사유를 반환한다.
 * - parallelism은 정확히 1이어야 한다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { DAY_MS } from '../../../../shared/utils/date.js';
import type { TripleExtractionTargetMemory } from '../triple-extraction-batch-job/triple-extraction-batch-job.types.js';
import {
  resolveTripleExtractionBatchPolicy,
  resolveTripleExtractionBackoffDays,
  parseRetryEligibility,
  selectTripleExtractionCandidates
} from '../triple-extraction-batch-job/triple-extraction-batch-job-retry.js';
import {
  buildTripleExtractionSuccessMetadata,
  buildTripleExtractionFailedMetadata,
  buildTripleExtractionAbandonedMetadata
} from '../triple-extraction-batch-job/triple-extraction-batch-job-memory-status.js';

const DEFAULT_POLICY = resolveTripleExtractionBatchPolicy(undefined);

function makeMemory(overrides: Partial<TripleExtractionTargetMemory>): TripleExtractionTargetMemory {
  return {
    id: 'mem_default',
    content: 'content',
    importance: 0.5,
    triple_extracted: null,
    triple_extracted_status: null,
    triple_extraction_metadata: null,
    ...overrides
  };
}

describe('resolveTripleExtractionBatchPolicy', () => {
  it('undefined config 전체에 기본값을 적용한다', () => {
    const policy = resolveTripleExtractionBatchPolicy(undefined);
    expect(policy).toEqual({
      batchSize: 10,
      timeout: 30000,
      maxRetries: 3,
      retryBackoffDays: [1, 2, 4],
      chunkSize: 5,
      chunkDelayMs: 100,
      parallelism: 1
    });
  });

  it('생략(undefined)된 필드에만 기본값을 적용하고 명시된 필드는 그대로 둔다', () => {
    const policy = resolveTripleExtractionBatchPolicy({ batchSize: 20, maxRetries: 5 });
    expect(policy.batchSize).toBe(20);
    expect(policy.maxRetries).toBe(5);
    expect(policy.timeout).toBe(30000);
    expect(policy.chunkSize).toBe(5);
    expect(policy.chunkDelayMs).toBe(100);
    expect(policy.retryBackoffDays).toEqual([1, 2, 4]);
    expect(policy.parallelism).toBe(1);
  });

  it('timeout=0, chunkDelayMs=0, retryBackoffDays=[0]은 유효하다 (0 허용 경계)', () => {
    const policy = resolveTripleExtractionBatchPolicy({
      timeout: 0,
      chunkDelayMs: 0,
      retryBackoffDays: [0]
    });
    expect(policy.timeout).toBe(0);
    expect(policy.chunkDelayMs).toBe(0);
    expect(policy.retryBackoffDays).toEqual([0]);
  });

  it('parallelism은 명시적으로 1일 때만 통과한다', () => {
    expect(resolveTripleExtractionBatchPolicy({ parallelism: 1 }).parallelism).toBe(1);
  });

  it('Number.MAX_SAFE_INTEGER는 유효한 positive safe integer이다', () => {
    const policy = resolveTripleExtractionBatchPolicy({ batchSize: Number.MAX_SAFE_INTEGER });
    expect(policy.batchSize).toBe(Number.MAX_SAFE_INTEGER);
  });

  describe('DB 접근 전에 던지는 실행 정책 오류', () => {
    it('parallelism이 1이 아니면 DB 핸들 없이도 즉시 예외를 던진다', () => {
      // resolveTripleExtractionBatchPolicy는 db 인자를 받지 않으므로,
      // 이 테스트는 db 인스턴스를 전혀 생성하지 않고도 정책 검증이 완료됨을 증명한다.
      expect(() => resolveTripleExtractionBatchPolicy({ parallelism: 2 })).toThrow();
    });

    it.each([
      ['batchSize', 0],
      ['batchSize', -1],
      ['batchSize', 1.5],
      ['batchSize', null],
      ['batchSize', true],
      ['batchSize', '10'],
      ['batchSize', NaN],
      ['batchSize', Infinity],
      ['batchSize', Number.MAX_SAFE_INTEGER + 1],
      ['maxRetries', 0],
      ['maxRetries', -1],
      ['maxRetries', 2.5],
      ['maxRetries', null],
      ['maxRetries', false],
      ['maxRetries', '3'],
      ['chunkSize', 0],
      ['chunkSize', -5],
      ['chunkSize', null],
      ['chunkSize', '5']
    ])('%s=%p 는 positive safe integer가 아니므로 예외를 던진다', (field, value) => {
      expect(() => resolveTripleExtractionBatchPolicy({ [field]: value } as never)).toThrow();
    });

    it.each([
      ['timeout', -1],
      ['timeout', null],
      ['timeout', true],
      ['timeout', '0'],
      ['timeout', NaN],
      ['timeout', Infinity],
      ['chunkDelayMs', -1],
      ['chunkDelayMs', null],
      ['chunkDelayMs', '100'],
      ['chunkDelayMs', NaN]
    ])('%s=%p 는 non-negative finite number가 아니므로 예외를 던진다', (field, value) => {
      expect(() => resolveTripleExtractionBatchPolicy({ [field]: value } as never)).toThrow();
    });

    // 인덱스 1이 비어 있는 sparse 배열 (literal sparse-array 문법은 lint 금지이므로 직접 구성한다)
    const sparseRetryBackoffDays: number[] = [];
    sparseRetryBackoffDays[0] = 1;
    sparseRetryBackoffDays[2] = 3;

    it.each([
      ['null', null],
      ['boolean', true],
      ['numeric string', '1,2,4'],
      ['empty array', []],
      ['sparse array', sparseRetryBackoffDays],
      ['negative element', [1, -1, 2]],
      ['non-number element', [1, 'a' as unknown as number, 2]],
      ['NaN element', [1, NaN, 2]],
      ['Infinity element', [1, Infinity, 2]]
    ])('retryBackoffDays가 %s이면 예외를 던진다', (_label, value) => {
      expect(() => resolveTripleExtractionBatchPolicy({ retryBackoffDays: value as number[] })).toThrow();
    });

    it.each([0, 2, -1, '1', true, null])('parallelism=%p 는 정확히 1이 아니므로 예외를 던진다', (value) => {
      expect(() => resolveTripleExtractionBatchPolicy({ parallelism: value as number })).toThrow();
    });
  });
});

describe('resolveTripleExtractionBackoffDays (backoff last-value repeat)', () => {
  const policy = resolveTripleExtractionBatchPolicy({ retryBackoffDays: [1, 2, 4] });

  it.each([
    [1, 1],
    [2, 2],
    [3, 4],
    [4, 4],
    [10, 4]
  ])('newRetryCount=%i 이면 backoffDays=%i (배열 소진 후 마지막 값 반복)', (newRetryCount, expected) => {
    expect(resolveTripleExtractionBackoffDays(policy, newRetryCount)).toBe(expected);
  });

  it('newRetryCount가 0 이하인 방어적 입력은 첫 배열 값을 사용한다', () => {
    expect(resolveTripleExtractionBackoffDays(policy, 0)).toBe(1);
  });
});

describe('parseRetryEligibility', () => {
  describe('consistent status tuples only', () => {
    it('미처리(status=null, triple_extracted=null)는 항상 자격 있음(retryCount=0)', () => {
      const memory = makeMemory({ triple_extracted_status: null, triple_extracted: null });
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, new Date())).toEqual({
        eligible: true,
        retryCount: 0
      });
    });

    it("미처리(status='', triple_extracted=0)도 자격 있음(retryCount=0)", () => {
      const memory = makeMemory({ triple_extracted_status: '', triple_extracted: 0 });
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, new Date())).toEqual({
        eligible: true,
        retryCount: 0
      });
    });

    it('status=null인데 triple_extracted=1인 불일치 튜플은 자격 없음', () => {
      const memory = makeMemory({ triple_extracted_status: null, triple_extracted: 1 });
      const result = parseRetryEligibility(memory, DEFAULT_POLICY, new Date());
      expect(result.eligible).toBe(false);
    });

    it("status='failed'인데 triple_extracted=1인 불일치 튜플은 자격 없음", () => {
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 1,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 1,
          last_attempt: new Date().toISOString(),
          next_retry_after_days: 1
        })
      });
      const result = parseRetryEligibility(memory, DEFAULT_POLICY, new Date());
      expect(result.eligible).toBe(false);
    });

    it("status='success'는 재시도 대상이 아니므로 자격 없음", () => {
      const memory = makeMemory({ triple_extracted_status: 'success', triple_extracted: 1 });
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, new Date()).eligible).toBe(false);
    });

    it("status='abandoned'는 재시도 대상이 아니므로 자격 없음", () => {
      const memory = makeMemory({ triple_extracted_status: 'abandoned', triple_extracted: 0 });
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, new Date()).eligible).toBe(false);
    });
  });

  describe('corrupt metadata isolation (never repair/default-on-corruption)', () => {
    it('metadata가 잘못된 JSON이면 보정하지 않고 제외 사유를 반환한다', () => {
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: '{not-json'
      });
      const result = parseRetryEligibility(memory, DEFAULT_POLICY, new Date());
      expect(result).toEqual({ eligible: false, reason: expect.any(String) });
      expect((result as { reason: string }).reason).not.toBe('');
    });

    it('metadata가 JSON object가 아니면(배열) 제외 사유를 반환한다', () => {
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify([1, 2, 3])
      });
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, new Date()).eligible).toBe(false);
    });

    it('retry_count가 음수/실수/문자열이면 보정하지 않고 제외한다', () => {
      for (const badRetryCount of [-1, 1.5, '1']) {
        const memory = makeMemory({
          triple_extracted_status: 'failed',
          triple_extracted: 0,
          triple_extraction_metadata: JSON.stringify({
            retry_count: badRetryCount,
            last_attempt: new Date().toISOString(),
            next_retry_after_days: 1
          })
        });
        expect(parseRetryEligibility(memory, DEFAULT_POLICY, new Date()).eligible).toBe(false);
      }
    });

    it('last_attempt에 시간대 정보가 없으면(zoned UTC 아님) 제외한다', () => {
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 1,
          last_attempt: '2026-01-01T00:00:00', // 'Z'/offset 없음
          next_retry_after_days: 1
        })
      });
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, new Date()).eligible).toBe(false);
    });

    it('next_retry_after_days가 음수/NaN/Infinity면 제외한다', () => {
      for (const bad of [-1, NaN, Infinity]) {
        const memory = makeMemory({
          triple_extracted_status: 'failed',
          triple_extracted: 0,
          triple_extraction_metadata: JSON.stringify({
            retry_count: 1,
            last_attempt: new Date().toISOString(),
            next_retry_after_days: bad
          })
        });
        expect(parseRetryEligibility(memory, DEFAULT_POLICY, new Date()).eligible).toBe(false);
      }
    });
  });

  describe('legacy missing metadata', () => {
    it('metadata 자체가 없으면(레거시) 제외 사유를 반환한다 (기본값 대체 금지)', () => {
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: null
      });
      const result = parseRetryEligibility(memory, DEFAULT_POLICY, new Date());
      expect(result).toEqual({ eligible: false, reason: expect.any(String) });
    });

    it('metadata에 next_retry_after_days 키가 없으면(구 스키마) 제외 사유를 반환한다', () => {
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 1,
          last_attempt: new Date().toISOString()
        })
      });
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, new Date()).eligible).toBe(false);
    });
  });

  describe('exact due + 24h fractional 단위 경계', () => {
    it('정확히 due 시각과 같으면 자격 있음(동일 시각 포함)', () => {
      const now = new Date('2026-01-10T00:00:00.000Z');
      const lastAttempt = new Date(now.getTime() - 1 * DAY_MS);
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 1,
          last_attempt: lastAttempt.toISOString(),
          next_retry_after_days: 1
        })
      });
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, now)).toEqual({
        eligible: true,
        retryCount: 1
      });
    });

    it('due 1ms 전이면 자격 없음', () => {
      const now = new Date('2026-01-10T00:00:00.000Z');
      const lastAttempt = new Date(now.getTime() - 1 * DAY_MS + 1);
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 1,
          last_attempt: lastAttempt.toISOString(),
          next_retry_after_days: 1
        })
      });
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, now).eligible).toBe(false);
    });

    it('24h의 소수 단위(1.5일=36시간)도 정확히 계산한다', () => {
      const now = new Date('2026-01-10T12:00:00.000Z');
      const lastAttempt = new Date(now.getTime() - 1.5 * DAY_MS);
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 1,
          last_attempt: lastAttempt.toISOString(),
          next_retry_after_days: 1.5
        })
      });
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, now).eligible).toBe(true);

      const notYetDue = new Date(now.getTime() - 1);
      const memoryNotDue = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 1,
          last_attempt: notYetDue.toISOString(),
          next_retry_after_days: 1.5
        })
      });
      expect(parseRetryEligibility(memoryNotDue, DEFAULT_POLICY, now).eligible).toBe(false);
    });
  });

  describe('timezone / overflow / future', () => {
    it('+09:00 오프셋 timestamp도 UTC와 동등하게 계산한다', () => {
      // 2026-01-10T09:00:00+09:00 === 2026-01-10T00:00:00Z
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 1,
          last_attempt: '2026-01-09T09:00:00+09:00',
          next_retry_after_days: 1
        })
      });
      const now = new Date('2026-01-10T00:00:00.000Z');
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, now)).toEqual({
        eligible: true,
        retryCount: 1
      });
    });

    it('next_retry_after_days가 극단적으로 크면 overflow 되어도 크래시 없이 자격 없음으로 처리한다', () => {
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 1,
          last_attempt: new Date().toISOString(),
          next_retry_after_days: Number.MAX_VALUE
        })
      });
      expect(() => parseRetryEligibility(memory, DEFAULT_POLICY, new Date())).not.toThrow();
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, new Date()).eligible).toBe(false);
    });

    it('last_attempt가 미래 시각이면 아직 due가 아니므로 자격 없음', () => {
      const now = new Date('2026-01-10T00:00:00.000Z');
      const future = new Date(now.getTime() + DAY_MS);
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 1,
          last_attempt: future.toISOString(),
          next_retry_after_days: 1
        })
      });
      expect(parseRetryEligibility(memory, DEFAULT_POLICY, now).eligible).toBe(false);
    });
  });

  describe('maxRetries first-attempt semantics', () => {
    it('저장된 retryCount가 maxRetries 미만이면 자격 있음 (최초 시도를 포함해 카운트)', () => {
      const policy = resolveTripleExtractionBatchPolicy({ maxRetries: 3 });
      const now = new Date('2026-01-10T00:00:00.000Z');
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 2,
          last_attempt: new Date(now.getTime() - DAY_MS).toISOString(),
          next_retry_after_days: 1
        })
      });
      expect(parseRetryEligibility(memory, policy, now)).toEqual({ eligible: true, retryCount: 2 });
    });

    it('저장된 retryCount가 maxRetries에 도달하면 자격 없음 (경계값 포함)', () => {
      const policy = resolveTripleExtractionBatchPolicy({ maxRetries: 3 });
      const now = new Date('2026-01-10T00:00:00.000Z');
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 3,
          last_attempt: new Date(now.getTime() - DAY_MS).toISOString(),
          next_retry_after_days: 1
        })
      });
      expect(parseRetryEligibility(memory, policy, now)).toEqual({
        eligible: false,
        reason: 'max_retries_reached'
      });
    });

    it('maxRetries=1이면 최초 실패 직후(retry_count=1) 즉시 자격 없음이 된다', () => {
      const policy = resolveTripleExtractionBatchPolicy({ maxRetries: 1 });
      const now = new Date('2026-01-10T00:00:00.000Z');
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 1,
          last_attempt: new Date(now.getTime() - DAY_MS).toISOString(),
          next_retry_after_days: 1
        })
      });
      expect(parseRetryEligibility(memory, policy, now).eligible).toBe(false);
    });

    it('eligibility가 max_retries보다 due 판정에 우선하지 않는다 (max_retries 먼저 판정)', () => {
      // due는 지났지만 max_retries에 도달한 경우에도 자격 없음이어야 한다.
      const policy = resolveTripleExtractionBatchPolicy({ maxRetries: 2 });
      const now = new Date('2026-02-01T00:00:00.000Z');
      const memory = makeMemory({
        triple_extracted_status: 'failed',
        triple_extracted: 0,
        triple_extraction_metadata: JSON.stringify({
          retry_count: 2,
          last_attempt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
          next_retry_after_days: 1
        })
      });
      expect(parseRetryEligibility(memory, policy, now)).toEqual({
        eligible: false,
        reason: 'max_retries_reached'
      });
    });
  });
});

describe('selectTripleExtractionCandidates', () => {
  let db: Database.Database;

  function initTestDatabase(): Database.Database {
    const testDb = new Database(':memory:');
    DatabaseUtils.run(testDb, `
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL,
        triple_extracted INTEGER,
        triple_extracted_status TEXT,
        triple_extraction_metadata TEXT,
        is_deleted INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);
    return testDb;
  }

  function insertMemory(row: {
    id: string;
    type?: string;
    createdAt: string;
    tripleExtracted?: number | null;
    status?: string | null;
    metadata?: string | null;
    isDeleted?: number | null;
  }): void {
    DatabaseUtils.run(db, `
      INSERT INTO memory_item
        (id, type, content, importance, triple_extracted, triple_extracted_status, triple_extraction_metadata, is_deleted, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      row.id,
      row.type ?? 'episodic',
      `content for ${row.id}`,
      0.5,
      row.tripleExtracted ?? null,
      row.status ?? null,
      row.metadata ?? null,
      row.isDeleted ?? null,
      row.createdAt
    ]);
  }

  beforeEach(() => {
    db = initTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it('fixed sorted snapshot: created_at ASC, id ASC 순으로 정렬한다', () => {
    insertMemory({ id: 'b', createdAt: '2026-01-01T00:00:00.000Z' });
    insertMemory({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }); // 동일 created_at, id로 tie-break
    insertMemory({ id: 'z', createdAt: '2025-12-31T00:00:00.000Z' }); // 더 이른 created_at

    const result = selectTripleExtractionCandidates(db, DEFAULT_POLICY, new Date());
    expect(result.map((m) => m.id)).toEqual(['z', 'a', 'b']);
  });

  it('eligibility가 batchSize 제한보다 먼저 적용된다 (limit-then-filter가 아님)', () => {
    // 정렬 순서상 앞쪽 2개는 아직 due가 아니라 제외되고, batchSize=2를 채우기 위해
    // 뒤쪽의 자격 있는 항목까지 스캔해야 한다.
    const now = new Date('2026-01-10T00:00:00.000Z');
    const notDueMetadata = JSON.stringify({
      retry_count: 1,
      last_attempt: now.toISOString(), // 방금 시도, 아직 backoff 안 지남
      next_retry_after_days: 10
    });

    insertMemory({ id: '1', createdAt: '2026-01-01T00:00:00.000Z', tripleExtracted: 0, status: 'failed', metadata: notDueMetadata });
    insertMemory({ id: '2', createdAt: '2026-01-02T00:00:00.000Z', tripleExtracted: 0, status: 'failed', metadata: notDueMetadata });
    insertMemory({ id: '3', createdAt: '2026-01-03T00:00:00.000Z' }); // 미처리, 자격 있음
    insertMemory({ id: '4', createdAt: '2026-01-04T00:00:00.000Z' }); // 미처리, 자격 있음
    insertMemory({ id: '5', createdAt: '2026-01-05T00:00:00.000Z' }); // 미처리, 자격 있음 (batchSize 초과분)

    const policy = resolveTripleExtractionBatchPolicy({ batchSize: 2 });
    const result = selectTripleExtractionCandidates(db, policy, now);

    expect(result.map((m) => m.id)).toEqual(['3', '4']);
  });

  it('consistent status tuples only: success/abandoned/불일치 튜플은 후보에서 제외한다', () => {
    insertMemory({ id: 'success', createdAt: '2026-01-01T00:00:00.000Z', tripleExtracted: 1, status: 'success' });
    insertMemory({ id: 'abandoned', createdAt: '2026-01-02T00:00:00.000Z', tripleExtracted: 0, status: 'abandoned' });
    insertMemory({ id: 'inconsistent', createdAt: '2026-01-03T00:00:00.000Z', tripleExtracted: 1, status: null });
    insertMemory({ id: 'valid', createdAt: '2026-01-04T00:00:00.000Z', tripleExtracted: null, status: null });

    const result = selectTripleExtractionCandidates(db, DEFAULT_POLICY, new Date());
    expect(result.map((m) => m.id)).toEqual(['valid']);
  });

  it('corrupt metadata isolation: 손상된 metadata를 가진 행은 격리 제외되고 나머지는 정상 반환된다', () => {
    insertMemory({
      id: 'corrupt',
      createdAt: '2026-01-01T00:00:00.000Z',
      tripleExtracted: 0,
      status: 'failed',
      metadata: '{not-json'
    });
    insertMemory({ id: 'clean', createdAt: '2026-01-02T00:00:00.000Z' });

    expect(() => selectTripleExtractionCandidates(db, DEFAULT_POLICY, new Date())).not.toThrow();
    const result = selectTripleExtractionCandidates(db, DEFAULT_POLICY, new Date());
    expect(result.map((m) => m.id)).toEqual(['clean']);
  });

  it('legacy missing metadata isolation: metadata가 없는 failed 행은 제외되고 나머지는 반환된다', () => {
    insertMemory({
      id: 'legacy',
      createdAt: '2026-01-01T00:00:00.000Z',
      tripleExtracted: 0,
      status: 'failed',
      metadata: null
    });
    insertMemory({ id: 'clean', createdAt: '2026-01-02T00:00:00.000Z' });

    const result = selectTripleExtractionCandidates(db, DEFAULT_POLICY, new Date());
    expect(result.map((m) => m.id)).toEqual(['clean']);
  });

  it('삭제된(is_deleted=1) episodic memory는 active가 아니므로 후보에서 제외한다', () => {
    insertMemory({ id: 'deleted', createdAt: '2026-01-01T00:00:00.000Z', isDeleted: 1 });
    insertMemory({ id: 'active', createdAt: '2026-01-02T00:00:00.000Z' });

    const result = selectTripleExtractionCandidates(db, DEFAULT_POLICY, new Date());
    expect(result.map((m) => m.id)).toEqual(['active']);
  });

  it("type이 episodic이 아닌 memory는 후보에서 제외한다", () => {
    insertMemory({ id: 'semantic', createdAt: '2026-01-01T00:00:00.000Z', type: 'semantic' });
    insertMemory({ id: 'episodic', createdAt: '2026-01-02T00:00:00.000Z' });

    const result = selectTripleExtractionCandidates(db, DEFAULT_POLICY, new Date());
    expect(result.map((m) => m.id)).toEqual(['episodic']);
  });

  it('처리할 후보가 없으면 빈 배열을 반환한다', () => {
    expect(selectTripleExtractionCandidates(db, DEFAULT_POLICY, new Date())).toEqual([]);
  });
});

describe('canonical metadata key sets (success/failed/abandoned)', () => {
  it('success metadata는 정확히 {triple_count, extracted_at} 키만 가진다', () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    const metadata = buildTripleExtractionSuccessMetadata(now, 3);
    expect(Object.keys(metadata).sort()).toEqual(['extracted_at', 'triple_count']);
    expect(metadata.triple_count).toBe(3);
    expect(metadata.extracted_at).toBe(now.toISOString());
  });

  it('failed metadata는 정확히 {failureReason, retry_count, last_attempt, next_retry_after_days} 키만 가진다', () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    const metadata = buildTripleExtractionFailedMetadata(now, 'no_triple', 2, 2);
    expect(Object.keys(metadata).sort()).toEqual(
      ['failureReason', 'last_attempt', 'next_retry_after_days', 'retry_count'].sort()
    );
    expect(metadata.failureReason).toBe('no_triple');
    expect(metadata.retry_count).toBe(2);
    expect(metadata.last_attempt).toBe(now.toISOString());
    expect(metadata.next_retry_after_days).toBe(2);
  });

  it('abandoned metadata는 next-retry 키 없이 정확히 {failureReason, retry_count, last_attempt, abandoned_at} 키만 가진다', () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    const metadata = buildTripleExtractionAbandonedMetadata(now, 'no_triple', 3);
    expect(Object.keys(metadata).sort()).toEqual(
      ['abandoned_at', 'failureReason', 'last_attempt', 'retry_count'].sort()
    );
    expect(metadata).not.toHaveProperty('next_retry_after_days');
    // 단일 transition timestamp가 재사용된다 (last_attempt === abandoned_at)
    expect(metadata.last_attempt).toBe(metadata.abandoned_at);
    expect(metadata.last_attempt).toBe(now.toISOString());
  });
});

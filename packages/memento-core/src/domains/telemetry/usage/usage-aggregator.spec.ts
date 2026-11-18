import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usageDailyCountDdl } from '../../../infrastructure/database/sqlite/migration/migrations/069-usage-daily-count.js';
import { UsageAggregator, type UsageCountKey } from './usage-aggregator.js';

const key = (over: Partial<UsageCountKey> = {}): UsageCountKey => ({
  clientName: 'claude-code',
  clientVersion: '2.1.327',
  connectionMethod: 'http-streamable',
  era: 'modern',
  requestKind: 'tools/call',
  tool: 'recall',
  outcome: 'success',
  errorCode: 0,
  ...over,
});

interface Row {
  day: string;
  client_name: string;
  client_version: string;
  tool: string;
  outcome: string;
  error_code: number;
  count: number;
}

describe('UsageAggregator (#1768)', () => {
  let db: Database.Database;
  let today: Date;
  const now = () => today;

  const rows = () =>
    db
      .prepare('SELECT day, client_name, client_version, tool, outcome, error_code, count FROM usage_daily_count ORDER BY client_name, client_version, tool, error_code')
      .all() as Row[];
  const total = () => (db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM usage_daily_count').get() as { n: number }).n;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(usageDailyCountDdl());
    today = new Date('2026-11-18T10:00:00.000Z');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it('호출 경로에서는 DB 에 쓰지 않고, flush 때 같은 열쇠를 합쳐 한 번에 쓴다', () => {
    const agg = new UsageAggregator(db, { flushIntervalMs: 0, now });
    agg.count(key());
    agg.count(key());
    agg.count(key({ tool: 'remember' }));

    expect(total()).toBe(0);
    expect(agg.pendingKeyCount()).toBe(2);

    agg.flush();
    expect(rows().map((r) => [r.tool, r.count])).toEqual([['recall', 2], ['remember', 1]]);
    expect(agg.pendingKeyCount()).toBe(0);
  });

  it('flush 를 여러 번 해도 합산이 이어진다 (count + excluded.count)', () => {
    const agg = new UsageAggregator(db, { flushIntervalMs: 0, now });
    agg.count(key());
    agg.flush();
    agg.count(key());
    agg.count(key());
    agg.flush();
    expect(rows()[0]?.count).toBe(3);
  });

  it('프로세스 둘이 따로 모아 같은 DB 에 flush 해도 합쳐진다', () => {
    const a = new UsageAggregator(db, { flushIntervalMs: 0, now });
    const b = new UsageAggregator(db, { flushIntervalMs: 0, now });
    a.count(key());
    a.count(key());
    b.count(key());
    a.flush();
    b.flush();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.count).toBe(3);
  });

  it('날짜가 바뀌면 새 날짜 행으로 센다', () => {
    const agg = new UsageAggregator(db, { flushIntervalMs: 0, now });
    agg.count(key());
    today = new Date('2026-11-19T00:00:01.000Z');
    agg.count(key());
    agg.flush();
    expect(rows().map((r) => r.day)).toEqual(['2026-11-18', '2026-11-19']);
  });

  it('stop 이 남은 것을 마지막으로 쓴다', () => {
    const agg = new UsageAggregator(db, { flushIntervalMs: 60_000, now });
    agg.start();
    agg.count(key());
    expect(total()).toBe(0);
    agg.stop();
    expect(total()).toBe(1);
  });

  it('주기 타이머가 flush 한다', () => {
    vi.useFakeTimers();
    try {
      const agg = new UsageAggregator(db, { flushIntervalMs: 30_000, now });
      agg.start();
      agg.count(key());
      expect(total()).toBe(0);
      vi.advanceTimersByTime(30_000);
      expect(total()).toBe(1);
      agg.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('표가 없어 flush 가 실패하면 던지지 않고 그 묶음을 버린다 (다시 해도 같은 결과라 쌓아 두지 않는다)', () => {
    const agg = new UsageAggregator(db, { flushIntervalMs: 0, now });
    db.exec('DROP TABLE usage_daily_count');
    agg.count(key());
    expect(() => agg.flush()).not.toThrow();
    expect(agg.pendingKeyCount()).toBe(0);

    db.exec(usageDailyCountDdl());
    agg.count(key());
    agg.flush();
    expect(rows()[0]?.count).toBe(1);
  });

  it('다른 프로세스가 쓰기 잠금을 쥐어 SQLITE_BUSY 가 나면 다음 flush 에 다시 시도한다', () => {
    const agg = new UsageAggregator(db, { flushIntervalMs: 0, now });
    agg.count(key());
    const realTransaction = db.transaction.bind(db);
    const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
      throw busy;
    });

    expect(() => agg.flush()).not.toThrow();
    expect(agg.pendingKeyCount()).toBe(1);

    vi.spyOn(db, 'transaction').mockImplementation(realTransaction);
    agg.count(key());
    agg.flush();
    expect(rows()[0]?.count).toBe(2);
  });

  it('count 는 DB 가 잠겨 있어도 호출 쪽을 막지 않는다 (Map 만 만진다)', () => {
    const prepare = vi.spyOn(db, 'prepare');
    const agg = new UsageAggregator(db, { flushIntervalMs: 0, now });
    for (let i = 0; i < 1000; i += 1) agg.count(key());
    expect(prepare).not.toHaveBeenCalled();
  });

  describe('하루 열쇠 상한 (결정 5)', () => {
    it('상한 안에서는 그대로 센다', () => {
      const agg = new UsageAggregator(db, { flushIntervalMs: 0, maxKeysPerDay: 3, now });
      agg.count(key({ clientVersion: '1.0.0' }));
      agg.count(key({ clientVersion: '1.0.1' }));
      agg.count(key({ clientVersion: '1.0.2' }));
      agg.flush();
      expect(rows().map((r) => r.client_version)).toEqual(['1.0.0', '1.0.1', '1.0.2']);
    });

    it('상한에 닿은 뒤 새 버전은 버전을 비워 합치고, 이미 있는 열쇠는 그대로 센다', () => {
      const agg = new UsageAggregator(db, { flushIntervalMs: 0, maxKeysPerDay: 2, now });
      agg.count(key({ clientVersion: '1.0.0' }));
      agg.count(key({ clientVersion: '1.0.1' }));
      agg.count(key({ clientVersion: '1.0.2' }));
      agg.count(key({ clientVersion: '1.0.3' }));
      agg.count(key({ clientVersion: '1.0.0' }));
      agg.flush();

      const byVersion = Object.fromEntries(rows().map((r) => [r.client_version, r.count]));
      expect(byVersion).toEqual({ '1.0.0': 2, '1.0.1': 1, '': 2 });
      expect(total()).toBe(5);
    });

    it('버전을 비워도 새 열쇠면 클라이언트 이름을 other 로 합친다', () => {
      const agg = new UsageAggregator(db, { flushIntervalMs: 0, maxKeysPerDay: 1, now });
      agg.count(key());
      agg.count(key({ clientName: 'cursor', clientVersion: '1.0.0', tool: 'remember' }));
      agg.flush();
      const merged = rows().find((r) => r.client_name === 'other');
      expect(merged).toMatchObject({ client_version: '', tool: 'remember', count: 1 });
      expect(total()).toBe(2);
    });

    it('한도 도달 경고는 하루에 한 번만 남긴다', async () => {
      const { logger } = await import('../../../shared/utils/logger.js');
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const agg = new UsageAggregator(db, { flushIntervalMs: 0, maxKeysPerDay: 1, now });
      agg.count(key());
      for (let i = 0; i < 5; i += 1) agg.count(key({ clientVersion: `9.9.${i}` }));
      const limitWarns = warn.mock.calls.filter((c) => String(c[0]).includes('daily key limit'));
      expect(limitWarns).toHaveLength(1);
    });

    it('날짜가 바뀌면 상한 집합이 새로 시작한다', () => {
      const agg = new UsageAggregator(db, { flushIntervalMs: 0, maxKeysPerDay: 1, now });
      agg.count(key({ clientVersion: '1.0.0' }));
      today = new Date('2026-11-19T00:00:01.000Z');
      agg.count(key({ clientVersion: '1.0.1' }));
      agg.flush();
      expect(rows().map((r) => [r.day, r.client_version])).toEqual([
        ['2026-11-18', '1.0.0'],
        ['2026-11-19', '1.0.1'],
      ]);
    });
  });

  it('잠금이 계속되어 Map 이 상한의 두 배를 넘으면 오래된 쪽부터 버린다', () => {
    const agg = new UsageAggregator(db, { flushIntervalMs: 0, maxKeysPerDay: 5, now });
    vi.spyOn(db, 'transaction').mockImplementation(() => {
      throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    });
    for (let i = 0; i < 20; i += 1) agg.count(key({ tool: i % 2 ? 'recall' : 'remember', clientVersion: `1.0.${i}` }));
    agg.flush();
    expect(agg.pendingKeyCount()).toBeLessThanOrEqual(10);
  });
});

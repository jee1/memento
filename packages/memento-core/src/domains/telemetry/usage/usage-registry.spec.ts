import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usageDailyCountDdl } from '../../../infrastructure/database/sqlite/migration/migrations/069-usage-daily-count.js';
import { flushUsageAggregator, getUsageAggregator } from './usage-registry.js';

describe('usage-registry (#1768)', () => {
  afterEach(() => vi.useRealTimers());

  it('같은 핸들에는 같은 집계기를 돌려주고 flushUsageAggregator 가 남은 것을 쓰며 집계기를 지운다', () => {
    const db = new Database(':memory:');
    db.exec(usageDailyCountDdl());
    const a = getUsageAggregator(db, { flushIntervalMs: 0 });
    expect(getUsageAggregator(db)).toBe(a);
    a.count({
      clientName: 'cursor', clientVersion: '1.0.0', connectionMethod: 'stdio', era: 'legacy',
      requestKind: 'tools/call', tool: 'recall', outcome: 'success', errorCode: 0,
    });
    flushUsageAggregator(db);
    expect(db.prepare('SELECT SUM(count) AS n FROM usage_daily_count').get()).toEqual({ n: 1 });
    expect(getUsageAggregator(db, { flushIntervalMs: 0 })).not.toBe(a);
    db.close();
  });

  it('닫힌 핸들과 null 에는 집계기를 만들지 않는다 (타이머가 새지 않는다)', () => {
    vi.useFakeTimers();
    const db = new Database(':memory:');
    db.close();
    expect(() => getUsageAggregator(db)).toThrow(/not open/);
    expect(() => getUsageAggregator(null as never)).toThrow(/not open/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('집계기가 없는 핸들의 flush 는 아무것도 하지 않는다', () => {
    const db = new Database(':memory:');
    expect(() => flushUsageAggregator(db)).not.toThrow();
    db.close();
  });
});

/**
 * DB 핸들마다 집계기 하나를 지연 생성해 둔다 (#1768).
 *
 * 도구 호출은 접속 방식(stdio, HTTP, WebSocket, REST)과 무관하게 모두 같은 DB 핸들을 지나므로,
 * 핸들을 열쇠로 두면 진입점마다 집계기를 배선하지 않아도 된다. `closeDatabase` 가 닫기 직전에 `flushUsageAggregator` 로
 * 남은 것을 쓴다.
 */

import type Database from 'better-sqlite3';
import { UsageAggregator, type UsageAggregatorOptions } from './usage-aggregator.js';

const aggregators = new WeakMap<Database.Database, UsageAggregator>();

/** 이 DB 의 집계기. 처음 부르면 만들고 주기 flush 를 시작한다. */
export function getUsageAggregator(db: Database.Database, options?: UsageAggregatorOptions): UsageAggregator {
  // 닫힌 핸들(종료 중 진행 중이던 호출)이나 null 에는 집계기와 타이머를 만들지 않는다. 호출한 쪽이 던짐을 삼킨다.
  if (!db?.open) throw new Error('usage aggregator: database is not open');
  let aggregator = aggregators.get(db);
  if (!aggregator) {
    aggregator = new UsageAggregator(db, options);
    aggregator.start();
    aggregators.set(db, aggregator);
  }
  return aggregator;
}

/** DB 를 닫기 전에 남은 집계를 쓰고 타이머를 멈춘다. 집계기가 없으면 아무것도 하지 않는다. */
export function flushUsageAggregator(db: Database.Database): void {
  const aggregator = aggregators.get(db);
  if (!aggregator) return;
  aggregator.stop();
  aggregators.delete(db);
}

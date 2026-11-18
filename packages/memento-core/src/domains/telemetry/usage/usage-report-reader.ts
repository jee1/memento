/**
 * 보고서에 넣을 값을 DB 에서 읽는다 (#1769). 읽기만 하고, 호출하는 쪽이 읽기 전용으로 연 연결을 넘긴다.
 * 표가 없거나(옛 스키마) 질의가 실패하면 빈 값을 돌려준다. 보고서 때문에 진단이 멈추면 안 된다.
 */

import type Database from 'better-sqlite3';
import { REPORT_WINDOW_DAYS, type UsageRowInput } from './usage-report.js';

/** `now` 가 속한 UTC 날짜에서 (창 길이 - 1)일 전 날짜. 오늘을 포함해 창 길이만큼의 날을 읽는다. */
export function reportSinceDay(now: Date): string {
  const since = new Date(now.getTime() - (REPORT_WINDOW_DAYS - 1) * 86_400_000);
  return since.toISOString().slice(0, 10);
}

export function readUsageRows(db: Database.Database, now: Date): UsageRowInput[] {
  try {
    return db
      .prepare(
        `SELECT client_name, client_version, tool, outcome, error_code, SUM(count) AS count
         FROM usage_daily_count
         WHERE day >= ?
         GROUP BY client_name, client_version, tool, outcome, error_code`,
      )
      .all(reportSinceDay(now)) as UsageRowInput[];
  } catch {
    return [];
  }
}

/** 기억 수. 세지 못하면 null. */
export function countMemories(db: Database.Database): number | null {
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM memory_item').get() as { n?: unknown } | undefined;
    return typeof row?.n === 'number' ? row.n : null;
  } catch {
    return null;
  }
}

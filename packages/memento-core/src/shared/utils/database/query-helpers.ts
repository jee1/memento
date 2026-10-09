import type Database from 'better-sqlite3';

import { getSqliteErrorCode, log } from './database-error-helpers.js';

/** SQLITE_BUSY 면 지수 백오프(최대 1초, busy wait)로 maxRetries 번까지 다시 실행한다. */
function withBusyRetry<T>(maxRetries: number, run: () => T): T {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return run();
    } catch (error) {
      lastError = error as Error;

      if (getSqliteErrorCode(error) === 'SQLITE_BUSY' && attempt < maxRetries) {
        const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
        log(`⚠️  데이터베이스 잠금 감지, ${delay}ms 후 재시도 (${attempt}/${maxRetries})`);
        const start = Date.now();
        while (Date.now() - start < delay) {
          // busy wait
        }
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

export function runQuery(
  db: Database.Database,
  sql: string,
  params: readonly unknown[] = [],
  maxRetries: number = 3
): Database.RunResult {
  return withBusyRetry(maxRetries, () => db.prepare(sql).run(...params));
}

export function getQuery(
  db: Database.Database,
  sql: string,
  params: readonly unknown[] = [],
  maxRetries: number = 3
): unknown {
  return withBusyRetry(maxRetries, () => db.prepare(sql).get(...params));
}

export function allQuery(
  db: Database.Database,
  sql: string,
  params: readonly unknown[] = [],
  maxRetries: number = 3
): unknown[] {
  return withBusyRetry(maxRetries, () => db.prepare(sql).all(...params));
}

export function execQuery(db: Database.Database, sql: string): void {
  db.exec(sql);
}

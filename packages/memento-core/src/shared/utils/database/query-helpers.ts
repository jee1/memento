import type Database from 'better-sqlite3';

import { getSqliteErrorCode, log } from './database-error-helpers.js';

export function runQuery(
  db: Database.Database,
  sql: string,
  params: readonly unknown[] = [],
  maxRetries: number = 3
): Database.RunResult {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return db.prepare(sql).run(...params);
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

export function getQuery(
  db: Database.Database,
  sql: string,
  params: readonly unknown[] = [],
  maxRetries: number = 3
): unknown {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return db.prepare(sql).get(...params);
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

export function allQuery(
  db: Database.Database,
  sql: string,
  params: readonly unknown[] = [],
  maxRetries: number = 3
): unknown[] {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return db.prepare(sql).all(...params);
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

export function execQuery(db: Database.Database, sql: string): void {
  db.exec(sql);
}

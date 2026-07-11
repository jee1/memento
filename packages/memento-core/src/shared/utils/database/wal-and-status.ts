import type Database from 'better-sqlite3';

import { getErrorMessage, getErrorName, getSqliteErrorCode, log } from './database-error-helpers.js';
import { getQuery, runQuery } from './query-helpers.js';
import { getTransactionState } from './transaction-helpers.js';

export function isDatabaseOpen(db: Database.Database | null | undefined): boolean {
  if (!db) {
    return false;
  }

  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch (error: unknown) {
    if (getErrorMessage(error)?.includes('not open') || getErrorName(error) === 'TypeError') {
      return false;
    }
    return true;
  }
}

export function checkpointWAL(db: Database.Database): void {
  try {
    runQuery(db, 'PRAGMA wal_checkpoint(FULL)');
    log('✅ WAL 체크포인트 완료');
  } catch (error) {
    log('❌ WAL 체크포인트 실패', { error });
    throw error;
  }
}

export function getDatabaseStatus(db: Database.Database): {
  journalMode: string;
  walAutoCheckpoint: number;
  busyTimeout: number;
  isLocked: boolean;
  inTransaction: boolean;
} {
  try {
    const journalMode = getQuery(db, 'PRAGMA journal_mode') as { journal_mode?: string } | undefined;
    const walAutoCheckpoint = getQuery(db, 'PRAGMA wal_autocheckpoint') as
      | { wal_autocheckpoint?: number }
      | undefined;
    const busyTimeout = getQuery(db, 'PRAGMA busy_timeout') as { busy_timeout?: number } | undefined;

    let isLocked = false;
    try {
      runQuery(db, 'BEGIN IMMEDIATE TRANSACTION');
      runQuery(db, 'ROLLBACK');
    } catch (error) {
      if (getSqliteErrorCode(error) === 'SQLITE_BUSY') {
        isLocked = true;
      }
    }

    return {
      journalMode: String(journalMode?.journal_mode ?? ''),
      walAutoCheckpoint: Number(walAutoCheckpoint?.wal_autocheckpoint ?? 0),
      busyTimeout: Number(busyTimeout?.busy_timeout ?? 0),
      isLocked,
      inTransaction: getTransactionState(db).inTransaction,
    };
  } catch (error) {
    log('❌ 데이터베이스 상태 확인 실패', { error });
    throw error;
  }
}

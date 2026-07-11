import type Database from 'better-sqlite3';

import { getErrorMessage, getSqliteErrorCode, log } from './database-error-helpers.js';
import { runQuery } from './query-helpers.js';

const transactionStates = new WeakMap<Database.Database, { inTransaction: boolean; transactionId?: string }>();

export function getTransactionState(db: Database.Database): { inTransaction: boolean; transactionId?: string } {
  if (!transactionStates.has(db)) {
    transactionStates.set(db, { inTransaction: false });
  }
  return transactionStates.get(db)!;
}

export function setTransactionState(
  db: Database.Database,
  inTransaction: boolean,
  transactionId?: string
): void {
  transactionStates.set(db, { inTransaction, transactionId });
}

export async function runTransaction<T>(
  db: Database.Database,
  transactionFn: () => T | Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  const transactionState = getTransactionState(db);

  if (transactionState.inTransaction) {
    log('⚠️ 트랜잭션 중첩 감지, 기존 트랜잭션 내에서 실행');
    return await transactionFn();
  }

  const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      try {
        runQuery(db, 'BEGIN IMMEDIATE TRANSACTION');
        setTransactionState(db, true, transactionId);
      } catch (beginError: unknown) {
        const code = getSqliteErrorCode(beginError);
        const message = getErrorMessage(beginError) ?? '';

        if (
          code === 'SQLITE_ERROR' &&
          (message.includes('transaction') || message.includes('cannot start'))
        ) {
          setTransactionState(db, true, transactionId);
          const result = await transactionFn();
          return result;
        }
        throw beginError;
      }

      const result = await transactionFn();

      const currentState = getTransactionState(db);
      if (currentState.transactionId === transactionId) {
        runQuery(db, 'COMMIT');
        setTransactionState(db, false);
      }

      return result;
    } catch (error) {
      lastError = error as Error;

      try {
        const currentState = getTransactionState(db);
        if (currentState.transactionId === transactionId && currentState.inTransaction) {
          runQuery(db, 'ROLLBACK');
        }
      } catch (rollbackError) {
        log('❌ 트랜잭션 롤백 실패', { error: rollbackError });
      } finally {
        setTransactionState(db, false);
      }

      if (getSqliteErrorCode(error) === 'SQLITE_BUSY' && attempt < maxRetries) {
        const delay = Math.min(200 * Math.pow(2, attempt - 1), 2000);
        log(`⚠️ 트랜잭션 잠금 감지, ${delay}ms 후 재시도 (${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

export function isInTransaction(db: Database.Database): boolean {
  return getTransactionState(db).inTransaction;
}

export function forceCleanupTransaction(db: Database.Database): void {
  try {
    setTransactionState(db, false);
    runQuery(db, 'ROLLBACK');
    log('✅ 트랜잭션 강제 정리 완료');
  } catch (error) {
    log('⚠️ 트랜잭션 강제 정리 중 오류', { error });
    setTransactionState(db, false);
  }
}

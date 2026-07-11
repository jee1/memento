/**
 * SQLite3 데이터베이스 유틸리티 함수들
 */

import Database from 'better-sqlite3';

import { initializeDatabase as initializeDatabaseSchema } from './database/schema-initialization.js';
import { allQuery, execQuery, getQuery, runQuery } from './database/query-helpers.js';
import {
  forceCleanupTransaction,
  isInTransaction,
  runTransaction,
} from './database/transaction-helpers.js';
import { checkpointWAL, getDatabaseStatus, isDatabaseOpen } from './database/wal-and-status.js';

export class DatabaseUtils {
  static isOpen(db: Database.Database | null | undefined): boolean {
    return isDatabaseOpen(db);
  }

  static run(
    db: Database.Database,
    sql: string,
    params: readonly unknown[] = [],
    maxRetries: number = 3
  ): Database.RunResult {
    return runQuery(db, sql, params, maxRetries);
  }

  static get(
    db: Database.Database,
    sql: string,
    params: readonly unknown[] = [],
    maxRetries: number = 3
  ): unknown {
    return getQuery(db, sql, params, maxRetries);
  }

  static all(
    db: Database.Database,
    sql: string,
    params: readonly unknown[] = [],
    maxRetries: number = 3
  ): unknown[] {
    return allQuery(db, sql, params, maxRetries);
  }

  static exec(db: Database.Database, sql: string): void {
    execQuery(db, sql);
  }

  static async runTransaction<T>(
    db: Database.Database,
    transactionFn: () => T | Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    return runTransaction(db, transactionFn, maxRetries);
  }

  static checkpointWAL(db: Database.Database): void {
    checkpointWAL(db);
  }

  static isInTransaction(db: Database.Database): boolean {
    return isInTransaction(db);
  }

  static forceCleanupTransaction(db: Database.Database): void {
    forceCleanupTransaction(db);
  }

  static getDatabaseStatus(db: Database.Database): {
    journalMode: string;
    walAutoCheckpoint: number;
    busyTimeout: number;
    isLocked: boolean;
    inTransaction: boolean;
  } {
    return getDatabaseStatus(db);
  }

  static async initializeDatabase(db: Database.Database): Promise<void> {
    return initializeDatabaseSchema(db);
  }
}

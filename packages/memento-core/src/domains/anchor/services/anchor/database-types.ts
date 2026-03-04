/**
 * 데이터베이스 경계 타입 정의
 * Phase 4.4: 타입 안정성 개선 - DB 경계 타입 정의
 */

import type Database from 'better-sqlite3';

/**
 * 앵커 정보 쿼리 결과
 */
export interface AnchorInfoRow {
  memory_id: string | null;
  agent_id?: string;
  slot?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * 데이터베이스 쿼리 결과 (단일 행)
 */
export type QueryResult<T> = T | undefined;

/**
 * 데이터베이스 쿼리 결과 (다중 행)
 */
export type QueryResults<T> = T[];

/**
 * 데이터베이스 트랜잭션 콜백
 */
export type TransactionCallback<T> = (db: Database.Database) => T;


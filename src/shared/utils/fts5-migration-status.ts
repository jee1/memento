/**
 * FTS5 Migration Status 유틸리티
 * 
 * FTS5 reflection_notes 마이그레이션 상태를 관리하는 유틸리티 함수를 제공합니다.
 * Fallback 전략을 위해 마이그레이션 상태를 추적하고 관리합니다.
 */

import type Database from 'better-sqlite3';
import { DatabaseUtils } from './database.js';
import { mementoConfig } from '../shared/config/index.js';

export type FTS5MigrationStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

const MIGRATION_KEY = 'fts5-reflection-notes';

/**
 * 마이그레이션 상태 테이블 초기화
 * 테이블이 없으면 생성하고, 초기 상태 'pending' 삽입
 */
export function initializeMigrationStatusTable(db: Database.Database): void {
  try {
    // 테이블 생성
    DatabaseUtils.run(db, `
      CREATE TABLE IF NOT EXISTS fts5_migration_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_key TEXT NOT NULL UNIQUE DEFAULT 'fts5-reflection-notes',
        status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')) DEFAULT 'pending',
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        failed_at TIMESTAMP,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 인덱스 생성
    DatabaseUtils.run(db, `
      CREATE INDEX IF NOT EXISTS idx_fts5_migration_status_key ON fts5_migration_status(migration_key)
    `);
    DatabaseUtils.run(db, `
      CREATE INDEX IF NOT EXISTS idx_fts5_migration_status_status ON fts5_migration_status(status)
    `);

    // 초기 상태 삽입 (없는 경우)
    DatabaseUtils.run(db, `
      INSERT OR IGNORE INTO fts5_migration_status (migration_key, status)
      VALUES (?, 'pending')
    `, [MIGRATION_KEY]);
  } catch (error) {
    throw new Error(
      `마이그레이션 상태 테이블 초기화 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 마이그레이션 상태 조회
 * 
 * @param db - 데이터베이스 인스턴스
 * @returns 마이그레이션 상태
 */
export function getMigrationStatus(db: Database.Database): FTS5MigrationStatus {
  try {
    // 먼저 테이블이 존재하는지 확인
    const tableExists = DatabaseUtils.get(db, `
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='fts5_migration_status'
    `) as { name: string } | undefined;

    if (!tableExists) {
      // 테이블이 없으면 초기화 후 'pending' 반환
      initializeMigrationStatusTable(db);
      return 'pending';
    }

    // 테이블이 있으면 상태 조회
    const result = DatabaseUtils.get(db, `
      SELECT status FROM fts5_migration_status
      WHERE migration_key = ?
    `, [MIGRATION_KEY]) as { status: string } | undefined;

    if (!result) {
      // 상태가 없으면 초기화 후 'pending' 반환
      initializeMigrationStatusTable(db);
      return 'pending';
    }

    return result.status as FTS5MigrationStatus;
  } catch (error) {
    // 조회 실패 시 테이블 초기화 시도
    try {
      initializeMigrationStatusTable(db);
      return 'pending';
    } catch (initError) {
      // 초기화도 실패하면 기본값 반환
      console.warn('마이그레이션 상태 조회 및 초기화 실패:', error, initError);
      return 'pending';
    }
  }
}

/**
 * 마이그레이션 상태 업데이트
 * 
 * @param db - 데이터베이스 인스턴스
 * @param status - 새로운 상태
 * @param errorMessage - 에러 메시지 (실패 시)
 * @throws Error - 상태 전이 검증 실패 시
 */
export function setMigrationStatus(
  db: Database.Database,
  status: FTS5MigrationStatus,
  errorMessage?: string
): void {
  try {
    // 현재 상태 조회
    const currentStatus = getMigrationStatus(db);

    // 상태 전이 검증
    if (!isValidStatusTransition(currentStatus, status)) {
      throw new Error(
        `유효하지 않은 상태 전이: ${currentStatus} → ${status}`
      );
    }

    // 상태 업데이트
    const now = new Date().toISOString();
    let updateSql = '';
    let params: any[] = [];

    if (status === 'in_progress') {
      updateSql = `
        UPDATE fts5_migration_status
        SET status = ?, started_at = ?, updated_at = ?
        WHERE migration_key = ?
      `;
      params = [status, now, now, MIGRATION_KEY];
    } else if (status === 'completed') {
      updateSql = `
        UPDATE fts5_migration_status
        SET status = ?, completed_at = ?, updated_at = ?
        WHERE migration_key = ?
      `;
      params = [status, now, now, MIGRATION_KEY];
    } else if (status === 'failed') {
      updateSql = `
        UPDATE fts5_migration_status
        SET status = ?, failed_at = ?, error_message = ?, retry_count = retry_count + 1, updated_at = ?
        WHERE migration_key = ?
      `;
      params = [status, now, errorMessage || null, now, MIGRATION_KEY];
    } else if (status === 'pending') {
      // 재시도 시 pending으로 되돌림
      updateSql = `
        UPDATE fts5_migration_status
        SET status = ?, started_at = NULL, completed_at = NULL, failed_at = NULL, error_message = NULL, updated_at = ?
        WHERE migration_key = ?
      `;
      params = [status, now, MIGRATION_KEY];
    }

    if (updateSql) {
      DatabaseUtils.run(db, updateSql, params);
    }

    // Config 캐시 업데이트
    (mementoConfig as any).fts5MigrationStatus = status;
  } catch (error) {
    throw new Error(
      `마이그레이션 상태 업데이트 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 상태 전이 검증
 * 
 * 유효한 상태 전이:
 * - pending → in_progress
 * - in_progress → completed
 * - in_progress → failed
 * - failed → pending (재시도)
 * - completed → (변경 불가)
 * 
 * @param currentStatus - 현재 상태
 * @param newStatus - 새로운 상태
 * @returns 유효한 전이인지 여부
 */
function isValidStatusTransition(
  currentStatus: FTS5MigrationStatus,
  newStatus: FTS5MigrationStatus
): boolean {
  // 동일한 상태로 변경은 허용 (에러 메시지 업데이트 등)
  if (currentStatus === newStatus) {
    return true;
  }

  // 상태 전이 규칙
  const validTransitions: Record<FTS5MigrationStatus, FTS5MigrationStatus[]> = {
    pending: ['in_progress'],
    in_progress: ['completed', 'failed'],
    completed: [], // completed는 변경 불가
    failed: ['pending'] // 재시도를 위해 pending으로 되돌릴 수 있음
  };

  return validTransitions[currentStatus].includes(newStatus);
}

/**
 * 마이그레이션 상태를 config에 로드 및 캐시
 * 
 * @param db - 데이터베이스 인스턴스
 */
export function loadMigrationStatusToConfig(db: Database.Database): void {
  try {
    const status = getMigrationStatus(db);
    (mementoConfig as any).fts5MigrationStatus = status;
  } catch (error) {
    // 로드 실패 시 기본값 설정
    console.warn('마이그레이션 상태 로드 실패, 기본값 사용:', error);
    (mementoConfig as any).fts5MigrationStatus = 'pending';
  }
}

/**
 * 마이그레이션 상태가 완료되었는지 확인
 * 
 * @param db - 데이터베이스 인스턴스 (선택적, 없으면 config 캐시 사용)
 * @returns 완료 여부
 */
export function isMigrationCompleted(db?: Database.Database): boolean {
  if (db) {
    const status = getMigrationStatus(db);
    return status === 'completed';
  }
  return mementoConfig.fts5MigrationStatus === 'completed';
}

/**
 * 마이그레이션 상태가 실패했는지 확인
 * 
 * @param db - 데이터베이스 인스턴스 (선택적, 없으면 config 캐시 사용)
 * @returns 실패 여부
 */
export function isMigrationFailed(db?: Database.Database): boolean {
  if (db) {
    const status = getMigrationStatus(db);
    return status === 'failed';
  }
  return mementoConfig.fts5MigrationStatus === 'failed';
}

/**
 * Fallback이 필요한지 확인 (마이그레이션 실패 또는 대기 중)
 * 
 * @param db - 데이터베이스 인스턴스 (선택적, 없으면 config 캐시 사용)
 * @returns Fallback 필요 여부
 */
export function shouldUseFallback(db?: Database.Database): boolean {
  // 환경 변수로 강제 Fallback 활성화 확인
  if (process.env.MEMENTO_FTS5_FALLBACK_ENABLED === 'true') {
    return true;
  }

  if (db) {
    const status = getMigrationStatus(db);
    return status === 'failed' || status === 'pending';
  }
  const status = mementoConfig.fts5MigrationStatus;
  return status === 'failed' || status === 'pending';
}

/**
 * 마이그레이션 재시도 준비
 * 실패한 마이그레이션을 재시도하기 위해 상태를 'pending'으로 되돌립니다.
 * 
 * @param db - 데이터베이스 인스턴스
 */
export function prepareMigrationRetry(db: Database.Database): void {
  const currentStatus = getMigrationStatus(db);
  
  if (currentStatus !== 'failed') {
    throw new Error(`마이그레이션 재시도는 'failed' 상태에서만 가능합니다. 현재 상태: ${currentStatus}`);
  }

  setMigrationStatus(db, 'pending');
}

/**
 * 마이그레이션 상태를 강제로 업데이트 (관리자용)
 * 
 * @param db - 데이터베이스 인스턴스
 * @param status - 새로운 상태
 * @param errorMessage - 에러 메시지 (선택적)
 */
export function forceSetMigrationStatus(
  db: Database.Database,
  status: FTS5MigrationStatus,
  errorMessage?: string
): void {
  // 상태 전이 검증 없이 강제 업데이트
  const now = new Date().toISOString();
  let updateSql = '';
  let params: any[] = [];

  if (status === 'in_progress') {
    updateSql = `
      UPDATE fts5_migration_status
      SET status = ?, started_at = ?, updated_at = ?
      WHERE migration_key = ?
    `;
    params = [status, now, now, MIGRATION_KEY];
  } else if (status === 'completed') {
    updateSql = `
      UPDATE fts5_migration_status
      SET status = ?, completed_at = ?, updated_at = ?
      WHERE migration_key = ?
    `;
    params = [status, now, now, MIGRATION_KEY];
  } else if (status === 'failed') {
    updateSql = `
      UPDATE fts5_migration_status
      SET status = ?, failed_at = ?, error_message = ?, retry_count = retry_count + 1, updated_at = ?
      WHERE migration_key = ?
    `;
    params = [status, now, errorMessage || null, now, MIGRATION_KEY];
  } else if (status === 'pending') {
    updateSql = `
      UPDATE fts5_migration_status
      SET status = ?, started_at = NULL, completed_at = NULL, failed_at = NULL, error_message = NULL, updated_at = ?
      WHERE migration_key = ?
    `;
    params = [status, now, MIGRATION_KEY];
  }

  if (updateSql) {
    DatabaseUtils.run(db, updateSql, params);
    (mementoConfig as any).fts5MigrationStatus = status;
  }
}


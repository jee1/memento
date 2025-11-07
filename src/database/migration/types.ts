/**
 * 마이그레이션 타입 정의
 */

import type Database from 'better-sqlite3';

/**
 * 마이그레이션 인터페이스
 */
export interface Migration {
  /**
   * 마이그레이션 버전 (예: "002")
   */
  version: string;

  /**
   * 마이그레이션 이름 (예: "mirix-schema-expansion")
   */
  name: string;

  /**
   * 마이그레이션 설명
   */
  description: string;

  /**
   * 마이그레이션 실행 (Up)
   * @param db 데이터베이스 인스턴스
   */
  up(db: Database.Database): Promise<void>;

  /**
   * 마이그레이션 롤백 (Down)
   * @param db 데이터베이스 인스턴스
   */
  down(db: Database.Database): Promise<void>;

  /**
   * 마이그레이션 전 검증
   * @param db 데이터베이스 인스턴스
   * @throws {Error} 검증 실패 시
   */
  validateBefore(db: Database.Database): Promise<void>;

  /**
   * 마이그레이션 후 검증
   * @param db 데이터베이스 인스턴스
   * @throws {Error} 검증 실패 시
   */
  validateAfter(db: Database.Database): Promise<void>;
}

/**
 * 마이그레이션 실행 결과
 */
export interface MigrationResult {
  /**
   * 마이그레이션 버전
   */
  version: string;

  /**
   * 마이그레이션 이름
   */
  name: string;

  /**
   * 성공 여부
   */
  success: boolean;

  /**
   * 실행 시작 시간
   */
  startTime: Date;

  /**
   * 실행 종료 시간
   */
  endTime?: Date;

  /**
   * 에러 메시지 (실패 시)
   */
  error?: string;

  /**
   * 롤백 성공 여부 (실패 후 롤백 시도 시)
   */
  rollbackSuccess?: boolean;
}

/**
 * 마이그레이션 실행 옵션
 */
export interface MigrationOptions {
  /**
   * 백업 생성 여부 (기본: true)
   */
  createBackup?: boolean;

  /**
   * 롤백 자동 시도 여부 (기본: true)
   */
  autoRollback?: boolean;

  /**
   * 검증 수행 여부 (기본: true)
   */
  validate?: boolean;

  /**
   * 로그 파일 경로 (기본: data/logs/migration_{timestamp}.log)
   */
  logFile?: string;
}

/**
 * 스키마 버전 정보
 */
export interface SchemaVersion {
  /**
   * 스키마 버전
   */
  version: string;

  /**
   * 적용 시간
   */
  appliedAt: Date;

  /**
   * 마이그레이션 이름
   */
  migrationName: string;

  /**
   * 마이그레이션 체크섬
   */
  checksum?: string;

  /**
   * 적용한 사용자/시스템
   */
  appliedBy: string;

  /**
   * 마이그레이션 설명 (선택적)
   */
  description?: string;
}


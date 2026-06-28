/**
 * Core Memory 전용 데이터베이스 인터페이스
 * 비동기 Promise 기반 인터페이스로 정의
 * 기존 DatabaseConnection 인터페이스와 분리하여 CoreMemory 전용으로 사용
 */

/**
 * Core Memory 전용 PreparedStatement 인터페이스 (비동기)
 */
export interface CoreMemoryPreparedStatement {
  /**
   * 모든 결과 행을 반환
   */
  all(...params: unknown[]): Promise<unknown[]>;

  /**
   * 첫 번째 결과 행을 반환
   */
  get(...params: unknown[]): Promise<unknown>;

  /**
   * 쿼리를 실행하고 변경된 행 수와 마지막 삽입된 행 ID를 반환
   */
  run(...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>;
}

/**
 * Core Memory 전용 DatabaseConnection 인터페이스 (비동기)
 */
export interface CoreMemoryDatabaseConnection {
  /**
   * SQL 문을 준비하여 PreparedStatement를 반환
   */
  prepare(sql: string): Promise<CoreMemoryPreparedStatement>;

  /**
   * SQL 문을 실행 (결과 반환 없음)
   */
  exec(sql: string): Promise<void>;

  /**
   * 데이터베이스 연결을 닫음
   */
  close(): Promise<void>;

  /**
   * 데이터베이스 연결이 열려있는지 확인
   */
  isOpen(): Promise<boolean>;
}


/**
 * SQLite Core Memory Adapter
 * better-sqlite3의 동기 API를 비동기 인터페이스로 래핑
 */

import Database from 'better-sqlite3';
import type {
  CoreMemoryDatabaseConnection,
  CoreMemoryPreparedStatement
} from '../../../domains/memory/repositories/core-memory-database.interface.js';

/**
 * SQLite PreparedStatement 래퍼 클래스 (비동기)
 */
class SqliteCoreMemoryPreparedStatement implements CoreMemoryPreparedStatement {
  private stmt: Database.Statement;

  constructor(stmt: Database.Statement) {
    this.stmt = stmt;
  }

  /**
   * 모든 결과 행을 반환
   */
  async all(...params: unknown[]): Promise<unknown[]> {
    try {
      return Promise.resolve(this.stmt.all(...params));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * 첫 번째 결과 행을 반환
   */
  async get(...params: unknown[]): Promise<unknown> {
    try {
      return Promise.resolve(this.stmt.get(...params));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * 쿼리를 실행하고 변경된 행 수와 마지막 삽입된 행 ID를 반환
   */
  async run(...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number }> {
    try {
      const result = this.stmt.run(...params);
      return Promise.resolve({
        changes: result.changes,
        lastInsertRowid: Number(result.lastInsertRowid)
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

/**
 * SQLite Core Memory Adapter
 * better-sqlite3 Database를 CoreMemoryDatabaseConnection 인터페이스로 래핑
 */
export class SqliteCoreMemoryAdapter implements CoreMemoryDatabaseConnection {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * SQL 문을 준비하여 PreparedStatement를 반환
   */
  async prepare(sql: string): Promise<CoreMemoryPreparedStatement> {
    try {
      const stmt = this.db.prepare(sql);
      return Promise.resolve(new SqliteCoreMemoryPreparedStatement(stmt));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * SQL 문을 실행 (결과 반환 없음)
   */
  async exec(sql: string): Promise<void> {
    try {
      this.db.exec(sql);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * 데이터베이스 연결을 닫음
   */
  async close(): Promise<void> {
    try {
      this.db.close();
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * 데이터베이스 연결이 열려있는지 확인
   */
  async isOpen(): Promise<boolean> {
    try {
      // better-sqlite3는 닫힌 데이터베이스에 접근하면 에러가 발생하므로
      // 간단한 쿼리를 실행하여 확인
      this.db.prepare('SELECT 1').get();
      return Promise.resolve(true);
    } catch (error) {
      return Promise.resolve(false);
    }
  }
}


/**
 * SQLite3 데이터베이스 유틸리티 함수들
 */

import sqlite3 from 'sqlite3';

export class DatabaseUtils {
  /**
   * SQLite3 쿼리를 Promise로 래핑
   */
  static run(db: sqlite3.Database, sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this);
        }
      });
    });
  }

  /**
   * SQLite3 쿼리 결과를 Promise로 래핑
   */
  static get(db: sqlite3.Database, sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * SQLite3 쿼리 결과 배열을 Promise로 래핑
   */
  static all(db: sqlite3.Database, sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * SQLite3 exec를 Promise로 래핑
   */
  static exec(db: sqlite3.Database, sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

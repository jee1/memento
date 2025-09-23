/**
 * SQLite3 데이터베이스 유틸리티 함수들
 */

import sqlite3 from 'sqlite3';

export class DatabaseUtils {
  /**
   * SQLite3 쿼리를 Promise로 래핑 (재시도 로직 포함)
   */
  static async run(db: sqlite3.Database, sql: string, params: any[] = [], maxRetries: number = 3): Promise<sqlite3.RunResult> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await new Promise<sqlite3.RunResult>((resolve, reject) => {
          db.run(sql, params, function(err) {
            if (err) {
              reject(err);
            } else {
              resolve(this);
            }
          });
        });
      } catch (error) {
        lastError = error as Error;
        
        // SQLITE_BUSY 오류인 경우 재시도
        if ((error as any).code === 'SQLITE_BUSY' && attempt < maxRetries) {
          const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000); // 지수 백오프
          console.error(`⚠️  데이터베이스 잠금 감지, ${delay}ms 후 재시도 (${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // 다른 오류이거나 최대 재시도 횟수에 도달한 경우
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * SQLite3 쿼리 결과를 Promise로 래핑 (재시도 로직 포함)
   */
  static async get(db: sqlite3.Database, sql: string, params: any[] = [], maxRetries: number = 3): Promise<any> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await new Promise<any>((resolve, reject) => {
          db.get(sql, params, (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row);
            }
          });
        });
      } catch (error) {
        lastError = error as Error;
        
        // SQLITE_BUSY 오류인 경우 재시도
        if ((error as any).code === 'SQLITE_BUSY' && attempt < maxRetries) {
          const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
          console.error(`⚠️  데이터베이스 잠금 감지, ${delay}ms 후 재시도 (${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * SQLite3 쿼리 결과 배열을 Promise로 래핑 (재시도 로직 포함)
   */
  static async all(db: sqlite3.Database, sql: string, params: any[] = [], maxRetries: number = 3): Promise<any[]> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await new Promise<any[]>((resolve, reject) => {
          db.all(sql, params, (err, rows) => {
            if (err) {
              reject(err);
            } else {
              resolve(rows);
            }
          });
        });
      } catch (error) {
        lastError = error as Error;
        
        // SQLITE_BUSY 오류인 경우 재시도
        if ((error as any).code === 'SQLITE_BUSY' && attempt < maxRetries) {
          const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
          console.error(`⚠️  데이터베이스 잠금 감지, ${delay}ms 후 재시도 (${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError;
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

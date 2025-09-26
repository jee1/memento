/**
 * SQLite3 데이터베이스 유틸리티 함수들
 */

import Database from 'better-sqlite3';

// MCP 서버에서는 모든 로그 출력을 완전히 차단
const log = (...args: any[]) => {};

export class DatabaseUtils {
  /**
   * SQLite3 쿼리를 실행 (재시도 로직 포함)
   */
  static run(db: Database.Database, sql: string, params: any[] = [], maxRetries: number = 3): Database.RunResult {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return db.prepare(sql).run(params);
      } catch (error) {
        lastError = error as Error;
        
        // SQLITE_BUSY 오류인 경우 재시도
        if ((error as any).code === 'SQLITE_BUSY' && attempt < maxRetries) {
          const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000); // 지수 백오프
          log(`⚠️  데이터베이스 잠금 감지, ${delay}ms 후 재시도 (${attempt}/${maxRetries})`);
          // 동기적으로 대기
          const start = Date.now();
          while (Date.now() - start < delay) {
            // busy wait
          }
          continue;
        }
        
        // 다른 오류이거나 최대 재시도 횟수에 도달한 경우
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * SQLite3 쿼리 결과를 가져오기 (재시도 로직 포함)
   */
  static get(db: Database.Database, sql: string, params: any[] = [], maxRetries: number = 3): any {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return db.prepare(sql).get(params);
      } catch (error) {
        lastError = error as Error;
        
        // SQLITE_BUSY 오류인 경우 재시도
        if ((error as any).code === 'SQLITE_BUSY' && attempt < maxRetries) {
          const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
          log(`⚠️  데이터베이스 잠금 감지, ${delay}ms 후 재시도 (${attempt}/${maxRetries})`);
          // 동기적으로 대기
          const start = Date.now();
          while (Date.now() - start < delay) {
            // busy wait
          }
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * SQLite3 쿼리 결과 배열을 가져오기 (재시도 로직 포함)
   */
  static all(db: Database.Database, sql: string, params: any[] = [], maxRetries: number = 3): any[] {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return db.prepare(sql).all(params);
      } catch (error) {
        lastError = error as Error;
        
        // SQLITE_BUSY 오류인 경우 재시도
        if ((error as any).code === 'SQLITE_BUSY' && attempt < maxRetries) {
          const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
          log(`⚠️  데이터베이스 잠금 감지, ${delay}ms 후 재시도 (${attempt}/${maxRetries})`);
          // 동기적으로 대기
          const start = Date.now();
          while (Date.now() - start < delay) {
            // busy wait
          }
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * SQLite3 exec 실행
   */
  static exec(db: Database.Database, sql: string): void {
    db.exec(sql);
  }

  /**
   * 트랜잭션을 재시도 로직과 함께 실행
   */
  static async runTransaction<T>(
    db: Database.Database, 
    transactionFn: () => T | Promise<T>, 
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 트랜잭션 시작
        this.run(db, 'BEGIN TRANSACTION');
        
        // 트랜잭션 함수 실행
        const result = await transactionFn();
        
        // 커밋
        this.run(db, 'COMMIT');
        
        return result;
      } catch (error) {
        lastError = error as Error;
        
        // 롤백 시도
        try {
          this.run(db, 'ROLLBACK');
        } catch (rollbackError) {
            log('❌ 트랜잭션 롤백 실패:', rollbackError);
        }
        
        // SQLITE_BUSY 오류인 경우 재시도
        if ((error as any).code === 'SQLITE_BUSY' && attempt < maxRetries) {
          const delay = Math.min(200 * Math.pow(2, attempt - 1), 2000); // 지수 백오프 (200ms, 400ms, 800ms)
          console.error(`⚠️  트랜잭션 잠금 감지, ${delay}ms 후 재시도 (${attempt}/${maxRetries})`);
          // 동기적으로 대기
          const start = Date.now();
          while (Date.now() - start < delay) {
            // busy wait
          }
          continue;
        }
        
        // 다른 오류이거나 최대 재시도 횟수에 도달한 경우
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * WAL 체크포인트 실행 (락 해제용)
   */
  static checkpointWAL(db: Database.Database): void {
    try {
      this.run(db, 'PRAGMA wal_checkpoint(FULL)');
      log('✅ WAL 체크포인트 완료');
    } catch (error) {
      log('❌ WAL 체크포인트 실패:', error);
      throw error;
    }
  }

  /**
   * 데이터베이스 상태 확인
   */
  static getDatabaseStatus(db: Database.Database): {
    journalMode: string;
    walAutoCheckpoint: number;
    busyTimeout: number;
    isLocked: boolean;
  } {
    try {
      const journalMode = this.get(db, 'PRAGMA journal_mode');
      const walAutoCheckpoint = this.get(db, 'PRAGMA wal_autocheckpoint');
      const busyTimeout = this.get(db, 'PRAGMA busy_timeout');

      // 간단한 락 테스트
      let isLocked = false;
      try {
        this.run(db, 'BEGIN IMMEDIATE TRANSACTION');
        this.run(db, 'ROLLBACK');
      } catch (error) {
        if ((error as any).code === 'SQLITE_BUSY') {
          isLocked = true;
        }
      }

      return {
        journalMode: journalMode.journal_mode,
        walAutoCheckpoint: walAutoCheckpoint.wal_autocheckpoint,
        busyTimeout: busyTimeout.busy_timeout,
        isLocked
      };
    } catch (error) {
      log('❌ 데이터베이스 상태 확인 실패:', error);
      throw error;
    }
  }
}

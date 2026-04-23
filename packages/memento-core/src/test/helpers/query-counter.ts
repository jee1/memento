import Database from 'better-sqlite3';
import { DatabaseUtils } from '@memento/core/shared/utils/database.js';

/**
 * 쿼리 타입
 */
export type QueryType = 'SELECT' | 'UPDATE' | 'INSERT' | 'DELETE';

/**
 * 쿼리 카운터 인터페이스
 */
export interface QueryCounter {
  /**
   * 전체 쿼리 카운트 반환
   */
  getCount(): number;

  /**
   * 쿼리 타입별 카운트 반환
   */
  getCountByType(type: QueryType): number;

  /**
   * 모든 타입별 카운트 반환
   */
  getCountsByType(): Record<QueryType, number>;

  /**
   * 카운터 리셋
   */
  reset(): void;

  /**
   * trace 콜백 제거 (리소스 누수 방지)
   */
  dispose(): void;
}

/**
 * 제외할 쿼리 패턴 (정규식)
 */
const EXCLUDED_PATTERNS = [
  /^\s*PRAGMA/i, // PRAGMA로 시작하는 쿼리
  /^\s*(BEGIN|COMMIT|ROLLBACK)/i, // 트랜잭션 제어
  /^\s*CREATE/i, // CREATE로 시작하는 쿼리
  /^\s*DROP/i, // DROP으로 시작하는 쿼리
  /INSERT\s+INTO\s+memory_item_fts/i, // FTS 트리거 INSERT
  /DELETE\s+FROM\s+memory_item_fts/i, // FTS 트리거 DELETE
];

/**
 * 쿼리 타입 추출
 */
function extractQueryType(query: string): QueryType | null {
  const trimmed = query.trim().toUpperCase();
  
  if (trimmed.startsWith('SELECT')) {
    return 'SELECT';
  } else if (trimmed.startsWith('UPDATE')) {
    return 'UPDATE';
  } else if (trimmed.startsWith('INSERT')) {
    return 'INSERT';
  } else if (trimmed.startsWith('DELETE')) {
    return 'DELETE';
  }
  
  return null;
}

/**
 * 쿼리가 제외 패턴에 해당하는지 확인
 */
function isExcluded(query: string): boolean {
  return EXCLUDED_PATTERNS.some(pattern => pattern.test(query));
}

/**
 * 쿼리 카운터 생성
 * 
 * DatabaseUtils의 메서드를 래핑하여 쿼리를 추적합니다.
 * 
 * @param db - SQLite 데이터베이스 인스턴스
 * @returns QueryCounter 인스턴스
 */
export function createQueryCounter(db: Database.Database): QueryCounter {
  const counts: Record<QueryType, number> = {
    SELECT: 0,
    UPDATE: 0,
    INSERT: 0,
    DELETE: 0,
  };

  // 원본 DatabaseUtils 메서드 저장
  const originalRun = DatabaseUtils.run;
  const originalGet = DatabaseUtils.get;
  const originalAll = DatabaseUtils.all;

  // 쿼리 카운트 함수
  const countQuery = (query: string): void => {
    // 제외 패턴 확인
    if (isExcluded(query)) {
      return;
    }

    // 쿼리 타입 추출
    const queryType = extractQueryType(query);
    if (queryType) {
      counts[queryType]++;
    }
  };

  // DatabaseUtils.run 래핑
  DatabaseUtils.run = function(db: Database.Database, sql: string, params: any[] = [], maxRetries: number = 3) {
    countQuery(sql);
    return originalRun.call(DatabaseUtils, db, sql, params, maxRetries);
  };

  // DatabaseUtils.get 래핑
  DatabaseUtils.get = function(db: Database.Database, sql: string, params: any[] = [], maxRetries: number = 3) {
    countQuery(sql);
    return originalGet.call(DatabaseUtils, db, sql, params, maxRetries);
  };

  // DatabaseUtils.all 래핑
  DatabaseUtils.all = function(db: Database.Database, sql: string, params: any[] = [], maxRetries: number = 3) {
    countQuery(sql);
    return originalAll.call(DatabaseUtils, db, sql, params, maxRetries);
  };

  return {
    getCount(): number {
      return Object.values(counts).reduce((sum, count) => sum + count, 0);
    },

    getCountByType(type: QueryType): number {
      return counts[type] || 0;
    },

    getCountsByType(): Record<QueryType, number> {
      return { ...counts };
    },

    reset(): void {
      counts.SELECT = 0;
      counts.UPDATE = 0;
      counts.INSERT = 0;
      counts.DELETE = 0;
    },

    dispose(): void {
      // 원본 메서드 복원
      DatabaseUtils.run = originalRun;
      DatabaseUtils.get = originalGet;
      DatabaseUtils.all = originalAll;
    },
  };
}


/**
 * Core Memory Repository Factory
 * 환경 변수에 따라 적절한 구현체를 생성
 */

import Database from 'better-sqlite3';
import { SqliteCoreMemoryAdapter } from '../adapters/sqlite-core-memory-adapter.js';
import { CoreMemoryRepositorySqliteImpl } from '../repositories/core-memory-repository-sqlite.impl.js';
import type { CoreMemoryRepository } from '../../../domains/memory/repositories/core-memory-repository.interface.js';

/**
 * 지원되는 데이터베이스 타입
 */
type DatabaseType = 'sqlite' | 'postgres';

/**
 * 에러 메시지 상수
 */
const ERROR_MESSAGES = {
  POSTGRES_NOT_AVAILABLE: 'PostgreSQL implementation is not yet available',
  UNSUPPORTED_TYPE: (dbType: string) => 
    `Unsupported database type: ${dbType}. Supported types: 'sqlite', 'postgres'`
} as const;

/**
 * Core Memory Repository Factory 함수
 * 
 * @param db - better-sqlite3 Database 객체
 * @returns CoreMemoryRepository 인터페이스를 구현한 인스턴스
 * 
 * @throws {Error} 지원되지 않는 데이터베이스 타입인 경우
 * @throws {Error} PostgreSQL이 요청되었지만 아직 구현되지 않은 경우
 */
export function createCoreMemoryRepository(db: Database.Database): CoreMemoryRepository {
  // 환경 변수에서 DB_TYPE 읽기 (기본값: 'sqlite')
  const dbType = (process.env.DB_TYPE || 'sqlite') as DatabaseType;

  switch (dbType) {
    case 'sqlite': {
      // SQLite 구현체 생성
      const adapter = new SqliteCoreMemoryAdapter(db);
      return new CoreMemoryRepositorySqliteImpl(adapter);
    }

    case 'postgres': {
      // PostgreSQL은 아직 구현되지 않음
      throw new Error(ERROR_MESSAGES.POSTGRES_NOT_AVAILABLE);
    }

    default: {
      // 지원되지 않는 데이터베이스 타입
      throw new Error(ERROR_MESSAGES.UNSUPPORTED_TYPE(dbType));
    }
  }
}


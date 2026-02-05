/**
 * SQLite3 데이터베이스 유틸리티 함수들
 */

import Database from 'better-sqlite3';
import { normalizeReflectionNotes } from './reflection-notes-normalize.js';
import { loadMigrationStatusToConfig, initializeMigrationStatusTable } from './fts5-migration-status.js';

// MCP 서버에서는 모든 로그 출력을 완전히 차단
const log = (...args: any[]) => {};

export class DatabaseUtils {
  // 트랜잭션 상태 추적을 위한 WeakMap
  private static transactionStates = new WeakMap<Database.Database, { inTransaction: boolean; transactionId?: string }>();

  /**
   * 트랜잭션 상태 확인
   */
  private static getTransactionState(db: Database.Database): { inTransaction: boolean; transactionId?: string } {
    if (!this.transactionStates.has(db)) {
      this.transactionStates.set(db, { inTransaction: false });
    }
    return this.transactionStates.get(db)!;
  }

  /**
   * 트랜잭션 상태 설정
   */
  private static setTransactionState(db: Database.Database, inTransaction: boolean, transactionId?: string): void {
    this.transactionStates.set(db, { inTransaction, transactionId });
  }

  /**
   * 데이터베이스 연결이 열려있는지 확인
   * better-sqlite3는 isOpen() 메서드가 없으므로 간단한 쿼리로 확인
   * @param db 데이터베이스 인스턴스
   * @returns 연결이 열려있으면 true, 닫혀있으면 false
   */
  static isOpen(db: Database.Database | null | undefined): boolean {
    if (!db) {
      return false;
    }
    
    try {
      // 간단한 쿼리로 연결 상태 확인
      db.prepare('SELECT 1').get();
      return true;
    } catch (error: any) {
      // "The database connection is not open" 에러인 경우 연결이 닫혀있음
      if (error?.message?.includes('not open') || error?.name === 'TypeError') {
        return false;
      }
      // 다른 에러는 연결이 열려있지만 쿼리 실행에 실패한 경우
      return true;
    }
  }

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
   * 트랜잭션을 재시도 로직과 함께 실행 (개선된 버전)
   */
  static async runTransaction<T>(
    db: Database.Database, 
    transactionFn: () => T | Promise<T>, 
    maxRetries: number = 3
  ): Promise<T> {
    const transactionState = this.getTransactionState(db);
    
    // 이미 트랜잭션이 진행 중인 경우 중첩 방지
    if (transactionState.inTransaction) {
      log('⚠️ 트랜잭션 중첩 감지, 기존 트랜잭션 내에서 실행');
      return await transactionFn();
    }
    
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 실제 SQLite 트랜잭션 상태 확인
        // better-sqlite3는 트랜잭션 상태를 직접 확인할 수 없으므로,
        // 트랜잭션을 시작하려고 시도하고, 에러가 발생하면 이미 트랜잭션이 진행 중인 것입니다
        try {
          // 트랜잭션 시작 시도
          this.run(db, 'BEGIN IMMEDIATE TRANSACTION');
          // 성공하면 트랜잭션 상태 설정
          this.setTransactionState(db, true, transactionId);
        } catch (beginError: any) {
          // 트랜잭션이 이미 시작된 경우 에러 처리
          if (beginError?.code === 'SQLITE_ERROR' && 
              (beginError?.message?.includes('transaction') || 
               beginError?.message?.includes('cannot start'))) {
            // 이미 트랜잭션이 진행 중인 경우, 트랜잭션 상태를 설정하고 함수 실행
            this.setTransactionState(db, true, transactionId);
            const result = await transactionFn();
            // 트랜잭션을 시작하지 않았으므로 커밋하지 않음
            // 호출자가 트랜잭션을 관리해야 함
            return result;
          }
          throw beginError;
        }
        
        // 트랜잭션 함수 실행
        const result = await transactionFn();
        
        // 커밋 (트랜잭션을 시작한 경우에만)
        // 트랜잭션 상태를 확인하여 실제로 트랜잭션을 시작했는지 확인
        const currentState = this.getTransactionState(db);
        if (currentState.transactionId === transactionId) {
          // 이 트랜잭션을 시작한 경우에만 커밋
          this.run(db, 'COMMIT');
          // 트랜잭션 상태 해제
          this.setTransactionState(db, false);
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        
        // 롤백 시도 (안전하게)
        // 트랜잭션을 시작한 경우에만 롤백
        try {
          const currentState = this.getTransactionState(db);
          if (currentState.transactionId === transactionId && currentState.inTransaction) {
            // 이 트랜잭션을 시작한 경우에만 롤백
            this.run(db, 'ROLLBACK');
          }
        } catch (rollbackError) {
          log('❌ 트랜잭션 롤백 실패:', rollbackError);
        } finally {
          // 롤백 실패해도 상태는 해제
          this.setTransactionState(db, false);
        }
        
        // SQLITE_BUSY 오류인 경우 재시도
        if ((error as any).code === 'SQLITE_BUSY' && attempt < maxRetries) {
          const delay = Math.min(200 * Math.pow(2, attempt - 1), 2000);
          log(`⚠️ 트랜잭션 잠금 감지, ${delay}ms 후 재시도 (${attempt}/${maxRetries})`);
          // 비동기 대기로 변경 (블로킹 방지)
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
   * 트랜잭션 상태 확인
   */
  static isInTransaction(db: Database.Database): boolean {
    return this.getTransactionState(db).inTransaction;
  }

  /**
   * 트랜잭션 강제 정리 (비상시 사용)
   */
  static forceCleanupTransaction(db: Database.Database): void {
    try {
      // 트랜잭션 상태 강제 해제
      this.setTransactionState(db, false);
      
      // 롤백 시도
      this.run(db, 'ROLLBACK');
      log('✅ 트랜잭션 강제 정리 완료');
    } catch (error) {
      log('⚠️ 트랜잭션 강제 정리 중 오류:', error);
      // 상태는 해제
      this.setTransactionState(db, false);
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
    inTransaction: boolean;
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
        isLocked,
        inTransaction: this.getTransactionState(db).inTransaction
      };
    } catch (error) {
      log('❌ 데이터베이스 상태 확인 실패:', error);
      throw error;
    }
  }

  /**
   * 데이터베이스 초기화 (스키마 생성)
   */
  static async initializeDatabase(db: Database.Database): Promise<void> {
    try {
      // SQLite 설정 최적화
      this.run(db, 'PRAGMA journal_mode = WAL');
      this.run(db, 'PRAGMA synchronous = NORMAL');
      this.run(db, 'PRAGMA cache_size = 10000');
      this.run(db, 'PRAGMA temp_store = MEMORY');
      this.run(db, 'PRAGMA mmap_size = 268435456'); // 256MB
      this.run(db, 'PRAGMA busy_timeout = 30000');

      // FTS5 확장 활성화
      this.run(db, 'PRAGMA compile_options');

      // 기본 테이블 생성
      this.run(db, `
        CREATE TABLE IF NOT EXISTS memory_item (
          id TEXT PRIMARY KEY,
          type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
          content TEXT NOT NULL,
          importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
          privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_accessed TIMESTAMP,
          pinned BOOLEAN DEFAULT FALSE,
          tags TEXT,
          source TEXT,
          view_count INTEGER DEFAULT 0,
          cite_count INTEGER DEFAULT 0,
          edit_count INTEGER DEFAULT 0,
          -- MIRIX Schema Expansion (v2.0) 추가 필드
          origin_source TEXT DEFAULT '{}',
          task_goal TEXT,
          steps TEXT,
          reflection_notes TEXT,
          -- Procedural Memory Enhancement (v7.0) 추가 필드
          workflow_name TEXT,
          skill_name TEXT,
          trigger_conditions TEXT,
          -- Procedural Version Management (Issue #57, migration 013)
          version INTEGER NULL,
          version_series_id TEXT NULL,
          -- Multi-agent ownership (Issue #57 Phase 2 D, migration 015)
          owner_id TEXT NULL
        )
      `);

      this.run(db, `
        CREATE TABLE IF NOT EXISTS memory_tag (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      this.run(db, `
        CREATE TABLE IF NOT EXISTS memory_item_tag (
          memory_id TEXT NOT NULL,
          tag_id INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES memory_tag(id) ON DELETE CASCADE,
          PRIMARY KEY (memory_id, tag_id)
        )
      `);

      this.run(db, `
        CREATE TABLE IF NOT EXISTS memory_link (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          relation_type TEXT CHECK (relation_type IN ('cause_of', 'derived_from', 'duplicates', 'contradicts', 'version_of')) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (source_id) REFERENCES memory_item(id) ON DELETE CASCADE,
          FOREIGN KEY (target_id) REFERENCES memory_item(id) ON DELETE CASCADE,
          UNIQUE(source_id, target_id, relation_type)
        )
      `);

      this.run(db, `
        CREATE TABLE IF NOT EXISTS feedback_event (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          event TEXT CHECK (event IN ('used', 'edited', 'neglected', 'helpful', 'not_helpful')) NOT NULL,
          score REAL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        )
      `);

      this.run(db, `
        CREATE TABLE IF NOT EXISTS wm_buffer (
          session_id TEXT PRIMARY KEY,
          items TEXT NOT NULL,
          token_budget INTEGER DEFAULT 4000,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP NOT NULL
        )
      `);

      this.run(db, `
        CREATE TABLE IF NOT EXISTS memory_embedding (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          embedding TEXT NOT NULL,
          dim INTEGER NOT NULL,
          model TEXT,
          embedding_provider TEXT DEFAULT 'tfidf',
          dimensions INTEGER,
          created_by TEXT DEFAULT 'system',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
          UNIQUE(memory_id)
        )
      `);

      // 인덱스 생성
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_type ON memory_item(type)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_created_at ON memory_item(created_at)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_last_accessed ON memory_item(last_accessed)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_pinned ON memory_item(pinned)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_privacy_scope ON memory_item(privacy_scope)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_importance ON memory_item(importance)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_user_id ON memory_item(id)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_project_id ON memory_item(id)');
      // Procedural Memory Enhancement (v7.0) 인덱스
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_workflow_name ON memory_item(workflow_name)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_item_skill_name ON memory_item(skill_name)');

      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_tag_memory_id ON memory_item_tag(memory_id)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_tag_tag_id ON memory_item_tag(tag_id)');

      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_link_source ON memory_link(source_id)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_link_target ON memory_link(target_id)');

      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_feedback_memory_id ON feedback_event(memory_id)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_feedback_event ON feedback_event(event)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback_event(created_at)');

      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_wm_buffer_expires_at ON wm_buffer(expires_at)');

      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_embedding_memory_id ON memory_embedding(memory_id)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_embedding_dim ON memory_embedding(dim)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_embedding_model ON memory_embedding(model)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions)');
      this.run(db, 'CREATE INDEX IF NOT EXISTS idx_memory_embedding_created_by ON memory_embedding(created_by)');

      // FTS5 가상 테이블 생성
      try {
        // reflection_notes 정규화를 위한 사용자 정의 함수 등록
        db.function('normalize_reflection_notes', {
          deterministic: true,
          varargs: false
        }, (reflectionNotes: string | null) => {
          return normalizeReflectionNotes(reflectionNotes);
        });

        this.run(db, `
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts USING fts5(
            content,
            tags,
            source,
            reflection_notes,
            content='memory_item',
            content_rowid='rowid'
          )
        `);

        // FTS5 트리거 생성 (reflection_notes 정규화 포함)
        this.run(db, `
          CREATE TRIGGER IF NOT EXISTS memory_item_fts_insert AFTER INSERT ON memory_item BEGIN
            INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
            VALUES (new.rowid, new.content, new.tags, new.source, normalize_reflection_notes(new.reflection_notes));
          END
        `);

        this.run(db, `
          CREATE TRIGGER IF NOT EXISTS memory_item_fts_delete AFTER DELETE ON memory_item BEGIN
            INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
            VALUES('delete', old.rowid, old.content, old.tags, old.source, normalize_reflection_notes(old.reflection_notes));
          END
        `);

        this.run(db, `
          CREATE TRIGGER IF NOT EXISTS memory_item_fts_update AFTER UPDATE ON memory_item BEGIN
            INSERT INTO memory_item_fts(memory_item_fts, rowid, content, tags, source, reflection_notes)
            VALUES('delete', old.rowid, old.content, old.tags, old.source, normalize_reflection_notes(old.reflection_notes));
            INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
            VALUES (new.rowid, new.content, new.tags, new.source, normalize_reflection_notes(new.reflection_notes));
          END
        `);
      } catch (error) {
        log('⚠️ FTS5 가상 테이블 생성 실패:', error);
      }
      
      // FTS5 마이그레이션 상태 테이블 초기화 및 상태 로드
      try {
        initializeMigrationStatusTable(db);
        loadMigrationStatusToConfig(db);
      } catch (error) {
        // 마이그레이션 상태 초기화 실패는 경고만 출력 (초기화는 계속 진행)
        log('⚠️ FTS5 마이그레이션 상태 초기화 실패:', error);
      }

      log('✅ 데이터베이스 초기화 완료');
    } catch (error) {
      log('❌ 데이터베이스 초기화 실패:', error);
      throw error;
    }
  }
}

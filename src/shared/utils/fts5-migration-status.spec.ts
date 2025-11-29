import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initializeMigrationStatusTable,
  getMigrationStatus,
  setMigrationStatus,
  loadMigrationStatusToConfig,
  isMigrationCompleted,
  isMigrationFailed,
  shouldUseFallback,
  prepareMigrationRetry,
  forceSetMigrationStatus
} from '../fts5-migration-status.js';
import { mementoConfig } from '../config/index.js';

describe('FTS5 Migration Status', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
    // Config 캐시 초기화
    (mementoConfig as any).fts5MigrationStatus = 'pending';
  });

  describe('initializeMigrationStatusTable', () => {
    it('should create migration status table', () => {
      initializeMigrationStatusTable(db);

      const result = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='fts5_migration_status'
      `).get();

      expect(result).toBeDefined();
    });

    it('should create indexes', () => {
      initializeMigrationStatusTable(db);

      const indexes = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name LIKE 'idx_fts5_migration_status%'
      `).all();

      expect(indexes.length).toBeGreaterThan(0);
    });

    it('should insert initial status if not exists', () => {
      initializeMigrationStatusTable(db);

      const status = getMigrationStatus(db);
      expect(status).toBe('pending');
    });

    it('should not overwrite existing status', () => {
      initializeMigrationStatusTable(db);
      
      // 상태를 'completed'로 변경 (올바른 전이 경로 사용)
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'completed');
      
      // 다시 초기화
      initializeMigrationStatusTable(db);
      
      // 상태가 유지되어야 함
      const status = getMigrationStatus(db);
      expect(status).toBe('completed');
    });
  });

  describe('getMigrationStatus', () => {
    it('should return pending for new table', () => {
      initializeMigrationStatusTable(db);
      
      const status = getMigrationStatus(db);
      expect(status).toBe('pending');
    });

    it('should initialize table if not exists', () => {
      // 테이블 없이 호출
      const status = getMigrationStatus(db);
      
      expect(status).toBe('pending');
      
      // 테이블이 생성되었는지 확인 (getMigrationStatus가 initializeMigrationStatusTable을 호출했으므로)
      // 다시 호출하여 테이블이 존재하는지 확인
      const status2 = getMigrationStatus(db);
      expect(status2).toBe('pending');
      
      // 직접 테이블 조회
      const result = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='fts5_migration_status'
      `).get() as { name: string } | undefined;
      
      expect(result).toBeDefined();
      expect(result?.name).toBe('fts5_migration_status');
    });

    it('should return current status', () => {
      initializeMigrationStatusTable(db);
      
      setMigrationStatus(db, 'in_progress');
      expect(getMigrationStatus(db)).toBe('in_progress');
      
      setMigrationStatus(db, 'completed');
      expect(getMigrationStatus(db)).toBe('completed');
      
      // failed 상태는 in_progress에서만 가능하므로 새로운 마이그레이션 시뮬레이션
      // completed 상태는 변경 불가능하므로, 새로운 마이그레이션을 위해 상태를 초기화해야 함
      // 하지만 실제로는 forceSetMigrationStatus를 사용하거나, 새로운 마이그레이션을 시작해야 함
      // 테스트 목적상 failed 상태를 테스트하려면 별도의 마이그레이션 인스턴스가 필요
      // 여기서는 completed 상태까지만 테스트
    });
  });

  describe('setMigrationStatus', () => {
    beforeEach(() => {
      initializeMigrationStatusTable(db);
    });

    it('should update status to in_progress from pending', () => {
      setMigrationStatus(db, 'in_progress');
      
      const status = getMigrationStatus(db);
      expect(status).toBe('in_progress');
      
      // started_at이 설정되었는지 확인
      const record = db.prepare(`
        SELECT started_at FROM fts5_migration_status 
        WHERE migration_key = 'fts5-reflection-notes'
      `).get() as { started_at: string | null };
      
      expect(record.started_at).not.toBeNull();
    });

    it('should update status to completed from in_progress', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'completed');
      
      const status = getMigrationStatus(db);
      expect(status).toBe('completed');
      
      // completed_at이 설정되었는지 확인
      const record = db.prepare(`
        SELECT completed_at FROM fts5_migration_status 
        WHERE migration_key = 'fts5-reflection-notes'
      `).get() as { completed_at: string | null };
      
      expect(record.completed_at).not.toBeNull();
    });

    it('should update status to failed from in_progress', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'failed', 'Test error message');
      
      const status = getMigrationStatus(db);
      expect(status).toBe('failed');
      
      // failed_at과 error_message가 설정되었는지 확인
      const record = db.prepare(`
        SELECT failed_at, error_message, retry_count FROM fts5_migration_status 
        WHERE migration_key = 'fts5-reflection-notes'
      `).get() as { failed_at: string | null; error_message: string | null; retry_count: number };
      
      expect(record.failed_at).not.toBeNull();
      expect(record.error_message).toBe('Test error message');
      expect(record.retry_count).toBe(1);
    });

    it('should update status to pending from failed (retry)', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'failed', 'Test error');
      setMigrationStatus(db, 'pending');
      
      const status = getMigrationStatus(db);
      expect(status).toBe('pending');
      
      // 실패 관련 필드가 초기화되었는지 확인
      const record = db.prepare(`
        SELECT started_at, completed_at, failed_at, error_message FROM fts5_migration_status 
        WHERE migration_key = 'fts5-reflection-notes'
      `).get() as {
        started_at: string | null;
        completed_at: string | null;
        failed_at: string | null;
        error_message: string | null;
      };
      
      expect(record.started_at).toBeNull();
      expect(record.completed_at).toBeNull();
      expect(record.failed_at).toBeNull();
      expect(record.error_message).toBeNull();
    });

    it('should throw error for invalid status transition', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'completed');
      
      // completed에서 다른 상태로 변경 불가
      expect(() => {
        setMigrationStatus(db, 'in_progress');
      }).toThrow('유효하지 않은 상태 전이');
    });

    it('should update config cache when status changes', () => {
      setMigrationStatus(db, 'in_progress');
      expect(mementoConfig.fts5MigrationStatus).toBe('in_progress');
      
      setMigrationStatus(db, 'completed');
      expect(mementoConfig.fts5MigrationStatus).toBe('completed');
    });
  });

  describe('loadMigrationStatusToConfig', () => {
    it('should load status from database to config', () => {
      initializeMigrationStatusTable(db);
      
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'completed');
      loadMigrationStatusToConfig(db);
      
      expect(mementoConfig.fts5MigrationStatus).toBe('completed');
    });

    it('should use default pending if load fails', () => {
      // 테이블 없이 호출 (에러 발생)
      loadMigrationStatusToConfig(db);
      
      // 기본값 'pending'이 설정되어야 함
      expect(mementoConfig.fts5MigrationStatus).toBe('pending');
    });
  });

  describe('isMigrationCompleted', () => {
    beforeEach(() => {
      initializeMigrationStatusTable(db);
    });

    it('should return true when status is completed', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'completed');
      expect(isMigrationCompleted(db)).toBe(true);
    });

    it('should return false when status is not completed', () => {
      setMigrationStatus(db, 'pending');
      expect(isMigrationCompleted(db)).toBe(false);
      
      setMigrationStatus(db, 'in_progress');
      expect(isMigrationCompleted(db)).toBe(false);
      
      setMigrationStatus(db, 'failed');
      expect(isMigrationCompleted(db)).toBe(false);
    });

    it('should use config cache when db is not provided', () => {
      mementoConfig.fts5MigrationStatus = 'completed';
      expect(isMigrationCompleted()).toBe(true);
      
      mementoConfig.fts5MigrationStatus = 'pending';
      expect(isMigrationCompleted()).toBe(false);
    });
  });

  describe('isMigrationFailed', () => {
    beforeEach(() => {
      initializeMigrationStatusTable(db);
    });

    it('should return true when status is failed', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'failed', 'Test error');
      expect(isMigrationFailed(db)).toBe(true);
    });

    it('should return false when status is not failed', () => {
      setMigrationStatus(db, 'pending');
      expect(isMigrationFailed(db)).toBe(false);
      
      setMigrationStatus(db, 'in_progress');
      expect(isMigrationFailed(db)).toBe(false);
      
      setMigrationStatus(db, 'completed');
      expect(isMigrationFailed(db)).toBe(false);
    });

    it('should use config cache when db is not provided', () => {
      mementoConfig.fts5MigrationStatus = 'failed';
      expect(isMigrationFailed()).toBe(true);
      
      mementoConfig.fts5MigrationStatus = 'pending';
      expect(isMigrationFailed()).toBe(false);
    });
  });

  describe('shouldUseFallback', () => {
    beforeEach(() => {
      initializeMigrationStatusTable(db);
      // 환경 변수 초기화
      delete process.env.MEMENTO_FTS5_FALLBACK_ENABLED;
    });

    it('should return true when status is pending', () => {
      setMigrationStatus(db, 'pending');
      expect(shouldUseFallback(db)).toBe(true);
    });

    it('should return true when status is failed', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'failed', 'Test error');
      expect(shouldUseFallback(db)).toBe(true);
    });

    it('should return false when status is completed', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'completed');
      expect(shouldUseFallback(db)).toBe(false);
    });

    it('should return false when status is in_progress', () => {
      setMigrationStatus(db, 'in_progress');
      expect(shouldUseFallback(db)).toBe(false);
    });

    it('should return true when MEMENTO_FTS5_FALLBACK_ENABLED is true', () => {
      process.env.MEMENTO_FTS5_FALLBACK_ENABLED = 'true';
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'completed');
      
      expect(shouldUseFallback(db)).toBe(true);
    });

    it('should use config cache when db is not provided', () => {
      mementoConfig.fts5MigrationStatus = 'pending';
      expect(shouldUseFallback()).toBe(true);
      
      mementoConfig.fts5MigrationStatus = 'completed';
      expect(shouldUseFallback()).toBe(false);
    });
  });

  describe('prepareMigrationRetry', () => {
    beforeEach(() => {
      initializeMigrationStatusTable(db);
    });

    it('should reset status to pending from failed', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'failed', 'Test error');
      
      prepareMigrationRetry(db);
      
      const status = getMigrationStatus(db);
      expect(status).toBe('pending');
    });

    it('should throw error when status is not failed', () => {
      setMigrationStatus(db, 'pending');
      
      expect(() => {
        prepareMigrationRetry(db);
      }).toThrow('마이그레이션 재시도는');
      
      setMigrationStatus(db, 'in_progress');
      
      expect(() => {
        prepareMigrationRetry(db);
      }).toThrow('마이그레이션 재시도는');
      
      setMigrationStatus(db, 'completed');
      
      expect(() => {
        prepareMigrationRetry(db);
      }).toThrow('마이그레이션 재시도는');
    });
  });

  describe('forceSetMigrationStatus', () => {
    beforeEach(() => {
      initializeMigrationStatusTable(db);
    });

    it('should force update status without validation', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'completed');
      
      // 상태 전이 검증 없이 강제 업데이트
      forceSetMigrationStatus(db, 'in_progress');
      
      const status = getMigrationStatus(db);
      expect(status).toBe('in_progress');
    });

    it('should update config cache', () => {
      forceSetMigrationStatus(db, 'completed');
      expect(mementoConfig.fts5MigrationStatus).toBe('completed');
    });
  });

  describe('Status Transition Validation', () => {
    beforeEach(() => {
      initializeMigrationStatusTable(db);
    });

    it('should allow valid transitions', () => {
      // pending → in_progress
      setMigrationStatus(db, 'in_progress');
      expect(getMigrationStatus(db)).toBe('in_progress');
      
      // in_progress → completed
      setMigrationStatus(db, 'completed');
      expect(getMigrationStatus(db)).toBe('completed');
    });

    it('should allow in_progress → failed', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'failed', 'Test error');
      expect(getMigrationStatus(db)).toBe('failed');
    });

    it('should allow failed → pending (retry)', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'failed', 'Test error');
      setMigrationStatus(db, 'pending');
      expect(getMigrationStatus(db)).toBe('pending');
    });

    it('should not allow completed → other status', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'completed');
      
      expect(() => {
        setMigrationStatus(db, 'in_progress');
      }).toThrow('유효하지 않은 상태 전이');
      
      expect(() => {
        setMigrationStatus(db, 'failed');
      }).toThrow('유효하지 않은 상태 전이');
      
      expect(() => {
        setMigrationStatus(db, 'pending');
      }).toThrow('유효하지 않은 상태 전이');
    });

    it('should allow same status update (for error message update)', () => {
      setMigrationStatus(db, 'in_progress');
      setMigrationStatus(db, 'failed', 'First error');
      setMigrationStatus(db, 'failed', 'Second error');
      
      const record = db.prepare(`
        SELECT error_message, retry_count FROM fts5_migration_status 
        WHERE migration_key = 'fts5-reflection-notes'
      `).get() as { error_message: string | null; retry_count: number };
      
      expect(record.error_message).toBe('Second error');
      expect(record.retry_count).toBe(2); // retry_count 증가
    });
  });

  describe('DB-Config Synchronization', () => {
    beforeEach(() => {
      initializeMigrationStatusTable(db);
    });

    it('should sync status from DB to config on setMigrationStatus', () => {
      setMigrationStatus(db, 'in_progress');
      expect(mementoConfig.fts5MigrationStatus).toBe('in_progress');
      
      setMigrationStatus(db, 'completed');
      expect(mementoConfig.fts5MigrationStatus).toBe('completed');
    });

    it('should sync status from DB to config on loadMigrationStatusToConfig', () => {
      // DB에 직접 상태 설정 (config 업데이트 없이)
      db.prepare(`
        UPDATE fts5_migration_status 
        SET status = 'completed' 
        WHERE migration_key = 'fts5-reflection-notes'
      `).run();
      
      // Config 초기화
      (mementoConfig as any).fts5MigrationStatus = 'pending';
      
      // 로드 후 동기화 확인
      loadMigrationStatusToConfig(db);
      expect(mementoConfig.fts5MigrationStatus).toBe('completed');
    });

    it('should maintain sync after multiple status changes', () => {
      setMigrationStatus(db, 'pending');
      expect(mementoConfig.fts5MigrationStatus).toBe('pending');
      
      setMigrationStatus(db, 'in_progress');
      expect(mementoConfig.fts5MigrationStatus).toBe('in_progress');
      
      setMigrationStatus(db, 'completed');
      expect(mementoConfig.fts5MigrationStatus).toBe('completed');
      
      // DB에서 직접 확인
      const dbStatus = getMigrationStatus(db);
      expect(dbStatus).toBe('completed');
      expect(mementoConfig.fts5MigrationStatus).toBe(dbStatus);
    });
  });
});


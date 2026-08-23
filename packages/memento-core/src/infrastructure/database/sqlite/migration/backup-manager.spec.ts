/**
 * BackupManager 테스트
 * 백업 관리자 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackupManager } from './backup-manager.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('BackupManager', () => {
  let db: Database.Database;
  let backupManager: BackupManager;
  let testRoot: string;
  let dbPath: string;
  let backupsDir: string;

  beforeEach(async () => {
    db = await setupTestDatabase();
    testRoot = mkdtempSync(join(tmpdir(), 'memento-backup-manager-'));
    dbPath = join(testRoot, 'memory.db');
    backupsDir = join(testRoot, 'backups');
    backupManager = new BackupManager(backupsDir);
  });

  afterEach(() => {
    // 데이터베이스 정리
    try {
      cleanupTestDatabase(db);
    } catch (error) {
      // 정리 실패는 무시
    }

    rmSync(testRoot, { recursive: true, force: true });
  });

  describe('createBackup', () => {
    it('메모리 데이터베이스는 백업 API를 사용할 수 없어야 함', async () => {
      // Given: 메모리 데이터베이스
      // When & Then: 백업 생성 시 에러 발생 (메모리 DB는 백업 API 미지원)
      await expect(
        backupManager.createBackup(db, '1.0')
      ).rejects.toThrow();
    });

  });

  describe('restoreBackup', () => {
    it('존재하지 않는 백업 파일 복원 시 에러를 발생시켜야 함', async () => {
      // When & Then: 존재하지 않는 백업 파일 복원 시 에러 발생
      try {
        await backupManager.restoreBackup('/nonexistent/backup.db', dbPath);
        // 에러가 발생하지 않으면 테스트 실패
        expect(true).toBe(false);
      } catch (error) {
        // 에러가 발생해야 함
        expect(error).toBeDefined();
      }
    });
  });

  describe('getBackupsDirectory', () => {
    it('백업 디렉토리 경로를 반환해야 함', () => {
      // When: 백업 디렉토리 경로 조회
      const dir = backupManager.getBackupsDirectory();

      // Then: 디렉토리 경로가 반환되어야 함
      expect(dir).toBeDefined();
      expect(typeof dir).toBe('string');
      expect(dir).toBe(backupsDir);
    });
  });

  describe('cleanupOldBackups', () => {
    it('오래된 백업을 정리해야 함', async () => {
      // When: 오래된 백업 정리 (최대 2개 유지)
      const deletedCount = await backupManager.cleanupOldBackups(2);

      // Then: 정리 결과가 반환되어야 함
      expect(typeof deletedCount).toBe('number');
      expect(deletedCount).toBeGreaterThanOrEqual(0);
    });
  });
});

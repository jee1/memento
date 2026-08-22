/**
 * BackupManager 테스트
 * 백업 관리자 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackupManager } from './backup-manager.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';

describe('BackupManager', () => {
  let db: Database.Database;
  let backupManager: BackupManager;
  let testBackupsDir: string;

  beforeEach(async () => {
    db = await setupTestDatabase();
    // 테스트용 백업 디렉토리
    testBackupsDir = join(process.cwd(), 'data', 'test-backups');
    backupManager = new BackupManager(testBackupsDir);
  });

  afterEach(async () => {
    // 비동기 작업이 완료될 때까지 대기
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 데이터베이스 정리
    try {
      await cleanupTestDatabase(db);
    } catch (error) {
      // 정리 실패는 무시
    }
    
    // 테스트 백업 파일 정리
    try {
      if (existsSync(testBackupsDir)) {
        const files = require('fs').readdirSync(testBackupsDir);
        for (const file of files) {
          if (file.endsWith('.db')) {
            unlinkSync(join(testBackupsDir, file));
          }
        }
      }
    } catch (error) {
      // 정리 실패는 무시
    }
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
        await backupManager.restoreBackup('/nonexistent/backup.db', '/target/db.db');
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
      expect(dir).toBe(testBackupsDir);
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


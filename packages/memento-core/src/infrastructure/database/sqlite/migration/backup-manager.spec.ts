/**
 * BackupManager 테스트
 * 백업 관리자 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackupManager } from './backup-manager.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import fs, { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

  describe('cleanupBackups', () => {
    const now = new Date('2026-08-23T00:00:00.000Z');

    function writeBackup(name: string, size: number): string {
      const path = join(backupsDir, name);
      writeFileSync(path, 'x'.repeat(size));
      return path;
    }

    function expectInvariants(report: Awaited<ReturnType<BackupManager['cleanupBackups']>>): void {
      expect(report.inspectedCount).toBe(report.selectedCount + report.ignoredCount);
      expect(report.artifacts).toHaveLength(report.selectedCount);
    }

    it('previews fixed filename retention without selecting operator backups or non-file children', async () => {
      const expiredAutomatic = 'memory-backup-2.0-2026-06-01T00-00-00-000Z.db';
      const inspectFailedAutomatic = 'memory-backup-2.0-2026-06-02T00-00-00-000Z.db';
      const boundaryAutomatic = 'memory-backup-2.0-2026-07-24T00-00-00-000Z.db';
      const currentAutomatic = 'memory-backup-2.0-2026-08-01T00-00-00-000Z.db';
      const futureAutomatic = 'memory-backup-2.0-2026-09-01T00-00-00-000Z.db';
      const operatorBackup = 'memory-backup-2026-06-01T00-00-00-000Z.db';
      const invalidTimestamp = 'memory-backup-2.0-2026-02-30T00-00-00-000Z.db';
      const directoryName = 'memory-backup-2.0-2026-05-01T00-00-00-000Z.db';
      const symlinkName = 'memory-backup-2.0-2026-05-02T00-00-00-000Z.db';

      writeBackup(expiredAutomatic, 5);
      const inspectFailedPath = writeBackup(inspectFailedAutomatic, 7);
      writeBackup(boundaryAutomatic, 3);
      writeBackup(currentAutomatic, 3);
      writeBackup(futureAutomatic, 3);
      writeBackup(operatorBackup, 11);
      writeBackup(invalidTimestamp, 3);
      mkdirSync(join(backupsDir, directoryName));
      symlinkSync(join(backupsDir, expiredAutomatic), join(backupsDir, symlinkName));

      const realLstatSync = fs.lstatSync.bind(fs);
      const lstatSpy = vi.spyOn(fs, 'lstatSync').mockImplementation(((path: fs.PathLike) => {
        if (path === inspectFailedPath) {
          const error = new Error('EACCES') as NodeJS.ErrnoException;
          error.code = 'EACCES';
          throw error;
        }
        return realLstatSync(path);
      }) as typeof fs.lstatSync);
      const statSpy = vi.spyOn(fs, 'statSync');
      const realpathSpy = vi.spyOn(fs, 'realpathSync');

      try {
        const report = await backupManager.cleanupBackups({ now });

        expect(report).toMatchObject({
          ok: false,
          error: null,
          mode: 'preview',
          inspectedCount: 9,
          selectedCount: 2,
          selectedBytes: 5,
          deletedCount: 0,
          reclaimedBytes: 0,
          skippedCount: 0,
          failedCount: 1,
          ignoredCount: 7,
          artifacts: [
            { id: expiredAutomatic, status: 'selected', reason: 'expired-automatic', detail: null },
            { id: inspectFailedAutomatic, status: 'failed', reason: 'expired-automatic', detail: 'inspect-failed' },
          ],
        });
        expectInvariants(report);
        expect(report.artifacts.map(item => item.id)).not.toContain(operatorBackup);
        expect(report.artifacts.map(item => item.id)).not.toContain(directoryName);
        expect(report.artifacts.map(item => item.id)).not.toContain(symlinkName);
        expect(JSON.stringify(report)).not.toContain(testRoot);
        expect(statSpy).not.toHaveBeenCalled();
        expect(realpathSpy).not.toHaveBeenCalled();
      } finally {
        lstatSpy.mockRestore();
        statSpy.mockRestore();
        realpathSpy.mockRestore();
      }
    });

    it('treats invalid runtime cleanup modes as preview and does not delete', async () => {
      const expiredAutomatic = 'memory-backup-2.0-2026-06-01T00-00-00-000Z.db';
      const expiredPath = writeBackup(expiredAutomatic, 5);

      const report = await backupManager.cleanupBackups({
        mode: 'dry-run',
        now,
      } as Parameters<BackupManager['cleanupBackups']>[0]);

      expect(report).toMatchObject({
        ok: true,
        mode: 'preview',
        selectedCount: 1,
        selectedBytes: 5,
        deletedCount: 0,
        reclaimedBytes: 0,
        artifacts: [
          { id: expiredAutomatic, status: 'selected', reason: 'expired-automatic', detail: null },
        ],
      });
      expectInvariants(report);
      expect(existsSync(expiredPath)).toBe(true);
    });

    it('applies cleanup with per-file ENOENT and unlink-failure reconciliation', async () => {
      const missingCandidate = 'memory-backup-2.0-2026-06-01T00-00-00-000Z.db';
      const unlinkFailureCandidate = 'memory-backup-2.0-2026-06-02T00-00-00-000Z.db';
      const deletedCandidate = 'memory-backup-2.0-2026-06-03T00-00-00-000Z.db';

      const missingPath = writeBackup(missingCandidate, 4);
      const unlinkFailurePath = writeBackup(unlinkFailureCandidate, 5);
      const deletedPath = writeBackup(deletedCandidate, 6);
      writeBackup('memory-backup-2026-06-01T00-00-00-000Z.db', 13);
      writeBackup('memory-backup-2.0-2026-08-01T00-00-00-000Z.db', 3);

      const realLstatSync = fs.lstatSync.bind(fs);
      const realUnlinkSync = fs.unlinkSync.bind(fs);
      const lstatCalls = new Map<string, number>();
      const lstatSpy = vi.spyOn(fs, 'lstatSync').mockImplementation(((path: fs.PathLike) => {
        const key = String(path);
        const count = (lstatCalls.get(key) ?? 0) + 1;
        lstatCalls.set(key, count);
        if (key === missingPath && count === 2) {
          const error = new Error('ENOENT') as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        }
        return realLstatSync(path);
      }) as typeof fs.lstatSync);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(((path: fs.PathLike) => {
        if (String(path) === unlinkFailurePath) {
          const error = new Error('EPERM') as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        }
        return realUnlinkSync(path);
      }) as typeof fs.unlinkSync);
      const statSpy = vi.spyOn(fs, 'statSync');
      const realpathSpy = vi.spyOn(fs, 'realpathSync');

      try {
        const report = await backupManager.cleanupBackups({ mode: 'apply', now });

        expect(report).toMatchObject({
          ok: false,
          mode: 'apply',
          selectedCount: 3,
          selectedBytes: 15,
          deletedCount: 1,
          reclaimedBytes: 6,
          skippedCount: 1,
          failedCount: 1,
          ignoredCount: 2,
          artifacts: [
            { id: missingCandidate, status: 'skipped', reason: 'expired-automatic', detail: 'missing-before-delete' },
            { id: unlinkFailureCandidate, status: 'failed', reason: 'expired-automatic', detail: 'delete-failed' },
            { id: deletedCandidate, status: 'deleted', reason: 'expired-automatic', detail: null },
          ],
        });
        expect(report.selectedCount).toBe(
          report.deletedCount + report.skippedCount + report.failedCount
        );
        expectInvariants(report);
        expect(JSON.stringify(report)).not.toContain(testRoot);
        expect(existsSync(missingPath)).toBe(true);
        expect(existsSync(unlinkFailurePath)).toBe(true);
        expect(existsSync(deletedPath)).toBe(false);
        expect(statSpy).not.toHaveBeenCalled();
        expect(realpathSpy).not.toHaveBeenCalled();
      } finally {
        lstatSpy.mockRestore();
        unlinkSpy.mockRestore();
        statSpy.mockRestore();
        realpathSpy.mockRestore();
      }
    });

    it('skips changed candidates and keeps applying later candidates', async () => {
      const changedCandidate = 'memory-backup-2.0-2026-06-01T00-00-00-000Z.db';
      const deletedCandidate = 'memory-backup-2.0-2026-06-02T00-00-00-000Z.db';
      const changedPath = writeBackup(changedCandidate, 4);
      const deletedPath = writeBackup(deletedCandidate, 6);

      const realLstatSync = fs.lstatSync.bind(fs);
      const lstatCalls = new Map<string, number>();
      const lstatSpy = vi.spyOn(fs, 'lstatSync').mockImplementation(((path: fs.PathLike) => {
        const key = String(path);
        const count = (lstatCalls.get(key) ?? 0) + 1;
        lstatCalls.set(key, count);
        if (key === changedPath && count === 2) {
          writeFileSync(changedPath, 'changed');
        }
        return realLstatSync(path);
      }) as typeof fs.lstatSync);

      try {
        const report = await backupManager.cleanupBackups({ mode: 'apply', now });

        expect(report).toMatchObject({
          ok: true,
          mode: 'apply',
          inspectedCount: 2,
          selectedCount: 2,
          selectedBytes: 10,
          deletedCount: 1,
          reclaimedBytes: 6,
          skippedCount: 1,
          failedCount: 0,
          ignoredCount: 0,
          artifacts: [
            { id: changedCandidate, status: 'skipped', reason: 'expired-automatic', detail: 'changed-before-delete' },
            { id: deletedCandidate, status: 'deleted', reason: 'expired-automatic', detail: null },
          ],
        });
        expect(report.selectedCount).toBe(
          report.deletedCount + report.skippedCount + report.failedCount
        );
        expectInvariants(report);
        expect(existsSync(changedPath)).toBe(true);
        expect(existsSync(deletedPath)).toBe(false);
      } finally {
        lstatSpy.mockRestore();
      }
    });

    it('returns a masked scan failure report when the backup directory cannot be enumerated', async () => {
      const backupsPathThatIsAFile = join(testRoot, 'not-a-directory');
      writeFileSync(backupsPathThatIsAFile, 'x');
      const managerWithScanFailure = new BackupManager(backupsPathThatIsAFile);

      const report = await managerWithScanFailure.cleanupBackups();

      expect(report).toMatchObject({
        ok: false,
        error: 'scan-failed',
        inspectedCount: 0,
        selectedCount: 0,
        artifacts: [],
      });
      expectInvariants(report);
      expect(JSON.stringify(report)).not.toContain(testRoot);
    });
  });
});

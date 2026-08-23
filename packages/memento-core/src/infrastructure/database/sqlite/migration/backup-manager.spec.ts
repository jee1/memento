/**
 * BackupManager 테스트
 * 백업 관리자 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackupManager } from './backup-manager.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import fs, {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

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
    const partialNamePattern = /^\.memory-backup-partial-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.db$/;

    function openWalDatabase(): Database.Database {
      const fileDb = new Database(dbPath);
      fileDb.pragma('journal_mode = WAL');
      fileDb.pragma('wal_autocheckpoint = 0');
      fileDb.exec(`
        CREATE TABLE wal_notes (id INTEGER PRIMARY KEY, note TEXT NOT NULL);
        INSERT INTO wal_notes (note) VALUES ('committed in wal');
      `);
      return fileDb;
    }

    async function captureCreateFailure(
      fileDb: Database.Database,
      expectedReason: string
    ): Promise<Error> {
      try {
        await backupManager.createBackup(fileDb, '2.0');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const caught = error as Error;
        expect(caught.message).toContain(expectedReason);
        expect(caught.message).not.toContain(testRoot);
        expect(JSON.stringify(caught)).not.toContain(testRoot);
        return caught;
      }

      throw new Error(`expected ${expectedReason}`);
    }

    function backupDirectoryNames(): string[] {
      return fs.readdirSync(backupsDir).sort();
    }

    function expectNoAttemptResidue(): void {
      expect(backupDirectoryNames()).toEqual([]);
    }

    it('메모리 데이터베이스는 백업 API를 사용할 수 없어야 함', async () => {
      // Given: 메모리 데이터베이스
      // When & Then: 백업 생성 시 에러 발생 (메모리 DB는 백업 API 미지원)
      await expect(
        backupManager.createBackup(db, '1.0')
      ).rejects.toThrow();
    });

    it('publishes a standalone validated online backup containing committed WAL content', async () => {
      const fileDb = new Database(dbPath);
      const publicationEvents: string[] = [];
      const realLinkSync = fs.linkSync.bind(fs);
      const realUnlinkSync = fs.unlinkSync.bind(fs);
      const linkSpy = vi.spyOn(fs, 'linkSync').mockImplementation(((existingPath, newPath) => {
        expect(existsSync(String(newPath))).toBe(false);
        expect(existsSync(String(existingPath))).toBe(true);
        expect(basename(String(existingPath))).toMatch(partialNamePattern);
        publicationEvents.push('link');
        return realLinkSync(existingPath, newPath);
      }) as typeof fs.linkSync);
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(((path) => {
        if (partialNamePattern.test(basename(String(path)))) {
          expect(publicationEvents).toEqual(['link']);
          publicationEvents.push('unlink-partial');
        }
        return realUnlinkSync(path);
      }) as typeof fs.unlinkSync);

      try {
        fileDb.pragma('journal_mode = WAL');
        fileDb.pragma('wal_autocheckpoint = 0');
        fileDb.exec(`
          CREATE TABLE wal_notes (id INTEGER PRIMARY KEY, note TEXT NOT NULL);
          INSERT INTO wal_notes (note) VALUES ('committed in wal');
        `);

        const result = await backupManager.createBackup(fileDb, '2.0');
        const backup = new Database(result.backupPath, { readonly: true });

        try {
          expect(backup.prepare('SELECT note FROM wal_notes').pluck().get()).toBe('committed in wal');
          expect(result.size).toBeGreaterThan(0);
          expect(result.size).toBe(result.expectedSize);
          expect(result.integrityCheck).toBe('ok');
          expect(backup.pragma('page_count', { simple: true })).toBe(result.totalPages);
          expect(backup.pragma('page_size', { simple: true })).toBe(result.expectedSize / result.totalPages);
          expect(backup.pragma('journal_mode', { simple: true })).toBe('delete');
        } finally {
          backup.close();
        }

        expect(existsSync(`${result.backupPath}-wal`)).toBe(false);
        expect(existsSync(`${result.backupPath}-shm`)).toBe(false);
        expect(fs.readdirSync(backupsDir)).toEqual([basename(result.backupPath)]);
        expect(publicationEvents).toEqual(['link', 'unlink-partial']);
      } finally {
        linkSpy.mockRestore();
        unlinkSpy.mockRestore();
        fileDb.close();
      }
    });

    it('removes partial db, wal, and shm when the online backup write fails', async () => {
      const fileDb = openWalDatabase();
      const backupSpy = vi.spyOn(fileDb, 'backup').mockImplementation((async destination => {
        const path = String(destination);
        writeFileSync(path, 'partial');
        writeFileSync(`${path}-wal`, 'wal');
        writeFileSync(`${path}-shm`, 'shm');
        throw new Error('raw write path leak');
      }) as Database.Database['backup']);

      try {
        await captureCreateFailure(fileDb, 'backup-write-failed');
        expectNoAttemptResidue();
      } finally {
        backupSpy.mockRestore();
        fileDb.close();
      }
    });

    it.each([
      ['zero-byte backup', 0],
      ['snapshot size mismatch', 1],
    ])('removes the current attempt after %s validation fails', async (_name, reportedSize) => {
      const fileDb = openWalDatabase();
      const realStatSync = fs.statSync.bind(fs);
      const statSpy = vi.spyOn(fs, 'statSync').mockImplementation(((path, options?: fs.StatOptions) => {
        const stats = realStatSync(path, options as never);
        if (partialNamePattern.test(basename(String(path)))) {
          return { ...stats, size: reportedSize };
        }
        return stats;
      }) as typeof fs.statSync);

      try {
        await captureCreateFailure(fileDb, 'backup-size-mismatch');
        expectNoAttemptResidue();
      } finally {
        statSpy.mockRestore();
        fileDb.close();
      }
    });

    it('removes the current attempt after snapshot page metadata mismatch', async () => {
      const fileDb = openWalDatabase();
      const realBackup = fileDb.backup.bind(fileDb);
      const backupSpy = vi.spyOn(fileDb, 'backup').mockImplementation((async destination => {
        const metadata = await realBackup(destination);
        return { ...metadata, totalPages: metadata.totalPages + 1 };
      }) as Database.Database['backup']);

      try {
        await captureCreateFailure(fileDb, 'backup-validation-failed');
        expectNoAttemptResidue();
      } finally {
        backupSpy.mockRestore();
        fileDb.close();
      }
    });

    it('removes the current attempt after incomplete backup metadata', async () => {
      const fileDb = openWalDatabase();
      const realBackup = fileDb.backup.bind(fileDb);
      const backupSpy = vi.spyOn(fileDb, 'backup').mockImplementation((async destination => {
        const metadata = await realBackup(destination);
        return { ...metadata, remainingPages: 1 };
      }) as Database.Database['backup']);

      try {
        await captureCreateFailure(fileDb, 'backup-incomplete');
        expectNoAttemptResidue();
      } finally {
        backupSpy.mockRestore();
        fileDb.close();
      }
    });

    it('removes the current attempt after destination page size mismatch', async () => {
      const fileDb = openWalDatabase();
      const realPragma = Database.prototype.pragma;
      const pragmaSpy = vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
        this: Database.Database,
        source: string,
        options?: Database.PragmaOptions
      ) {
        if (
          source === 'page_size' &&
          partialNamePattern.test(basename(this.name))
        ) {
          return 8192;
        }
        return realPragma.call(this, source, options);
      });

      try {
        await captureCreateFailure(fileDb, 'backup-validation-failed');
        expectNoAttemptResidue();
      } finally {
        pragmaSpy.mockRestore();
        fileDb.close();
      }
    });

    it.each([
      ['journal mode switch throws', () => {
        throw new Error('raw journal mode path leak');
      }],
      ['journal mode remains wal', () => 'wal'],
    ])('removes the current attempt when %s', async (_name, journalResult) => {
      const fileDb = openWalDatabase();
      const realPragma = Database.prototype.pragma;
      const pragmaSpy = vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
        this: Database.Database,
        source: string,
        options?: Database.PragmaOptions
      ) {
        if (
          (source === 'journal_mode = DELETE' || source === 'journal_mode') &&
          partialNamePattern.test(basename(this.name))
        ) {
          return journalResult();
        }
        return realPragma.call(this, source, options);
      });

      try {
        await captureCreateFailure(fileDb, 'backup-validation-failed');
        expectNoAttemptResidue();
      } finally {
        pragmaSpy.mockRestore();
        fileDb.close();
      }
    });

    it('removes the current attempt after full integrity validation fails', async () => {
      const fileDb = openWalDatabase();
      const realPragma = Database.prototype.pragma;
      const pragmaSpy = vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
        this: Database.Database,
        source: string,
        options?: Database.PragmaOptions
      ) {
        if (source === 'integrity_check' && partialNamePattern.test(basename(this.name))) {
          return [{ integrity_check: 'row 1 missing from index' }];
        }
        return realPragma.call(this, source, options);
      });

      try {
        await captureCreateFailure(fileDb, 'backup-validation-failed');
        expectNoAttemptResidue();
      } finally {
        pragmaSpy.mockRestore();
        fileDb.close();
      }
    });

    it('removes the current attempt after backup checkpoint fails', async () => {
      const fileDb = openWalDatabase();
      const realPragma = Database.prototype.pragma;
      const pragmaSpy = vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
        this: Database.Database,
        source: string,
        options?: Database.PragmaOptions
      ) {
        if (source === 'wal_checkpoint(TRUNCATE)' && partialNamePattern.test(basename(this.name))) {
          return [{ busy: 1, log: 1, checkpointed: 0 }];
        }
        return realPragma.call(this, source, options);
      });

      try {
        await captureCreateFailure(fileDb, 'backup-checkpoint-incomplete');
        expectNoAttemptResidue();
      } finally {
        pragmaSpy.mockRestore();
        fileDb.close();
      }
    });

    it('fails safely when an attempt sidecar cannot be removed after validation', async () => {
      const fileDb = openWalDatabase();
      const realClose = Database.prototype.close;
      const realUnlinkSync = fs.unlinkSync.bind(fs);
      let failedSidecar = false;
      const closeSpy = vi.spyOn(Database.prototype, 'close').mockImplementation(function (this: Database.Database) {
        const path = this.name;
        const result = realClose.call(this);
        if (partialNamePattern.test(basename(path))) {
          writeFileSync(`${path}-wal`, 'wal');
          writeFileSync(`${path}-shm`, 'shm');
        }
        return result;
      });
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(((path) => {
        if (!failedSidecar && String(path).endsWith('-wal')) {
          failedSidecar = true;
          const error = new Error('sidecar unlink denied') as NodeJS.ErrnoException;
          error.code = 'EACCES';
          throw error;
        }
        return realUnlinkSync(path);
      }) as typeof fs.unlinkSync);

      try {
        await captureCreateFailure(fileDb, 'backup-sidecar-cleanup-failed');
        expectNoAttemptResidue();
      } finally {
        closeSpy.mockRestore();
        unlinkSpy.mockRestore();
        fileDb.close();
      }
    });

    it('removes the current attempt after file sync fails', async () => {
      const fileDb = openWalDatabase();
      const fsyncSpy = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => {
        throw new Error('raw fsync path leak');
      });

      try {
        await captureCreateFailure(fileDb, 'backup-fsync-failed');
        expectNoAttemptResidue();
      } finally {
        fsyncSpy.mockRestore();
        fileDb.close();
      }
    });

    it('refuses a completed-name collision without overwriting it', async () => {
      const fileDb = openWalDatabase();
      const isoSpy = vi.spyOn(Date.prototype, 'toISOString')
        .mockReturnValue('2026-08-23T00:00:00.000Z');
      const completed = join(
        backupsDir,
        'memory-backup-2.0-2026-08-23T00-00-00-000Z.db'
      );
      writeFileSync(completed, 'existing');

      try {
        await captureCreateFailure(fileDb, 'backup-collision');
        expect(readFileSync(completed, 'utf8')).toBe('existing');
        expect(backupDirectoryNames().filter(name => name.includes('partial'))).toEqual([]);
      } finally {
        isoSpy.mockRestore();
        fileDb.close();
      }
    });

    it('removes both link names when post-link partial unlink fails', async () => {
      const fileDb = openWalDatabase();
      const realUnlinkSync = fs.unlinkSync.bind(fs);
      let failedPartial = false;
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(((path) => {
        if (!failedPartial && partialNamePattern.test(basename(String(path)))) {
          failedPartial = true;
          const error = new Error('partial unlink denied') as NodeJS.ErrnoException;
          error.code = 'EACCES';
          throw error;
        }
        return realUnlinkSync(path);
      }) as typeof fs.unlinkSync);

      try {
        await captureCreateFailure(fileDb, 'backup-post-link-cleanup-failed');
        expectNoAttemptResidue();
      } finally {
        unlinkSpy.mockRestore();
        fileDb.close();
      }
    });

    it('reports cleanup residue by basename when a failed attempt cannot be fully removed', async () => {
      const fileDb = openWalDatabase();
      const backupSpy = vi.spyOn(fileDb, 'backup').mockImplementation((async destination => {
        writeFileSync(String(destination), 'partial');
        throw new Error('raw write path leak');
      }) as Database.Database['backup']);
      const realUnlinkSync = fs.unlinkSync.bind(fs);
      let residueName = '';
      const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(((path) => {
        if (partialNamePattern.test(basename(String(path)))) {
          residueName = basename(String(path));
          const error = new Error('partial cleanup denied') as NodeJS.ErrnoException;
          error.code = 'EACCES';
          throw error;
        }
        return realUnlinkSync(path);
      }) as typeof fs.unlinkSync);

      try {
        const error = await captureCreateFailure(fileDb, 'backup-write-failed');
        expect(error.message).toContain(residueName);
        expect(error.message).not.toContain(join(backupsDir, residueName));
        expect(backupDirectoryNames()).toEqual([residueName]);
      } finally {
        backupSpy.mockRestore();
        unlinkSpy.mockRestore();
        fileDb.close();
      }
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

    function backupDirectoryNames(): string[] {
      return fs.readdirSync(backupsDir).sort();
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

    it('preserves crash-leftover completed and partial names during routine cleanup', async () => {
      const completed = writeBackup('memory-backup-2.0-2026-08-23T00-00-00-000Z.db', 8);
      const partialName = '.memory-backup-partial-00000000-0000-4000-8000-000000000000.db';
      const partial = join(backupsDir, partialName);
      linkSync(completed, partial);

      const report = await backupManager.cleanupBackups({ mode: 'apply', includeInterrupted: false, now });

      expect(report).toMatchObject({
        ok: true,
        selectedCount: 0,
        deletedCount: 0,
        ignoredCount: 2,
        artifacts: [],
      });
      expect(basename(completed)).not.toBe(partialName);
      expect(backupDirectoryNames()).toEqual([
        partialName,
        'memory-backup-2.0-2026-08-23T00-00-00-000Z.db',
      ]);
      expect(JSON.stringify(report)).not.toContain(testRoot);
    });
  });
});

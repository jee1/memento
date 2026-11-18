import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const detectPendingMigrations = vi.fn();
  const runMigrations = vi.fn();
  const createBackup = vi.fn();

  return {
    createBackup,
    detectPendingMigrations,
    log: vi.fn(),
    runMigrations,
    BackupManager: vi.fn(function () {
      return {
        cleanupBackups: vi.fn(),
        createBackup,
      };
    }),
    MigrationDetector: vi.fn(function () {
      return {
        detectPendingMigrations,
      };
    }),
    MigrationRunner: vi.fn(function () {
      return {
        runMigrations,
      };
    }),
  };
});

vi.mock('./init-log.js', () => ({ log: mocks.log }));

vi.mock('./migration/migration-detector.js', () => ({
  MigrationDetector: mocks.MigrationDetector,
}));

vi.mock('./migration/migration-runner.js', () => ({
  MigrationRunner: mocks.MigrationRunner,
}));

vi.mock('./migration/backup-manager.js', () => ({
  BackupManager: mocks.BackupManager,
}));

import { DOCTOR_REPORT_HINT } from '../../../domains/telemetry/usage/usage-report.js';
import { migrateExistingDatabaseIfNeeded } from './init-migrate-existing.js';

describe('migrateExistingDatabaseIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectPendingMigrations.mockResolvedValue({
      appliedMigrations: [],
      currentVersion: null,
      pendingMigrations: [],
    });
  });

  it('skips the runner and backup boundary when startup has no pending migrations', async () => {
    const db = {} as Database.Database;

    for (let run = 0; run < 100; run += 1) {
      await migrateExistingDatabaseIfNeeded(db);
    }

    expect(mocks.detectPendingMigrations).toHaveBeenCalledTimes(100);
    expect(mocks.MigrationRunner).not.toHaveBeenCalled();
    expect(mocks.runMigrations).not.toHaveBeenCalled();
    expect(mocks.BackupManager).not.toHaveBeenCalled();
    expect(mocks.createBackup).not.toHaveBeenCalled();
  });

  it('마이그레이션이 실패하면 오류 메시지 끝에 doctor --report 안내가 붙는다 (#1769)', async () => {
    mocks.detectPendingMigrations.mockResolvedValue({
      appliedMigrations: [],
      currentVersion: null,
      pendingMigrations: [{ migration: { version: '70.0', name: 'broken' } }],
    });
    mocks.runMigrations.mockResolvedValue([{ success: false, name: 'broken', version: '70.0', error: 'boom' }]);

    const error = await migrateExistingDatabaseIfNeeded({} as Database.Database).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('broken (v70.0): boom');
    expect((error as Error).message.endsWith(DOCTOR_REPORT_HINT)).toBe(true);
    expect(DOCTOR_REPORT_HINT).toContain('memento doctor --report');
  });
});

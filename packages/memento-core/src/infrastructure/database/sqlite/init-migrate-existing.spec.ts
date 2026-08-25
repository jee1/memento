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
    BackupManager: vi.fn(() => ({
      cleanupBackups: vi.fn(),
      createBackup,
    })),
    MigrationDetector: vi.fn(() => ({
      detectPendingMigrations,
    })),
    MigrationRunner: vi.fn(() => ({
      runMigrations,
    })),
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
});

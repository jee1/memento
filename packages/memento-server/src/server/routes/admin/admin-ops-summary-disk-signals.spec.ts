import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readOpsDiskSignals } from './admin-ops-summary-disk-signals.js';

describe('readOpsDiskSignals (#1704)', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function setupDb(name = 'memory.db'): { dbPath: string; backupsDir: string } {
    root = mkdtempSync(join(tmpdir(), 'ops-disk-signals-'));
    const dbPath = join(root, name);
    writeFileSync(dbPath, Buffer.alloc(2 * 1024 * 1024)); // 2 MiB
    const backupsDir = join(root, 'backups');
    return { dbPath, backupsDir };
  }

  it('missing backups dir and missing wal → null backup fields and null wal', () => {
    const { dbPath } = setupDb();
    const signals = readOpsDiskSignals(dbPath);
    expect(signals.migration_backup_latest_at).toBeNull();
    expect(signals.migration_backup_file_count).toBeNull();
    expect(signals.db_size_mb).toBe(2);
    expect(signals.wal_size_mb).toBeNull();
  });

  it('empty backups dir → null backup fields (not error)', () => {
    const { dbPath, backupsDir } = setupDb();
    mkdirSync(backupsDir, { recursive: true });
    const signals = readOpsDiskSignals(dbPath);
    expect(signals.migration_backup_latest_at).toBeNull();
    expect(signals.migration_backup_file_count).toBeNull();
  });

  it('picks latest memory-backup-*.db mtime and counts files; ignores partial and non-db', () => {
    const { dbPath, backupsDir } = setupDb();
    mkdirSync(backupsDir, { recursive: true });
    const older = join(backupsDir, 'memory-backup-65.0-2026-01-01T00-00-00-000Z.db');
    const newer = join(backupsDir, 'memory-backup-66.0-2026-06-01T00-00-00-000Z.db');
    writeFileSync(older, 'old');
    writeFileSync(newer, 'new');
    writeFileSync(join(backupsDir, '.memory-backup-partial-deadbeef.db'), 'partial');
    writeFileSync(join(backupsDir, 'notes.txt'), 'nope');
    const olderMs = Date.parse('2026-01-01T00:00:00.000Z');
    const newerMs = Date.parse('2026-06-01T12:00:00.000Z');
    utimesSync(older, olderMs / 1000, olderMs / 1000);
    utimesSync(newer, newerMs / 1000, newerMs / 1000);

    const signals = readOpsDiskSignals(dbPath);
    expect(signals.migration_backup_file_count).toBe(2);
    expect(signals.migration_backup_latest_at).toBe(new Date(newerMs).toISOString());
  });

  it('reads wal size when present', () => {
    const { dbPath } = setupDb();
    writeFileSync(`${dbPath}-wal`, Buffer.alloc(512 * 1024)); // 0.5 MiB → 0.5 MB
    const signals = readOpsDiskSignals(dbPath);
    expect(signals.wal_size_mb).toBe(0.5);
  });

  it('missing db file → db_size_mb null without throw', () => {
    root = mkdtempSync(join(tmpdir(), 'ops-disk-signals-'));
    const dbPath = join(root, 'missing.db');
    const signals = readOpsDiskSignals(dbPath);
    expect(signals.db_size_mb).toBeNull();
    expect(signals.wal_size_mb).toBeNull();
    expect(signals.migration_backup_latest_at).toBeNull();
  });
});

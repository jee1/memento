/**
 * Read-only disk signals for ops summary zones (#1704).
 * Migration backups under dirname(dbPath)/backups; DB/WAL size via stat.
 * Missing paths or read failures → null values (never throw).
 */
/* eslint-disable security/detect-non-literal-fs-filename -- dbPath는 mementoConfig(또는 테스트 주입). HTTP 입력이 닿지 않는다. */

import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mementoConfig } from '@memento/core';

export interface OpsDiskSignals {
  /** Latest mtime of memory-backup-*.db as ISO, or null if none/unreadable. */
  migration_backup_latest_at: string | null;
  /** Count of memory-backup-*.db files, or null if dir missing/unreadable/empty. */
  migration_backup_file_count: number | null;
  /** memory.db size in MB (1 decimal), or null if missing/unreadable. */
  db_size_mb: number | null;
  /** memory.db-wal size in MB (1 decimal), or null if missing/unreadable. */
  wal_size_mb: number | null;
}

function bytesToMb(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(1));
}

function safeStatSizeMb(path: string): number | null {
  try {
    const st = statSync(path);
    if (!st.isFile()) return null;
    return bytesToMb(st.size);
  } catch {
    return null;
  }
}

function isMigrationBackupFileName(name: string): boolean {
  return name.startsWith('memory-backup-') && name.endsWith('.db');
}

function readMigrationBackupDir(backupsDir: string): {
  latestAt: string | null;
  fileCount: number | null;
} {
  let names: string[];
  try {
    names = readdirSync(backupsDir);
  } catch {
    return { latestAt: null, fileCount: null };
  }
  let latestMs = -1;
  let count = 0;
  for (const name of names) {
    if (!isMigrationBackupFileName(name)) continue;
    const path = join(backupsDir, name);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      count += 1;
      if (st.mtimeMs > latestMs) latestMs = st.mtimeMs;
    } catch {
      /* skip unreadable entry */
    }
  }
  if (count === 0) return { latestAt: null, fileCount: null };
  return { latestAt: new Date(latestMs).toISOString(), fileCount: count };
}

/**
 * Snapshot of migration-backup dir + DB/WAL sizes.
 * @param dbPath Override for tests; default mementoConfig.dbPath.
 */
export function readOpsDiskSignals(dbPath: string = mementoConfig.dbPath): OpsDiskSignals {
  const backupsDir = join(dirname(dbPath), 'backups');
  const backup = readMigrationBackupDir(backupsDir);
  return {
    migration_backup_latest_at: backup.latestAt,
    migration_backup_file_count: backup.fileCount,
    db_size_mb: safeStatSizeMb(dbPath),
    wal_size_mb: safeStatSizeMb(`${dbPath}-wal`),
  };
}

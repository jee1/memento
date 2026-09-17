#!/usr/bin/env node
import { openDb, resolveBackupDir, resolveDbPath } from './lib/cli-runtime.js';
import { BackupManager } from '@memento/core';
/**
 * Create a consistent SQLite backup using the online backup API (not cp/copyFileSync).
 *
 * Usage:
 *   DB_PATH=~/.memento/data/memory.db node scripts/backup-memory-db.mjs
 *   npm run db:backup
 */
import path from 'path';

process.env.MEMENTO_CLI_QUIET ??= '1';

function fail(stage, reason, hint, details = {}) {
  process.stderr.write(`${JSON.stringify({ ok: false, stage, reason, hint, ...details })}\n`);
  process.exit(1);
}

function failUsage() {
  fail(
    'usage',
    'invalid-arguments',
    'Usage: node scripts/backup-memory-db.mjs [--cleanup [--apply]]'
  );
}

function safeBackupFailure(error) {
  if (!(error instanceof Error)) {
    return { reason: 'backup-failed' };
  }

  const reason = error.message.split(/\s+/)[0] || 'backup-failed';
  const residueText = error.message.match(/\bresidue=([^\s]+)/)?.[1];
  const residue = residueText
    ?.split(',')
    .filter(name => name && path.basename(name) === name);

  return residue && residue.length > 0 ? { reason, residue } : { reason };
}

function countMemoryItems(backupPath) {
  const verify = openDb(backupPath, { readonly: true });
  try {
    return verify.prepare('SELECT count(*) AS c FROM memory_item').get().c;
  } catch {
    return null;
  } finally {
    verify.close();
  }
}

const args = process.argv.slice(2);
const cleanup = args[0] === '--cleanup';
const apply = cleanup && args[1] === '--apply' && args.length === 2;
const valid = args.length === 0 || (cleanup && (args.length === 1 || apply));

if (!valid) {
  failUsage();
}

const HINTS = {
  'backup-permission-denied':
    'Backup directory is not writable by this user. It is owned by the container user (uid 1001); '
    + 'set MEMENTO_BACKUP_DIR to a directory you own. Stopping the server will not help.',
  'source-dir-unwritable':
    'The database directory is owned by the container user (uid 1001), so this user cannot create '
    + 'the WAL sidecar files SQLite needs. Run the backup inside the container: '
    + 'npm run db:backup:docker. Stopping the server will not help.',
  'backup-collision':
    'A backup with the same name already exists; retry in a second.',
};
const DEFAULT_HINT = 'Stop the MCP server (docker compose stop) and retry if the DB is locked.';

const dbPath = resolveDbPath();
let manager;
try {
  manager = new BackupManager(resolveBackupDir());
} catch {
  fail(
    'resolve-backup-dir',
    'backup-dir-unavailable',
    'Cannot create the backup directory. Check MEMENTO_BACKUP_DIR and its parent permissions.'
  );
}

if (cleanup) {
  const report = await manager.cleanupBackups({
    mode: apply ? 'apply' : 'preview',
    includeInterrupted: true,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}

let source;
try {
  source = openDb(dbPath, { readonly: true, fileMustExist: true });
} catch {
  fail(
    'resolve-db',
    'db-not-found',
    'Set DB_PATH to an existing SQLite database file and retry.'
  );
}
source.pragma('busy_timeout = 10000');

let backup;
try {
  backup = await manager.createBackup(source);
} catch (error) {
  const failure = safeBackupFailure(error);
  fail(
    'create-backup',
    failure.reason,
    HINTS[failure.reason] ?? DEFAULT_HINT,
    'residue' in failure ? { residue: failure.residue } : {}
  );
} finally {
  source.close();
}

const result = {
  ok: true,
  dbPath,
  backupPath: backup.backupPath,
  quick_check: backup.integrityCheck,
  integrity_check: backup.integrityCheck,
  memory_item: countMemoryItems(backup.backupPath),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

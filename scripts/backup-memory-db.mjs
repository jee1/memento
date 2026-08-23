#!/usr/bin/env node
import { openDb } from './lib/cli.ts';
import { BackupManager } from '@memento/core';
/**
 * Create a consistent SQLite backup using the online backup API (not cp/copyFileSync).
 *
 * Usage:
 *   DB_PATH=~/.memento/data/memory.db node scripts/backup-memory-db.mjs
 *   npm run db:backup
 */
import os from 'os';
import path from 'path';

process.env.MEMENTO_CLI_QUIET ??= '1';

function resolveDbPath() {
  if (process.env.DB_PATH) {
    return path.resolve(process.env.DB_PATH);
  }
  return path.join(os.homedir(), '.memento', 'data', 'memory.db');
}

function fail(stage, reason, hint, details = {}) {
  process.stderr.write(`${JSON.stringify({ ok: false, stage, reason, hint, ...details })}\n`);
  process.exit(1);
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

const dbPath = resolveDbPath();
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
  const manager = new BackupManager(path.join(path.dirname(dbPath), 'backups'));
  backup = await manager.createBackup(source);
} catch (error) {
  const failure = safeBackupFailure(error);
  fail(
    'create-backup',
    failure.reason,
    'Stop the MCP server (docker compose stop) and retry if the DB is locked.',
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

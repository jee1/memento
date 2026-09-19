#!/usr/bin/env node
import { parseArgs as parseCliArgs } from './lib/cli-runtime.js';
/**
 * Safe guard before `docker compose up` / image rebuild:
 * 1) online backup via sqlite backup API
 * 2) integrity_check on the backup copy (abort when corrupt unless --force)
 *
 * Usage:
 *   node scripts/pre-docker-deploy.mjs
 *   node scripts/pre-docker-deploy.mjs --force
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const force = parseCliArgs().args.includes('--force');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backupScript = path.join(root, 'scripts', 'backup-memory-db.mjs');
const dockerBackupScript = path.join(root, 'scripts', 'backup-in-docker.sh');

function parseBackupFailureReason(stderr) {
  const lines = stderr.trim().split('\n').filter(line => line.trim());
  if (lines.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(lines[lines.length - 1]);
    return typeof parsed.reason === 'string' ? parsed.reason : null;
  } catch {
    return null;
  }
}

function summarize(stdout, containerPath = false) {
  try {
    const { dbPath, memory_item: rows, integrity_check: integrity } = JSON.parse(stdout);
    const pathLabel = containerPath ? `${dbPath} (container path)` : dbPath;
    return `[pre-docker-deploy] target=${pathLabel}  memory_item=${rows}  integrity_check=${integrity}`;
  } catch {
    return null;
  }
}

function finishSuccess(stdout, containerPath = false) {
  const summary = summarize(stdout, containerPath);
  if (summary) {
    console.log(summary);
  }
  console.log('[pre-docker-deploy] Backup OK; safe to restart Docker.');
  process.exit(0);
}

function finishFailure(status) {
  if (force) {
    console.warn('[pre-docker-deploy] backup/integrity_check failed; continuing because --force was set');
    process.exit(0);
  }
  console.error(
    '[pre-docker-deploy] Aborting: fix DB or pass --force only if you accept the risk.'
  );
  process.exit(status ?? 1);
}

function writeChildOutput(child) {
  if (child.stdout) {
    process.stdout.write(child.stdout);
  }
  if (child.stderr) {
    process.stderr.write(child.stderr);
  }
}

const backup = spawnSync(process.execPath, [backupScript], {
  cwd: root,
  encoding: 'utf8',
  env: process.env,
});

writeChildOutput(backup);

if (backup.status === 0) {
  finishSuccess(backup.stdout);
}

const failureReason = parseBackupFailureReason(backup.stderr ?? '');
if (failureReason === 'source-dir-unwritable') {
  console.log(
    '[pre-docker-deploy] host backup blocked (source-dir-unwritable); retrying inside the container'
  );
  const fallback = spawnSync('sh', [dockerBackupScript], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
  writeChildOutput(fallback);
  if (fallback.status === 0) {
    finishSuccess(fallback.stdout, true);
  }
  finishFailure(fallback.status);
}

finishFailure(backup.status);

#!/usr/bin/env node
import { parseArgs as parseCliArgs, resolveDbPath } from './lib/cli-runtime.js';
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
import { accessSync, constants, existsSync } from 'node:fs';
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

function writable(file) {
  try {
    accessSync(file, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// WAL 읽기에는 -shm 을 쓸 수 있어야 한다. 디렉터리도 -shm 도 못 쓰면 호스트 백업은 반드시
// source-dir-unwritable 로 끝나므로 시도하지 않는다. 운영(uid 1001 소유)에서는 매번 이 경우이고,
// 실패하는 호스트 시도가 정지 구간에 1.1~1.6초를 더했다 (#1798).
// DB 파일이 없으면 여기서 고르지 않는다. 호스트 시도가 db-not-found 로 끝나야 잘못된 DB_PATH 가 드러난다.
// 컨테이너 백업은 DB_PATH 가 아니라 컨테이너 안의 고정 경로를 백업하기 때문이다.
function hostCannotOpenSource() {
  const dbPath = resolveDbPath();
  return existsSync(dbPath) && !writable(path.dirname(dbPath)) && !writable(`${dbPath}-shm`);
}

function backupInContainer(message) {
  console.log(`[pre-docker-deploy] ${message}; backing up inside the container`);
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

if (hostCannotOpenSource()) {
  backupInContainer('DB directory is not writable by this user (source-dir-unwritable)');
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

if (parseBackupFailureReason(backup.stderr ?? '') === 'source-dir-unwritable') {
  backupInContainer('host backup blocked (source-dir-unwritable)');
}

finishFailure(backup.status);

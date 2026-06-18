#!/usr/bin/env node
/**
 * Create a consistent SQLite backup using the online backup API (not cp/copyFileSync).
 *
 * Usage:
 *   DB_PATH=~/.memento/data/memory.db node scripts/backup-memory-db.mjs
 *   npm run db:backup
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

function resolveDbPath() {
  if (process.env.DB_PATH) {
    return path.resolve(process.env.DB_PATH);
  }
  return path.join(os.homedir(), '.memento', 'data', 'memory.db');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const dbPath = resolveDbPath();
if (!fs.existsSync(dbPath)) {
  console.error(JSON.stringify({ ok: false, error: `DB not found: ${dbPath}` }));
  process.exit(1);
}

const backupDir = path.join(path.dirname(dbPath), 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const backupPath = path.join(backupDir, `memory-backup-${timestamp()}.db`);

if (fs.existsSync(backupPath)) {
  fs.unlinkSync(backupPath);
}

const source = new Database(dbPath, { readonly: true, fileMustExist: true });
source.pragma('busy_timeout = 10000');

try {
  await source.backup(backupPath);
} catch (error) {
  source.close();
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      hint: 'Stop the MCP server (docker compose stop) and retry if the DB is locked.',
    })
  );
  process.exit(1);
} finally {
  source.close();
}

for (const suffix of ['-wal', '-shm']) {
  const sidecar = backupPath + suffix;
  if (fs.existsSync(sidecar)) {
    fs.unlinkSync(sidecar);
  }
}

const backupStat = fs.statSync(backupPath);
if (backupStat.size === 0) {
  fs.unlinkSync(backupPath);
  console.error(JSON.stringify({ ok: false, error: 'Backup file is empty', dbPath, backupPath }));
  process.exit(1);
}

const verify = new Database(backupPath, { readonly: true });
const quickCheck = verify.pragma('quick_check', { simple: true });
let memoryItemCount = null;
try {
  memoryItemCount = verify.prepare('SELECT count(*) AS c FROM memory_item').get().c;
} catch {
  // schema without memory_item (test DB)
}
verify.close();

const result = {
  ok: quickCheck === 'ok',
  dbPath,
  backupPath,
  quick_check: quickCheck,
  memory_item: memoryItemCount,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
  process.exit(1);
}

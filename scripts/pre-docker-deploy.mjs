#!/usr/bin/env node
import { parseArgs as parseCliArgs } from './lib/cli.ts';
/**
 * Safe guard before `docker compose up` / image rebuild:
 * 1) online backup via sqlite backup API
 * 2) quick_check on live DB (abort when corrupt unless --force)
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

const backup = spawnSync(process.execPath, [backupScript], {
  cwd: root,
  encoding: 'utf8',
  env: process.env,
});

if (backup.stdout) {
  process.stdout.write(backup.stdout);
}
if (backup.stderr) {
  process.stderr.write(backup.stderr);
}

if (backup.status !== 0) {
  if (force) {
    console.warn('[pre-docker-deploy] backup/quick_check failed; continuing because --force was set');
    process.exit(0);
  }
  console.error(
    '[pre-docker-deploy] Aborting: fix DB or pass --force only if you accept the risk.'
  );
  process.exit(backup.status ?? 1);
}

console.log('[pre-docker-deploy] Backup OK; safe to restart Docker.');

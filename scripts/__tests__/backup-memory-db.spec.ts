import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = resolve('scripts/backup-memory-db.mjs');
const frozenTimestamp = '2026-08-23T01:02:03.456Z';
const frozenBackupName = 'memory-backup-2026-08-23T01-02-03-456Z.db';

let testRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'memento-backup-cli-'));
  testRoots.push(root);
  return root;
}

function createDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT NOT NULL);
    INSERT INTO memory_item (id, content) VALUES ('mem-1', 'remember this');
  `);
  db.close();
}

function runBackup(dbPath: string, extraNodeArgs: string[] = []) {
  return spawnSync(process.execPath, [...extraNodeArgs, scriptPath], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', DB_PATH: dbPath },
    encoding: 'utf8',
  });
}

function runBackupScript(dbPath: string, scriptArgs: string[], extraNodeArgs: string[] = []) {
  return spawnSync(process.execPath, [...extraNodeArgs, scriptPath, ...scriptArgs], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', DB_PATH: dbPath },
    encoding: 'utf8',
  });
}

function parseJson(text: string): Record<string, unknown> {
  return JSON.parse(text);
}

function writeBackupArtifact(backupsDir: string, name: string, content: string): void {
  writeFileSync(join(backupsDir, name), content);
}

function backupDirNames(backupsDir: string): string[] {
  return readdirSync(backupsDir).sort();
}

function inodeSnapshot(backupsDir: string): Record<string, { ino: number | bigint; size: number; mtimeMs: number }> {
  return Object.fromEntries(backupDirNames(backupsDir).map(name => {
    const stats = lstatSync(join(backupsDir, name));
    return [name, { ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs }];
  }));
}

function expectCleanupKeys(output: Record<string, unknown>): void {
  expect(Object.keys(output)).toEqual([
    'ok',
    'error',
    'mode',
    'inspectedCount',
    'selectedCount',
    'selectedBytes',
    'deletedCount',
    'reclaimedBytes',
    'skippedCount',
    'failedCount',
    'ignoredCount',
    'artifacts',
  ]);
}

afterEach(() => {
  for (const root of testRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  testRoots = [];
});

describe('backup-memory-db operator script', () => {
  it('creates one validated standalone operator backup with compatible success keys', () => {
    const root = makeTempRoot();
    const dbPath = join(root, 'memory.db');
    const backupsDir = join(root, 'backups');
    createDb(dbPath);

    const result = runBackup(dbPath);

    expect(result.status).toBe(0);
    const output = parseJson(result.stdout);
    expect(output).toMatchObject({
      ok: true,
      dbPath,
      quick_check: 'ok',
      integrity_check: 'ok',
      memory_item: 1,
    });
    expect(typeof output.backupPath).toBe('string');
    expect(basename(output.backupPath as string)).toMatch(/^memory-backup-\d{4}-/);
    expect(readdirSync(backupsDir).filter(name => /-wal$|-shm$|partial/.test(name))).toEqual([]);
    expect(readdirSync(backupsDir).filter(name => name.endsWith('.db'))).toHaveLength(1);
  });

  it('returns safe JSON when the requested database is missing', () => {
    const root = makeTempRoot();
    const dbPath = join(root, 'missing.db');

    const result = runBackup(dbPath);

    expect(result.status).toBe(1);
    const output = parseJson(result.stderr);
    expect(output).toMatchObject({
      ok: false,
      stage: 'resolve-db',
      reason: 'db-not-found',
    });
    expect(typeof output.hint).toBe('string');
    expect(output).not.toHaveProperty('dbPath');
    expect(output).not.toHaveProperty('backupPath');
    expect(JSON.stringify(output)).not.toContain(dbPath);
  });

  it('refuses a completed-name collision without deleting the existing backup', () => {
    const root = makeTempRoot();
    const dbPath = join(root, 'memory.db');
    const backupsDir = join(root, 'backups');
    const existingBackup = join(backupsDir, frozenBackupName);
    const freezeDatePath = join(root, 'freeze-date.mjs');
    createDb(dbPath);
    mkdirSync(backupsDir);
    writeFileSync(existingBackup, 'existing backup');
    writeFileSync(freezeDatePath, `
const RealDate = Date;
function FrozenDate(...args) {
  return new RealDate(...(args.length === 0 ? ['${frozenTimestamp}'] : args));
}
FrozenDate.now = () => new RealDate('${frozenTimestamp}').getTime();
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
FrozenDate.prototype = RealDate.prototype;
globalThis.Date = FrozenDate;
`);

    const result = runBackup(dbPath, ['--import', pathToFileURL(freezeDatePath).href]);

    expect(result.status).toBe(1);
    const output = parseJson(result.stderr);
    expect(output).toMatchObject({
      ok: false,
      stage: 'create-backup',
      reason: 'backup-collision',
    });
    expect(output).not.toHaveProperty('dbPath');
    expect(output).not.toHaveProperty('backupPath');
    expect(JSON.stringify(output)).not.toContain(root);
    expect(readFileSync(existingBackup, 'utf8')).toBe('existing backup');
    expect(readdirSync(backupsDir).filter(name => /-wal$|-shm$|partial/.test(name))).toEqual([]);
  });

  it('reports safe cleanup residue basenames when failed backup cleanup leaves a partial', () => {
    const root = makeTempRoot();
    const dbPath = join(root, 'memory.db');
    const injectResiduePath = join(root, 'inject-residue.mjs');
    createDb(dbPath);
    writeFileSync(injectResiduePath, `
import { createRequire } from 'node:module';

const require = createRequire(process.cwd() + '/package.json');
const Database = require('better-sqlite3');
const fs = require('node:fs');

Database.prototype.backup = async function(target) {
  fs.writeFileSync(target, 'partial backup residue');
  throw new Error('injected backup failure');
};

const realUnlinkSync = fs.unlinkSync;
fs.unlinkSync = function(target) {
  if (String(target).includes('.memory-backup-partial-') && String(target).endsWith('.db')) {
    const error = new Error('injected unlink failure');
    error.code = 'EACCES';
    throw error;
  }
  return realUnlinkSync.apply(this, arguments);
};
`);

    const result = runBackup(dbPath, ['--import', pathToFileURL(injectResiduePath).href]);

    expect(result.status).toBe(1);
    const output = parseJson(result.stderr);
    expect(output).toMatchObject({
      ok: false,
      stage: 'create-backup',
      reason: 'backup-write-failed',
    });
    expect(output.residue).toEqual([
      expect.stringMatching(/^\.memory-backup-partial-[0-9a-f-]+\.db$/),
    ]);
    expect(JSON.stringify(output)).not.toContain(root);
    expect(JSON.stringify(output)).not.toContain(dbPath);
  });

  it('previews cleanup without changing backup artifacts', () => {
    const root = makeTempRoot();
    const dbPath = join(root, 'memory.db');
    const backupsDir = join(root, 'backups');
    const expired = 'memory-backup-2.0-2000-01-01T00-00-00-000Z.db';
    const retained = 'memory-backup-2.0-2099-01-01T00-00-00-000Z.db';
    const operator = 'memory-backup-2000-01-01T00-00-00-000Z.db';
    const partial = '.memory-backup-partial-00000000-0000-4000-8000-000000000000.db';
    const partialWal = `${partial}-wal`;
    createDb(dbPath);
    mkdirSync(backupsDir);
    writeBackupArtifact(backupsDir, expired, 'expired');
    writeBackupArtifact(backupsDir, retained, 'keep');
    writeBackupArtifact(backupsDir, operator, 'operator');
    writeBackupArtifact(backupsDir, partial, 'bad');
    writeBackupArtifact(backupsDir, partialWal, 'side');
    const before = inodeSnapshot(backupsDir);

    const preview = runBackupScript(dbPath, ['--cleanup']);

    expect(preview.status).toBe(0);
    expect(preview.stderr).toBe('');
    const output = parseJson(preview.stdout);
    expectCleanupKeys(output);
    expect(output).toEqual({
      ok: true,
      error: null,
      mode: 'preview',
      inspectedCount: 5,
      selectedCount: 3,
      selectedBytes: 14,
      deletedCount: 0,
      reclaimedBytes: 0,
      skippedCount: 0,
      failedCount: 0,
      ignoredCount: 2,
      artifacts: [
        { id: partial, status: 'selected', reason: 'interrupted-attempt', detail: null },
        { id: partialWal, status: 'selected', reason: 'orphaned-sidecar', detail: null },
        { id: expired, status: 'selected', reason: 'expired-automatic', detail: null },
      ],
    });
    expect(inodeSnapshot(backupsDir)).toEqual(before);
    expect(JSON.stringify(output)).not.toContain(root);
    expect(JSON.stringify(output)).not.toContain(dbPath);
  });

  it('applies cleanup only for exact --cleanup --apply intent', () => {
    const root = makeTempRoot();
    const dbPath = join(root, 'memory.db');
    const backupsDir = join(root, 'backups');
    const expired = 'memory-backup-2.0-2000-01-01T00-00-00-000Z.db';
    const retained = 'memory-backup-2.0-2099-01-01T00-00-00-000Z.db';
    const operator = 'memory-backup-2000-01-01T00-00-00-000Z.db';
    const partial = '.memory-backup-partial-00000000-0000-4000-8000-000000000000.db';
    const partialWal = `${partial}-wal`;
    createDb(dbPath);
    mkdirSync(backupsDir);
    writeBackupArtifact(backupsDir, expired, 'expired');
    writeBackupArtifact(backupsDir, retained, 'keep');
    writeBackupArtifact(backupsDir, operator, 'operator');
    writeBackupArtifact(backupsDir, partial, 'bad');
    writeBackupArtifact(backupsDir, partialWal, 'side');

    const apply = runBackupScript(dbPath, ['--cleanup', '--apply']);

    expect(apply.status).toBe(0);
    expect(apply.stderr).toBe('');
    const output = parseJson(apply.stdout);
    expectCleanupKeys(output);
    expect(output).toEqual({
      ok: true,
      error: null,
      mode: 'apply',
      inspectedCount: 5,
      selectedCount: 3,
      selectedBytes: 14,
      deletedCount: 3,
      reclaimedBytes: 14,
      skippedCount: 0,
      failedCount: 0,
      ignoredCount: 2,
      artifacts: [
        { id: partial, status: 'deleted', reason: 'interrupted-attempt', detail: null },
        { id: partialWal, status: 'deleted', reason: 'orphaned-sidecar', detail: null },
        { id: expired, status: 'deleted', reason: 'expired-automatic', detail: null },
      ],
    });
    expect(backupDirNames(backupsDir)).toEqual([retained, operator].sort());
    expect(JSON.stringify(output)).not.toContain(root);
    expect(JSON.stringify(output)).not.toContain(dbPath);
  });

  it('rejects cleanup usage errors before database access or deletion', () => {
    const root = makeTempRoot();
    const dbPath = join(root, 'missing.db');
    const backupsDir = join(root, 'backups');
    const expired = 'memory-backup-2.0-2000-01-01T00-00-00-000Z.db';
    mkdirSync(backupsDir);
    writeBackupArtifact(backupsDir, expired, 'expired');
    const beforeUsageError = backupDirNames(backupsDir);

    for (const args of [
      ['--apply'],
      ['--unknown'],
      ['--cleanup', '--unknown'],
      ['--cleanup', '--apply', '--extra'],
    ]) {
      const usageError = runBackupScript(dbPath, args);

      expect(usageError.status).toBe(1);
      expect(usageError.stdout).toBe('');
      expect(parseJson(usageError.stderr)).toEqual({
        ok: false,
        stage: 'usage',
        reason: 'invalid-arguments',
        hint: 'Usage: node scripts/backup-memory-db.mjs [--cleanup [--apply]]',
      });
      expect(backupDirNames(backupsDir)).toEqual(beforeUsageError);
    }
  });

  it('exits 1 with a pathless scan failure when backups cannot be listed', () => {
    const root = makeTempRoot();
    const dbPath = join(root, 'memory.db');
    const backupsPath = join(root, 'backups');
    writeFileSync(backupsPath, 'not a directory');

    const result = runBackupScript(dbPath, ['--cleanup']);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    const output = parseJson(result.stdout);
    expectCleanupKeys(output);
    expect(output).toEqual({
      ok: false,
      error: 'scan-failed',
      mode: 'preview',
      inspectedCount: 0,
      selectedCount: 0,
      selectedBytes: 0,
      deletedCount: 0,
      reclaimedBytes: 0,
      skippedCount: 0,
      failedCount: 0,
      ignoredCount: 0,
      artifacts: [],
    });
    expect(JSON.stringify(output)).not.toContain(root);
    expect(JSON.stringify(output)).not.toContain(dbPath);
  });

  it('exits 1 when apply skips or fails selected artifacts', () => {
    const root = makeTempRoot();
    const dbPath = join(root, 'memory.db');
    const backupsDir = join(root, 'backups');
    const skipName = 'memory-backup-2.0-2000-01-01T00-00-00-000Z.db';
    const failName = 'memory-backup-2.0-2000-01-02T00-00-00-000Z.db';
    const skipPath = join(backupsDir, skipName);
    const failPath = join(backupsDir, failName);
    const injectApplyFailurePath = join(root, 'inject-apply-failure.mjs');
    createDb(dbPath);
    mkdirSync(backupsDir);
    writeBackupArtifact(backupsDir, skipName, 'skip');
    writeBackupArtifact(backupsDir, failName, 'failed');
    writeFileSync(injectApplyFailurePath, `
import { createRequire } from 'node:module';

const require = createRequire(process.cwd() + '/package.json');
const fs = require('node:fs');
const realLstatSync = fs.lstatSync;
const realUnlinkSync = fs.unlinkSync;
const skipPath = ${JSON.stringify(skipPath)};
const failPath = ${JSON.stringify(failPath)};
const lstatCalls = new Map();

fs.lstatSync = function(target) {
  const key = String(target);
  const count = (lstatCalls.get(key) ?? 0) + 1;
  lstatCalls.set(key, count);
  if (key === skipPath && count === 2) {
    fs.writeFileSync(skipPath, 'changed');
  }
  return realLstatSync.apply(this, arguments);
};

fs.unlinkSync = function(target) {
  if (String(target) === failPath) {
    const error = new Error('injected unlink failure');
    error.code = 'EACCES';
    throw error;
  }
  return realUnlinkSync.apply(this, arguments);
};
`);

    const result = runBackupScript(
      dbPath,
      ['--cleanup', '--apply'],
      ['--import', pathToFileURL(injectApplyFailurePath).href]
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    const output = parseJson(result.stdout);
    expectCleanupKeys(output);
    expect(output).toEqual({
      ok: false,
      error: null,
      mode: 'apply',
      inspectedCount: 2,
      selectedCount: 2,
      selectedBytes: 10,
      deletedCount: 0,
      reclaimedBytes: 0,
      skippedCount: 1,
      failedCount: 1,
      ignoredCount: 0,
      artifacts: [
        { id: skipName, status: 'skipped', reason: 'expired-automatic', detail: 'changed-before-delete' },
        { id: failName, status: 'failed', reason: 'expired-automatic', detail: 'delete-failed' },
      ],
    });
    expect(existsSync(skipPath)).toBe(true);
    expect(existsSync(failPath)).toBe(true);
    expect(JSON.stringify(output)).not.toContain(root);
    expect(JSON.stringify(output)).not.toContain(dbPath);
  });
});

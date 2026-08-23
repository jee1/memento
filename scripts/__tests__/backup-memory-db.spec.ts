import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = 'scripts/backup-memory-db.mjs';
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
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8',
  });
}

function parseJson(text: string): Record<string, unknown> {
  return JSON.parse(text);
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
});

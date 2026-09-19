import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = resolve('scripts/pre-docker-deploy.mjs');
const repoRoot = process.cwd();

let testRoots: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'memento-pre-docker-deploy-'));
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

function createWalDbWithoutSidecars(dataDir: string): string {
  const dbPath = join(dataDir, 'memory.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT NOT NULL);
    INSERT INTO memory_item (id, content) VALUES ('mem-1', 'remember this');
  `);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  return dbPath;
}

function setupFakeDocker(
  binDir: string,
  options: { markerPath?: string; mode: 'success' | 'fail' }
): string {
  const dockerPath = join(binDir, 'docker');
  const markerLine = options.markerPath
    ? `echo called > "${options.markerPath}"`
    : '';
  const successLine = options.mode === 'success'
    ? `printf '%s\\n' '{"ok":true,"dbPath":"/fake/memory.db","backupPath":"/fake/backup.db","integrity_check":"ok","memory_item":1}'`
    : '';
  const exitCode = options.mode === 'success' ? 0 : 1;
  writeFileSync(
    dockerPath,
    `#!/bin/sh
${markerLine}
${successLine}
exit ${exitCode}
`,
    { mode: 0o755 }
  );
  return `${binDir}:${process.env.PATH ?? ''}`;
}

function runPreDockerDeploy(
  envOverrides: Record<string, string> = {},
  args: string[] = []
) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: 'test', ...envOverrides },
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const root of testRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  testRoots = [];
});

describe('pre-docker-deploy operator script', () => {
  it('does not fall back to docker when host backup succeeds (#1001)', () => {
    const root = makeTempRoot();
    const dbPath = join(root, 'memory.db');
    const backupsDir = join(root, 'backups');
    const markerPath = join(root, 'docker-called');
    const binDir = join(root, 'bin');
    mkdirSync(binDir);
    createDb(dbPath);

    const result = runPreDockerDeploy({
      DB_PATH: dbPath,
      MEMENTO_BACKUP_DIR: backupsDir,
      PATH: setupFakeDocker(binDir, { markerPath, mode: 'success' }),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[pre-docker-deploy] Backup OK; safe to restart Docker.');
    expect(result.stdout).not.toContain('(container path)');
    expect(existsSync(markerPath)).toBe(false);
  });

  it('retries inside the container when host backup is source-dir-unwritable (#1001)', () => {
    const root = makeTempRoot();
    const dataDir = join(root, 'data');
    const backupsDir = join(root, 'backups');
    const binDir = join(root, 'bin');
    mkdirSync(dataDir);
    mkdirSync(backupsDir);
    mkdirSync(binDir);
    const dbPath = createWalDbWithoutSidecars(dataDir);
    chmodSync(dataDir, 0o500);

    try {
      const result = runPreDockerDeploy({
        DB_PATH: dbPath,
        MEMENTO_BACKUP_DIR: backupsDir,
        PATH: setupFakeDocker(binDir, { mode: 'success' }),
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        '[pre-docker-deploy] host backup blocked (source-dir-unwritable); retrying inside the container'
      );
      expect(result.stdout).toContain('target=/fake/memory.db (container path)');
      expect(result.stdout).toContain('[pre-docker-deploy] Backup OK; safe to restart Docker.');
    } finally {
      chmodSync(dataDir, 0o700);
    }
  });

  it('does not fall back when host backup fails for another reason (#1001)', () => {
    const root = makeTempRoot();
    const dbPath = join(root, 'missing.db');
    const backupsDir = join(root, 'backups');
    const markerPath = join(root, 'docker-called');
    const binDir = join(root, 'bin');
    mkdirSync(backupsDir);
    mkdirSync(binDir);

    const result = runPreDockerDeploy({
      DB_PATH: dbPath,
      MEMENTO_BACKUP_DIR: backupsDir,
      PATH: setupFakeDocker(binDir, { markerPath, mode: 'success' }),
    });

    expect(result.status).toBe(1);
    expect(existsSync(markerPath)).toBe(false);
  });

  it('exits 1 when the container fallback also fails (#1001)', () => {
    const root = makeTempRoot();
    const dataDir = join(root, 'data');
    const backupsDir = join(root, 'backups');
    const binDir = join(root, 'bin');
    mkdirSync(dataDir);
    mkdirSync(backupsDir);
    mkdirSync(binDir);
    const dbPath = createWalDbWithoutSidecars(dataDir);
    chmodSync(dataDir, 0o500);

    try {
      const result = runPreDockerDeploy({
        DB_PATH: dbPath,
        MEMENTO_BACKUP_DIR: backupsDir,
        PATH: setupFakeDocker(binDir, { mode: 'fail' }),
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        '[pre-docker-deploy] host backup blocked (source-dir-unwritable); retrying inside the container'
      );
    } finally {
      chmodSync(dataDir, 0o700);
    }
  });

  it('continues with --force when the container fallback fails (#1001)', () => {
    const root = makeTempRoot();
    const dataDir = join(root, 'data');
    const backupsDir = join(root, 'backups');
    const binDir = join(root, 'bin');
    mkdirSync(dataDir);
    mkdirSync(backupsDir);
    mkdirSync(binDir);
    const dbPath = createWalDbWithoutSidecars(dataDir);
    chmodSync(dataDir, 0o500);

    try {
      const result = runPreDockerDeploy(
        {
          DB_PATH: dbPath,
          MEMENTO_BACKUP_DIR: backupsDir,
          PATH: setupFakeDocker(binDir, { mode: 'fail' }),
        },
        ['--force']
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(
        '[pre-docker-deploy] backup/integrity_check failed; continuing because --force was set'
      );
    } finally {
      chmodSync(dataDir, 0o700);
    }
  });
});

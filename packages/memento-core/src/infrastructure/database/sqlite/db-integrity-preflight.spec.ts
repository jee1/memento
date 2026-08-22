import Database from 'better-sqlite3';
import { closeSync, existsSync, ftruncateSync, mkdtempSync, openSync, readdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { runDatabaseIntegrityPreflight } from './db-integrity-preflight.js';

function createDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dbPath: join(dir, 'memory.db') };
}

describe('runDatabaseIntegrityPreflight', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('passes without creating quarantine for a healthy database file', () => {
    const { dir, dbPath } = createDbPath('memento-preflight-ok-');
    cleanupDirs.push(dir);

    const db = new Database(dbPath);
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)');
    db.exec("INSERT INTO sample(value) VALUES ('ok')");
    db.close();

    const quarantinePath = join(dir, 'quarantine', 'memory-corrupt-2026-04-22T00-00-00-000Z.db');
    expect(() => runDatabaseIntegrityPreflight(dbPath, new Date('2026-04-22T00:00:00.000Z'))).not.toThrow();
    expect(existsSync(quarantinePath)).toBe(false);
  });

  it('quarantines and aborts startup for a corrupted database file', () => {
    const { dir, dbPath } = createDbPath('memento-preflight-bad-');
    cleanupDirs.push(dir);

    const db = new Database(dbPath);
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)');
    db.exec("INSERT INTO sample(value) VALUES ('broken')");
    db.close();

    const raw = new Database(dbPath);
    raw.pragma('wal_checkpoint(TRUNCATE)');
    raw.close();

    const size = statSync(dbPath).size;
    const fd = openSync(dbPath, 'r+');
    ftruncateSync(fd, Math.max(100, Math.floor(size / 2)));
    closeSync(fd);

    const now = new Date('2026-04-22T01:02:03.456Z');
    expect(() => runDatabaseIntegrityPreflight(dbPath, now)).toThrow(/데이터베이스 무결성 사전 검사 실패/);

    const quarantinePath = join(dir, 'quarantine', 'memory-corrupt-2026-04-22T01-02-03-456Z.db');
    expect(existsSync(quarantinePath)).toBe(true);
    expect(statSync(quarantinePath).size).toBeGreaterThan(0);
  });

  it('reuses a recent quarantine snapshot instead of copying again during crash loops', () => {
    const { dir, dbPath } = createDbPath('memento-preflight-dedup-');
    cleanupDirs.push(dir);

    const db = new Database(dbPath);
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)');
    db.exec("INSERT INTO sample(value) VALUES ('broken')");
    db.close();

    const raw = new Database(dbPath);
    raw.pragma('wal_checkpoint(TRUNCATE)');
    raw.close();

    const size = statSync(dbPath).size;
    const fd = openSync(dbPath, 'r+');
    ftruncateSync(fd, Math.max(100, Math.floor(size / 2)));
    closeSync(fd);

    const firstAt = new Date('2026-04-22T01:02:03.456Z');
    expect(() => runDatabaseIntegrityPreflight(dbPath, firstAt)).toThrow(/데이터베이스 무결성 사전 검사 실패/);

    const quarantinePath = join(dir, 'quarantine', 'memory-corrupt-2026-04-22T01-02-03-456Z.db');
    expect(existsSync(quarantinePath)).toBe(true);

    const secondAt = new Date('2026-04-22T01:03:03.456Z');
    expect(() => runDatabaseIntegrityPreflight(dbPath, secondAt)).toThrow(/데이터베이스 무결성 사전 검사 실패/);

    const quarantineEntries = existsSync(join(dir, 'quarantine'))
      ? readdirSync(join(dir, 'quarantine'))
      : [];
    expect(quarantineEntries.length).toBe(1);
  });

  it('fails fast without quarantine for a non-database access error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memento-preflight-access-'));
    cleanupDirs.push(dir);

    const dbPath = dir;
    const quarantinePath = join(dir, 'quarantine');

    expect(() => runDatabaseIntegrityPreflight(dbPath)).toThrow(/데이터베이스 사전 검사 실패/);
    expect(existsSync(quarantinePath)).toBe(false);
  });

  it('skips preflight for a missing database file', () => {
    const { dir, dbPath } = createDbPath('memento-preflight-missing-');
    cleanupDirs.push(dir);

    expect(() => runDatabaseIntegrityPreflight(dbPath)).not.toThrow();
  });

  it('skips preflight for in-memory and file URI databases', () => {
    expect(() => runDatabaseIntegrityPreflight(':memory:')).not.toThrow();
    expect(() => runDatabaseIntegrityPreflight('file:shared-memory?mode=memory&cache=shared')).not.toThrow();
  });
});

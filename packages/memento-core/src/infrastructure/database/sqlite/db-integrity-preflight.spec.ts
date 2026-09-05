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

  // #849: 기존 구현은 15분 창 안에서만 중복을 걸러, 재시도 간격이 그보다 길면
  // 같은 파일이 계속 새로 쌓였다. 실측(2026-09-05)에서 39개 중 고유 파일은 2종뿐이었다.
  it('reuses an identical quarantine snapshot even when the crash loop spans days', () => {
    const { dir, dbPath } = createDbPath('memento-preflight-dedup-longloop-');
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

    // 15분 창을 한참 넘긴 간격으로 반복 구동한다.
    const attempts = [
      '2026-04-22T01:02:03.456Z',
      '2026-04-22T13:02:03.456Z',
      '2026-04-23T01:02:03.456Z',
      '2026-06-15T12:07:06.369Z',
    ];
    for (const at of attempts) {
      expect(() => runDatabaseIntegrityPreflight(dbPath, new Date(at)))
        .toThrow(/데이터베이스 무결성 사전 검사 실패/);
    }

    // 내용이 같으므로 스냅샷은 최초 1개만 남아야 한다.
    expect(readdirSync(join(dir, 'quarantine'))).toEqual([
      'memory-corrupt-2026-04-22T01-02-03-456Z.db',
    ]);
  });

  it('keeps quarantine snapshots bounded when the corruption content changes', () => {
    const { dir, dbPath } = createDbPath('memento-preflight-retention-');
    cleanupDirs.push(dir);

    // 매번 내용이 달라지는 손상을 만들어 중복 제거로는 막을 수 없는 상황을 만든다.
    for (let attempt = 0; attempt < 8; attempt++) {
      rmSync(dbPath, { force: true });
      const db = new Database(dbPath);
      db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT)');
      for (let row = 0; row <= attempt; row++) {
        db.prepare('INSERT INTO sample(value) VALUES (?)').run(`broken-${attempt}-${row}`);
      }
      db.close();

      const checkpoint = new Database(dbPath);
      checkpoint.pragma('wal_checkpoint(TRUNCATE)');
      checkpoint.close();

      const size = statSync(dbPath).size;
      const fd = openSync(dbPath, 'r+');
      ftruncateSync(fd, Math.max(100, Math.floor(size / 2)) + attempt);
      closeSync(fd);

      const at = new Date(Date.parse('2026-04-22T00:00:00.000Z') + attempt * 24 * 60 * 60 * 1000);
      expect(() => runDatabaseIntegrityPreflight(dbPath, at))
        .toThrow(/데이터베이스 무결성 사전 검사 실패/);
    }

    // 보존 개수(5) 를 넘지 않고, 남은 것은 최신 5개여야 한다.
    const entries = readdirSync(join(dir, 'quarantine')).sort();
    expect(entries).toHaveLength(5);
    expect(entries[0]).toBe('memory-corrupt-2026-04-25T00-00-00-000Z.db');
    expect(entries[4]).toBe('memory-corrupt-2026-04-29T00-00-00-000Z.db');
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

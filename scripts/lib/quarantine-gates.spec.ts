import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertAbsoluteDbPath, openForWrite, openReadonly, QuarantineGateError } from './quarantine-gates.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'q065-'));
  dbPath = join(dir, 'memory.db');
  const seed = new Database(dbPath);
  seed.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY, type TEXT NOT NULL)');
  seed.exec("INSERT INTO memory_item VALUES ('mem_a', 'semantic')");
  seed.close();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('assertAbsoluteDbPath', () => {
  it('상대 경로를 종료 코드 10으로 거부한다', () => {
    expect(() => assertAbsoluteDbPath('./data/memory.db')).toThrow(QuarantineGateError);
    try {
      assertAbsoluteDbPath('./data/memory.db');
    } catch (error) {
      expect((error as QuarantineGateError).code).toBe(10);
    }
  });

  it('~ 를 포함한 경로를 거부한다 (셸이 확장하지 않은 경우)', () => {
    expect(() => assertAbsoluteDbPath('~/.memento/data/memory.db')).toThrow(QuarantineGateError);
  });

  it('미설정을 거부한다', () => {
    expect(() => assertAbsoluteDbPath(undefined)).toThrow(QuarantineGateError);
  });

  it('절대 경로는 그대로 돌려준다', () => {
    expect(assertAbsoluteDbPath('/abs/memory.db')).toBe('/abs/memory.db');
  });
});

describe('openReadonly', () => {
  it('쓰기를 거부한다', () => {
    const db = openReadonly(dbPath);
    expect(() => db.exec("INSERT INTO memory_item VALUES ('mem_b', 'semantic')")).toThrow();
    db.close();
  });
});

describe('openForWrite', () => {
  it('foreign_keys 를 켜고 되읽어 확인한다', () => {
    const db = openForWrite(dbPath);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
});

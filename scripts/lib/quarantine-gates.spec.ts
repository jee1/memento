import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertAbsoluteDbPath, type Gate, openForWrite, openReadonly, QuarantineGateError, runGates,
} from './quarantine-gates.js';

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

describe('runGates', () => {
  const pass = (id: number, code: number): Gate => ({ id, name: `게이트 ${id}`, code, check: () => true });

  it('전부 통과하면 null 을 반환한다', () => {
    expect(runGates([pass(1, 10), pass(2, 11)])).toBeNull();
  });

  it('첫 실패에서 멈추고 그 뒤 게이트를 평가하지 않는다', () => {
    let laterCalled = false;
    const gates: Gate[] = [
      pass(1, 10),
      { id: 2, name: '백업 크기 대조', code: 14, check: () => '사본 A 가 라이브의 3% 크기입니다' },
      { id: 3, name: '뒤 게이트', code: 15, check: () => { laterCalled = true; return true; } },
    ];

    expect(runGates(gates)).toEqual({ code: 14, reason: '사본 A 가 라이브의 3% 크기입니다' });
    expect(laterCalled).toBe(false);
  });

  it('사유를 주지 않으면 게이트 이름으로 사유를 만든다', () => {
    const gates: Gate[] = [{ id: 9, name: 'kg_triple 보존율', code: 18, check: () => '' }];
    expect(runGates(gates)?.reason).toContain('kg_triple 보존율');
  });
});

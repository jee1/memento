import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertAbsoluteDbPath, assertRehearsalTarget, buildExecuteGates, type ExecuteGateInputs, type Gate,
  openForWrite, openReadonly, QuarantineGateError, runGates,
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

describe('buildExecuteGates (계약 중단 게이트)', () => {
  const passing: ExecuteGateInputs = {
    dbPathIsAbsolute: true, foreignKeysOn: true, serverStopped: true, integrityCheckPassed: true,
    backup: { exists: true, sizeRatio: 0.99, sidecarsClean: true },
    copyABootVerified: true, copyBRehearsalPassed: true,
    falsePositives: { agree: true, emptySubject: 0 },
    kgPreservationRate: 1,
    expectedDeclared: true, progressMissingOnResume: false, progressFile: '/tmp/progress.jsonl',
    driftPercent: 0.11, driftTolerance: 5,
    relationsExportExists: true, beforeProbeExists: true,
  };

  it('전부 통과하면 null 이다', () => {
    expect(runGates(buildExecuteGates(passing))).toBeNull();
  });

  it.each([
    ['dbPathIsAbsolute', { dbPathIsAbsolute: false }, 10],
    ['foreignKeysOn', { foreignKeysOn: false }, 11],
    ['serverStopped', { serverStopped: false }, 12],
    ['integrityCheckPassed', { integrityCheckPassed: false }, 13],
    ['backup 크기', { backup: { exists: true, sizeRatio: 0.02, sidecarsClean: true } }, 14],
    ['copyABootVerified', { copyABootVerified: false }, 15],
    ['copyBRehearsalPassed', { copyBRehearsalPassed: false }, 16],
    ['오탐', { falsePositives: { agree: false, emptySubject: 0 } }, 17],
    ['kg 보존율', { kgPreservationRate: 0.999 }, 18],
    ['재집계 편차', { driftPercent: 7 }, 19],
    ['기대값 미선언', { expectedDeclared: false, driftPercent: Number.NaN }, 19],
    ['재개인데 진행 기록 없음', { progressMissingOnResume: true }, 19],
    ['relations.jsonl', { relationsExportExists: false }, 20],
    ['before.json', { beforeProbeExists: false }, 21],
  ])('%s 실패 시 종료 코드 %i', (_name, patch, code) => {
    expect(runGates(buildExecuteGates({ ...passing, ...patch as Partial<ExecuteGateInputs> }))?.code).toBe(code);
  });

  it('kg_triple 보존율은 100% 미만이면 무조건 막는다', () => {
    expect(runGates(buildExecuteGates({ ...passing, kgPreservationRate: 0.9999 }))?.code).toBe(18);
  });
});

describe('assertRehearsalTarget (C-1: rehearse 게이트 우회 차단)', () => {
  it('대상이 프로덕션 DB 면 종료 코드 12 로 거부한다', () => {
    expect(() => assertRehearsalTarget(dbPath, dbPath)).toThrow(QuarantineGateError);
    try {
      assertRehearsalTarget(dbPath, dbPath);
    } catch (error) {
      expect((error as QuarantineGateError).code).toBe(12);
      expect((error as QuarantineGateError).message).toContain('사본 전용');
    }
  });

  it('심링크로 우회해도 잡는다', () => {
    const link = join(dir, 'looks-like-a-copy.db');
    symlinkSync(dbPath, link);
    expect(() => assertRehearsalTarget(link, dbPath)).toThrow(QuarantineGateError);
  });

  it('경로 표기가 달라도 같은 파일이면 잡는다', () => {
    expect(() => assertRehearsalTarget(join(dir, '.', 'memory.db'), dbPath)).toThrow(QuarantineGateError);
  });

  it('진짜 사본이면 통과한다', () => {
    const copy = join(dir, 'copy-b.db');
    copyFileSync(dbPath, copy);
    expect(() => assertRehearsalTarget(copy, dbPath)).not.toThrow();
  });

  it('프로덕션 경로가 존재하지 않으면 통과시킨다 (다른 머신)', () => {
    expect(() => assertRehearsalTarget(dbPath, join(dir, 'no-such-production.db'))).not.toThrow();
  });
});

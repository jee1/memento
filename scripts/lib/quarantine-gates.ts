/**
 * #804 격리 러너의 안전 장치.
 *
 * 파괴적 실행 전에 걸어야 하는 것들을 한곳에 모았다 — 경로 검증, DB 열기 규율, 중단 게이트.
 * 게이트는 process.exit 을 부르지 않고 값을 반환한다. 그래야 종료 코드를 단위 테스트할 수 있다.
 */

import { isAbsolute } from 'node:path';
import { openDb, type CliDatabase } from './cli.js';

/** 계약(contracts/runner-cli.md)의 종료 코드 10~21 을 그대로 나른다. */
export class QuarantineGateError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'QuarantineGateError';
  }
}

/** FR-009: 절대 경로가 아니면 엉뚱한 DB 를 지울 수 있다. ~ 는 셸이 확장하지 않으면 그대로 온다. */
export function assertAbsoluteDbPath(dbPath: string | undefined): string {
  if (!dbPath || !isAbsolute(dbPath) || dbPath.includes('~')) {
    throw new QuarantineGateError(10, `DB_PATH 는 절대 경로여야 합니다: ${dbPath ?? '(미설정)'}`);
  }
  return dbPath;
}

/**
 * SC-004: 읽기 명령의 무변경을 약속이 아니라 구조로 만든다.
 * initializeDatabase() 는 마이그레이션과 스키마 보정을 돌리므로 절대 쓰지 않는다.
 */
export function openReadonly(dbPath: string): CliDatabase {
  return openDb(dbPath, { readonly: true });
}

/** FR-006: better-sqlite3 는 FK 를 기본 OFF 로 연다. 켜지지 않으면 연쇄 정리가 통째로 실패한다. */
export function openForWrite(dbPath: string): CliDatabase {
  const db = openDb(dbPath);
  db.pragma('foreign_keys = ON');
  if (db.pragma('foreign_keys', { simple: true }) !== 1) {
    db.close();
    throw new QuarantineGateError(11, 'PRAGMA foreign_keys 를 켤 수 없습니다 — 연쇄 정리가 불가능합니다');
  }
  return db;
}

export interface Gate {
  /** 계약 문서의 게이트 번호 (1~12) */
  id: number;
  name: string;
  /** 실패 시 종료 코드 (10~21) */
  code: number;
  /** 통과면 true, 실패면 사유 문자열 */
  check: () => true | string;
}

export interface GateFailure {
  code: number;
  reason: string;
}

/** 계약: 순서대로 평가하고 하나라도 실패하면 삭제를 0건 수행한 채 비영점 코드로 종료한다. */
export function runGates(gates: Gate[]): GateFailure | null {
  for (const gate of gates) {
    const outcome = gate.check();
    if (outcome !== true) {
      return { code: gate.code, reason: outcome || `게이트 ${gate.id} 실패: ${gate.name}` };
    }
  }
  return null;
}

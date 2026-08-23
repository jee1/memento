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

export interface ExecuteGateInputs {
  dbPathIsAbsolute: boolean;
  foreignKeysOn: boolean;
  serverStopped: boolean;
  integrityCheckPassed: boolean;
  backup: { exists: boolean; sizeRatio: number; sidecarsClean: boolean };
  copyABootVerified: boolean;
  copyBRehearsalPassed: boolean;
  falsePositives: { agree: boolean; emptySubject: number };
  kgPreservationRate: number;
  driftPercent: number;
  driftTolerance: number;
  relationsExportExists: boolean;
  beforeProbeExists: boolean;
}

/** 백업이 라이브의 90% 미만이면 부분 파일로 본다 (0바이트 산출물이 실재한 전례). */
const BACKUP_MIN_SIZE_RATIO = 0.9;

/** 계약(contracts/runner-cli.md)의 게이트 번호와 종료 코드를 1:1로 고정한다. */
export function buildExecuteGates(input: ExecuteGateInputs): Gate[] {
  return [
    { id: 1, name: 'DB_PATH 절대 경로', code: 10,
      check: () => input.dbPathIsAbsolute || 'DB_PATH 가 절대 경로가 아닙니다' },
    { id: 2, name: 'PRAGMA foreign_keys = ON', code: 11,
      check: () => input.foreignKeysOn || 'foreign_keys 가 꺼져 있어 연쇄 정리가 불가능합니다' },
    { id: 3, name: '러너 외 쓰기 프로세스 없음', code: 12,
      check: () => input.serverStopped
        || '프로덕션 서버가 살아 있습니다 (SQLITE_BUSY · 신규 유입 · 망각 정책 위험)' },
    { id: 4, name: 'db:pre-docker-deploy 무결성 점검', code: 13,
      check: () => input.integrityCheckPassed || '무결성 점검이 실패했습니다' },
    { id: 5, name: '백업 존재 · 크기 대조 · sidecar', code: 14,
      check: () => {
        if (!input.backup.exists) return '백업(사본 A)이 없습니다';
        if (input.backup.sizeRatio < BACKUP_MIN_SIZE_RATIO) {
          return `사본 A 가 라이브의 ${(input.backup.sizeRatio * 100).toFixed(1)}% 크기입니다 — 부분 파일 의심`;
        }
        if (!input.backup.sidecarsClean) return '-wal/-shm sidecar 잔재가 남아 있습니다';
        return true;
      } },
    { id: 6, name: '사본 A 구동 검증', code: 15,
      check: () => input.copyABootVerified || '사본 A 가 서버로 구동되지 않았습니다 — 롤백 근거가 없습니다' },
    { id: 7, name: '사본 B 리허설', code: 16,
      check: () => input.copyBRehearsalPassed || '리허설이 통과하지 않았습니다' },
    { id: 8, name: '오탐 전수 검증', code: 17,
      check: () => {
        if (input.falsePositives.emptySubject > 0) {
          return `대상에 subject 결여 행 ${input.falsePositives.emptySubject}건 — 판별식 결함`;
        }
        return input.falsePositives.agree || '두 판별 방식의 건수가 갈립니다 — 오분류 존재';
      } },
    { id: 9, name: 'kg_triple 보존율 100%', code: 18,
      check: () => input.kgPreservationRate >= 1
        || `보존율 ${(input.kgPreservationRate * 100).toFixed(4)}% — 차이만큼이 진짜 소실입니다` },
    { id: 10, name: '실행 직전 재집계 편차', code: 19,
      check: () => Math.abs(input.driftPercent) <= input.driftTolerance
        || `편차 ${input.driftPercent.toFixed(2)}% 가 허용치 ${input.driftTolerance}% 를 넘습니다` },
    { id: 11, name: 'relations.jsonl 존재', code: 20,
      check: () => input.relationsExportExists || '관계 내보내기가 없습니다 — 유일한 복구 근거입니다' },
    { id: 12, name: 'before.json 존재', code: 21,
      check: () => input.beforeProbeExists || '사전 프로브 기록이 없습니다 — 전후 대조가 불가능합니다' },
  ];
}

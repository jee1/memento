#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isMain, type CliDatabase } from './lib/cli.js';
import {
  assertAbsoluteDbPath, buildExecuteGates, type ExecuteGateInputs, openForWrite, openReadonly,
  QuarantineGateError, runGates,
} from './lib/quarantine-gates.js';
import { appendJsonl, buildDryRunReport, exportRelations, resolveOutDir } from './lib/quarantine-report.js';
import { countTargets, crossVerifyTargets, kgPreservation } from './lib/quarantine-targets.js';
import {
  cleanupResidue, createForgetFn, readDeletedIds, runQuarantine, vacuumAndMeasure,
} from './lib/quarantine-run.js';

function envFlag(name: string): boolean {
  return process.env[name] === '1';
}

/**
 * 사람이 확인해야 하는 게이트는 환경 변수로 받는다 — 러너가 스스로 통과시키지 못하게 한다.
 * DB 에서 읽을 수 있는 것(FK · 오탐 · 보존율 · 편차)만 직접 집계한다.
 */
function collectGateInputs(
  db: CliDatabase, dbPath: string, outDir: string, options: Options,
): ExecuteGateInputs {
  const cross = crossVerifyTargets(db);
  const kg = kgPreservation(db);

  // 게이트 10 은 fail-closed 여야 한다. 미설정이면 편차 0 으로 통과시키는 것이 아니라 막는다.
  const declared = Number.parseInt(process.env.QUARANTINE_EXPECTED_TARGETS ?? '', 10);
  if (!Number.isFinite(declared) || declared <= 0) {
    throw new QuarantineGateError(19, 'QUARANTINE_EXPECTED_TARGETS 가 없습니다 — 재집계 대조를 건너뛸 수 없습니다');
  }
  // FR-004b: 재개 시에는 직전 진행 기록의 누적 성공 수를 반영한 기대값과 대조한다.
  const alreadyDeleted = options.resume ? readDeletedIds(join(outDir, 'progress.jsonl')).length : 0;
  const expected = declared - alreadyDeleted;
  const actual = countTargets(db);
  const driftPercent = expected <= 0 ? 100 : ((actual - expected) / expected) * 100;

  return {
    dbPathIsAbsolute: isAbsolute(dbPath),
    foreignKeysOn: db.pragma('foreign_keys', { simple: true }) === 1,
    serverStopped: envFlag('QUARANTINE_SERVER_STOPPED'),
    integrityCheckPassed: envFlag('QUARANTINE_INTEGRITY_OK'),
    backup: {
      exists: envFlag('QUARANTINE_BACKUP_OK'),
      sizeRatio: Number.parseFloat(process.env.QUARANTINE_BACKUP_RATIO ?? '0'),
      sidecarsClean: envFlag('QUARANTINE_BACKUP_SIDECARS_CLEAN'),
    },
    copyABootVerified: envFlag('QUARANTINE_COPY_A_BOOTED'),
    copyBRehearsalPassed: envFlag('QUARANTINE_REHEARSAL_OK'),
    falsePositives: { agree: cross.agree, emptySubject: cross.emptySubject },
    kgPreservationRate: kg.rate,
    driftPercent,
    driftTolerance: options.driftTolerance,
    relationsExportExists: existsSync(join(outDir, 'relations.jsonl')),
    beforeProbeExists: existsSync(join(outDir, 'before.json')),
  };
}
/**
 * #804: triple 추출 파이프라인이 만든 템플릿 문장 semantic 을 기존 forget 도구로 격리한다.
 *
 * 사용:
 *   DB_PATH=/abs/path/memory.db npm run memory:quarantine-065 -- report
 *   DB_PATH=/abs/path/memory.db npm run memory:quarantine-065 -- execute
 *
 * 계약: specs/065-804-triple-semantic-quarantine/contracts/runner-cli.md
 */

export const COMMANDS = ['report', 'export-relations', 'rehearse', 'execute', 'cleanup', 'vacuum'] as const;
export type Command = (typeof COMMANDS)[number];

export interface Options {
  command: Command;
  out: string;
  batchSize: number;
  sampleSize: number;
  driftTolerance: number;
  resume: boolean;
  yes: boolean;
}

function numberFlag(argv: string[], name: string, fallback: number): number {
  const index = argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const raw = argv[index + 1];
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} 값이 숫자가 아닙니다: ${raw ?? '(없음)'}`);
  }
  return value;
}

export function parseOptions(argv: string[]): Options {
  const command = argv[0] as Command;
  if (!COMMANDS.includes(command)) {
    throw new Error(`알 수 없는 명령: ${argv[0] ?? '(없음)'} — ${COMMANDS.join(' | ')}`);
  }

  const batchSize = numberFlag(argv, '--batch-size', 100);
  if (batchSize < 1 || batchSize > 100) {
    throw new Error(`--batch-size 는 1~100 이어야 합니다 (forget maxItems 100): ${batchSize}`);
  }

  const outIndex = argv.indexOf('--out');
  return {
    command,
    out: outIndex === -1 ? '.local/quarantine-065' : (argv[outIndex + 1] ?? '.local/quarantine-065'),
    batchSize,
    sampleSize: numberFlag(argv, '--sample-size', 50),
    driftTolerance: numberFlag(argv, '--drift-tolerance', 5),
    resume: argv.includes('--resume'),
    // 계약: --yes 는 execute 에 무시된다. 파괴적 실행은 대화형 확인을 건너뛸 수 없다.
    yes: command === 'execute' ? false : argv.includes('--yes'),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const dbPath = assertAbsoluteDbPath(process.env.DB_PATH);
  const outDir = resolveOutDir(options.out, process.cwd());
  mkdirSync(outDir, { recursive: true });

  if (options.command === 'report') {
    const db = openReadonly(dbPath);
    try {
      const file = join(outDir, 'dry-run-report.md');
      writeFileSync(file, buildDryRunReport(db, { sampleSize: options.sampleSize }), 'utf8');
      console.log(`[quarantine-065] 리포트: ${file}`);
    } finally {
      db.close();
    }
    return;
  }

  if (options.command === 'export-relations') {
    const db = openReadonly(dbPath);
    try {
      const file = join(outDir, 'relations.jsonl');
      const summary = exportRelations(db, file);
      console.log(`[quarantine-065] 관계 ${summary.rows}행 → ${file}`);
      console.log(JSON.stringify(summary.byType, null, 2));
    } finally {
      db.close();
    }
    return;
  }

  const progressFile = join(outDir, 'progress.jsonl');

  if (options.command === 'rehearse' || options.command === 'execute') {
    const db = openForWrite(dbPath);
    try {
      if (options.command === 'execute') {
        const failure = runGates(buildExecuteGates(collectGateInputs(db, dbPath, outDir, options)));
        if (failure) {
          throw new QuarantineGateError(failure.code, failure.reason);
        }
      }
      const summary = await runQuarantine({
        db,
        forget: createForgetFn(db),
        batchSize: options.batchSize,
        onBatch: (row) => appendJsonl(progressFile, row),
      });
      console.log(
        `[quarantine-065] ${summary.batches}배치 · 삭제 ${summary.deleted}건 · 실패 ${summary.failed.length}건`,
      );
    } finally {
      db.close();
    }
    return;
  }

  if (options.command === 'cleanup') {
    // 실행 시작 시각이 없으면 outbox DELETE 가 0행을 지우고도 조용히 성공한다.
    // 지금 시각으로 대체하지 않는다 — 그 폴백이 정확히 실패를 감추는 경로다.
    const runStartedAt = process.env.QUARANTINE_STARTED_AT;
    if (!runStartedAt) {
      throw new QuarantineGateError(1, 'QUARANTINE_STARTED_AT 이 필요합니다 (execute 직전에 export 한 값)');
    }
    const db = openForWrite(dbPath);
    try {
      const result = cleanupResidue(db, { startedAt: runStartedAt, deletedIds: readDeletedIds(progressFile) });
      console.log(
        `[quarantine-065] outbox ${result.outbox}행 · forgetting_event ${result.forgettingEvents}행 정리`,
      );
    } finally {
      db.close();
    }
    return;
  }

  if (options.command === 'vacuum') {
    const db = openForWrite(dbPath);
    try {
      const result = vacuumAndMeasure(db, dbPath);
      console.log(`[quarantine-065] ${result.before} → ${result.after} 바이트 (회수 ${result.reclaimed})`);
    } finally {
      db.close();
    }
    return;
  }

  throw new Error(`아직 구현되지 않은 명령: ${options.command}`);
}

if (isMain(import.meta.url)) {
  main().catch((error: unknown) => {
    if (error instanceof QuarantineGateError) {
      console.error(`[중단] ${error.message}`);
      process.exit(error.code);
    }
    console.error(error);
    process.exit(1);
  });
}

#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { isMain, type CliDatabase } from './lib/cli.js';
import {
  assertAbsoluteDbPath, assertRehearsalTarget, buildExecuteGates, type ExecuteGateInputs,
  openForWrite, openReadonly, QuarantineGateError, runGates,
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

  // 게이트 10 은 fail-closed 다. 다만 여기서 던지지 않고 값으로 넘긴다 —
  // 조기 throw 는 계약의 "순서대로 평가"를 깨서, 서버가 켜져 있는데도(코드 12) 코드 19 를 보게 만든다.
  const declared = Number.parseInt(process.env.QUARANTINE_EXPECTED_TARGETS ?? '', 10);
  const expectedDeclared = Number.isFinite(declared) && declared > 0;

  // FR-004b: 재개 시에는 직전 진행 기록의 누적 성공 수를 반영한 기대값과 대조한다.
  // --out 을 1회차와 다르게 주면 진행 기록을 못 찾아 누적분이 0이 되고 편차 게이트가 헛돈다.
  const progressFile = join(outDir, `${options.command}.progress.jsonl`);
  const progressMissingOnResume = options.resume && !existsSync(progressFile);
  const alreadyDeleted = options.resume && !progressMissingOnResume ? readDeletedIds(progressFile).length : 0;
  const expected = declared - alreadyDeleted;
  const actual = countTargets(db);
  const driftPercent = !expectedDeclared || expected <= 0 ? Number.NaN : ((actual - expected) / expected) * 100;

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
    expectedDeclared,
    progressMissingOnResume,
    progressFile,
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

  const sampleSize = numberFlag(argv, '--sample-size', 50);
  if (sampleSize < 1) {
    // LIMIT -1 은 SQLite 에서 "제한 없음"이라 표본이 전수로 부풀어 리포트에 본문이 전부 실린다.
    throw new Error(`--sample-size 는 1 이상이어야 합니다: ${sampleSize}`);
  }

  const outIndex = argv.indexOf('--out');
  return {
    command,
    out: outIndex === -1 ? '.local/quarantine-065' : (argv[outIndex + 1] ?? '.local/quarantine-065'),
    batchSize,
    sampleSize,
    driftTolerance: numberFlag(argv, '--drift-tolerance', 5),
    resume: argv.includes('--resume'),
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

  // rehearse 와 execute 가 같은 파일에 append 하면 execute --resume 이 리허설 ID 까지 세어
  // 누적 삭제분을 과대계산하고 편차 게이트가 오발한다. 명령별로 분리한다.
  const progressFile = join(outDir, `${options.command}.progress.jsonl`);

  if (options.command === 'rehearse' || options.command === 'execute') {
    if (options.command === 'rehearse') {
      // C-1: 리허설은 사본 전용이다. 게이트를 평가하지 않으므로 이 확인이 유일한 방어다.
      assertRehearsalTarget(dbPath);
    }
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
        `[quarantine-065] ${summary.batches}배치 · 삭제 ${summary.deleted}건 · 실패 ${summary.failed.length}건`
          + ` · 소요 ${(summary.elapsedMs / 1000).toFixed(1)}초`,
      );
    } finally {
      db.close();
    }
    return;
  }

  if (options.command === 'cleanup') {
    // 정리 대상은 시간 범위가 아니라 실제로 지운 ID 다 (quarantine-run.ts 의 주석 참조).
    // 따라서 execute 가 남긴 진행 기록이 유일한 입력이고, 없으면 cleanupResidue 가 던진다.
    const executeProgressFile = join(outDir, 'execute.progress.jsonl');
    const db = openForWrite(dbPath);
    try {
      const result = cleanupResidue(db, { deletedIds: readDeletedIds(executeProgressFile) });
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

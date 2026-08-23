#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './lib/cli.js';
import { assertAbsoluteDbPath, openReadonly, QuarantineGateError } from './lib/quarantine-gates.js';
import { buildDryRunReport, exportRelations, resolveOutDir } from './lib/quarantine-report.js';
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

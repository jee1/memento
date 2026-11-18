import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  buildIssueDraft,
  buildUsageReport,
  countActiveMemoryItems,
  getAllTools,
  mementoConfig,
  readCurrentSchemaVersion,
  readUsageRows,
  validateUsageReport,
  type UsageReportInput,
} from '@memento/core';

/**
 * `memento doctor --report` (#1769): 환경과 최근 오류 집계를 모아 GitHub 이슈 초안을 만든다.
 * 네트워크를 쓰지 않는다. 링크는 출력만 하고 여는 것은 사용자다. DB 는 읽기 전용으로만 연다.
 */

const HELP_TEXT = `Usage:
  memento doctor --report [--print]

환경(버전, Node, OS, 설치 방식, 임베딩, 기억 수 구간)과 최근 7일의 이 기기 사용 집계로 GitHub 이슈 초안을 만듭니다.
  --print   붙여 넣을 내용 전체를 그대로 보여 줍니다. 초안이 2KB 를 넘으면 링크 없이 이 출력만 나옵니다.
자동으로 전송하지 않습니다. 링크는 내용을 확인한 뒤 직접 여십시오.
`;

export type InstallKind = 'npm-global' | 'npx' | 'docker' | 'source' | 'unknown';

/** 경로는 분류에만 쓰고 출력하지 않는다. */
export function detectInstallKind(input: { modulePath: string; hasDockerEnv: boolean; hasGitCheckout: boolean }): InstallKind {
  const normalized = input.modulePath.split(path.sep).join('/');
  if (input.hasDockerEnv) return 'docker';
  if (normalized.includes('/_npx/')) return 'npx';
  if (normalized.includes('/node_modules/')) return 'npm-global';
  if (input.hasGitCheckout) return 'source';
  return 'unknown';
}

/** 네이티브 모듈 적재 실패와 DB 파일 문제를 가르려고 메모리 DB 로 먼저 적재만 확인한다. */
function probeNativeModule(): 'ok' | 'load_failed' {
  try {
    new Database(':memory:').close();
    return 'ok';
  } catch {
    return 'load_failed';
  }
}

/** 삭제 표시되지 않은 기억 수. 기억 SQL 은 MemoryItemRepository 가 갖는다(#1531). 세지 못하면 null. */
function countMemories(db: Database.Database): number | null {
  try {
    return countActiveMemoryItems(db);
  } catch {
    return null;
  }
}

interface DatabaseFacts {
  database: 'ok' | 'missing' | 'open_failed';
  memoryCount: number | null;
  schemaVersion: string | null;
  usageRows: UsageReportInput['usageRows'];
}

function readDatabaseFacts(dbPath: string, nativeModule: 'ok' | 'load_failed', now: Date): DatabaseFacts {
  const empty = { memoryCount: null, schemaVersion: null, usageRows: [] };
  if (!existsSync(dbPath)) return { database: 'missing', ...empty };
  if (nativeModule === 'load_failed') return { database: 'open_failed', ...empty };
  let db: Database.Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    // 열기만으로는 SQLite 파일인지 알 수 없다. 첫 질의가 파일 머리를 읽다 실패한다.
    db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get();
    return {
      database: 'ok',
      memoryCount: countMemories(db),
      schemaVersion: readCurrentSchemaVersion(db),
      usageRows: readUsageRows(db, now),
    };
  } catch {
    return { database: 'open_failed', ...empty };
  } finally {
    db?.close();
  }
}

export interface DoctorReportDependencies {
  now?: () => Date;
  dbPath?: string;
  env?: NodeJS.ProcessEnv;
  modulePath?: string;
  writeStdout?: (message: string) => void | Promise<void>;
  writeStderr?: (message: string) => void | Promise<void>;
}

export async function runDoctorReport(argv: readonly string[], dependencies: DoctorReportDependencies = {}): Promise<number> {
  const writeStdout = dependencies.writeStdout ?? ((message: string) => process.stdout.write(message));
  const writeStderr = dependencies.writeStderr ?? ((message: string) => process.stderr.write(message));

  if (argv.includes('--help') || argv.includes('-h')) {
    await writeStdout(HELP_TEXT);
    return 0;
  }
  const unknown = argv.filter((arg) => arg !== '--report' && arg !== '--print');
  if (unknown.length > 0) {
    await writeStderr(`Unknown option: ${unknown[0]}\n${HELP_TEXT}`);
    return 1;
  }
  const print = argv.includes('--print');

  const now = (dependencies.now ?? (() => new Date()))();
  const modulePath = dependencies.modulePath ?? fileURLToPath(import.meta.url);
  const nativeModule = probeNativeModule();
  const facts = readDatabaseFacts(dependencies.dbPath ?? mementoConfig.dbPath, nativeModule, now);

  const report = buildUsageReport({
    mementoVersion: mementoConfig.serverVersion,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    install: detectInstallKind({
      modulePath,
      hasDockerEnv: existsSync('/.dockerenv'),
      hasGitCheckout: existsSync(path.resolve(path.dirname(modulePath), '../../../../.git')),
    }),
    embeddingProvider: mementoConfig.embeddingProvider,
    memoryCount: facts.memoryCount,
    nativeModule,
    database: facts.database,
    schemaVersion: facts.schemaVersion,
    usageRows: facts.usageRows,
    registeredTools: new Set(getAllTools().map((tool) => tool.name)),
  });

  const problems = validateUsageReport(report);
  if (problems.length > 0) {
    await writeStderr(`보고서를 만들지 못했습니다(내부 검사 실패): ${problems.join('; ')}\n`);
    return 1;
  }

  const draft = buildIssueDraft(report);
  const lines: string[] = [];
  if (print || draft.url === null) {
    if (draft.url === null) lines.push('초안이 2KB 를 넘어 링크를 만들지 않았습니다. 아래 내용을 복사해 새 이슈에 붙여 넣으십시오.', '');
    lines.push(`제목: ${draft.title}`, '', draft.body);
  }
  if (draft.url !== null) {
    if (!print) lines.push('내용을 먼저 보려면 `memento doctor --report --print` 를 실행하십시오.');
    lines.push('이슈 초안 링크(열기 전에 내용을 확인하십시오. 아무것도 자동으로 전송되지 않았습니다):', draft.url);
  }
  await writeStdout(`${lines.join('\n')}\n`);
  return 0;
}

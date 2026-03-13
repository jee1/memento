#!/usr/bin/env node
/**
 * Memento CLI for AI
 * 명세: REQ-CLI-1, REQ-OPT-1~3, REQ-CFG-1, REQ-IO-4, AC8. 서브커맨드: recall, remember, forget, memory_injection
 */

// 서드파티(onnxruntime, transformers 등) stderr 억제: core import 전에 stderr 래핑 (AC8)
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = function (chunk: unknown, encoding?: unknown, callback?: unknown): boolean {
  if (process.env.MEMENTO_CLI_QUIET === '1') {
    if (typeof callback === 'function') (callback as () => void)();
    return true;
  }
  return originalStderrWrite(chunk as any, encoding as any, callback as any);
};

import { loadEnv } from './cli/env-loader.js';
import {
  recallParams,
  rememberParams,
  forgetParams,
  memoryInjectionParams
} from './cli/option-map.js';

// 1) env 로드: core import 전에 --env-file, --config-dir만 파싱 후 로드
function parseGlobalOptions(argv: string[]): { dbPath?: string; envFile?: string; configDir?: string; help: boolean; subcommand?: string } {
  const result: { dbPath?: string; envFile?: string; configDir?: string; help: boolean; subcommand?: string } = { help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db-path' && argv[i + 1]) {
      result.dbPath = argv[++i];
    } else if (arg === '--env-file' && argv[i + 1]) {
      result.envFile = argv[++i];
    } else if (arg === '--config-dir' && argv[i + 1]) {
      result.configDir = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (!arg.startsWith('-') && !result.subcommand) {
      result.subcommand = arg;
      break;
    }
  }
  return result;
}

/** 서브커맨드 이후 argv 슬라이스 (argv[3..]) */
function subcommandArgv(argv: string[]): string[] {
  return argv.slice(3);
}

// env 로드만 먼저 수행 (dotenv가 process.env를 채움)
const preOptions = parseGlobalOptions(process.argv);
loadEnv({ envFile: preOptions.envFile, configDir: preOptions.configDir });

// CLI 모드 로그 억제 (REQ-IO-4, AC8). core import 전에 설정.
process.env.MEMENTO_CLI_QUIET = '1';

// 2) core import는 env 로드 이후 (mementoConfig가 이미 env 반영)
const {
  mementoConfig,
  createMementoCore,
  closeDatabase,
  createToolContext,
  getToolRegistry
} = await import('@memento/core');

const dbPath = preOptions.dbPath ?? process.env.DB_PATH ?? mementoConfig.dbPath;
const subcommand = preOptions.subcommand;
const showHelp = preOptions.help || !subcommand;

const TOOL_SUBCOMMANDS = new Set(['recall', 'remember', 'forget', 'memory_injection']);

async function main(): Promise<void> {
  if (showHelp) {
    originalStderrWrite('memento – Memento CLI for AI\n');
    originalStderrWrite('Usage: memento [options] <command> [command-args]\n\n');
    originalStderrWrite('Commands:\n');
    originalStderrWrite('  recall              관련 기억을 검색합니다 (하이브리드 검색)\n');
    originalStderrWrite('  remember            기억을 저장합니다\n');
    originalStderrWrite('  forget              기억을 삭제합니다 (소프트/하드)\n');
    originalStderrWrite('  memory_injection    관련 기억을 요약하여 프롬프트에 주입\n\n');
    originalStderrWrite('Global options:\n');
    originalStderrWrite('  --db-path <path>    DB 파일 경로\n');
    originalStderrWrite('  --env-file <path>   .env 파일 경로\n');
    originalStderrWrite('  --config-dir <path> 설정 디렉터리 (~/.memento 대체)\n');
    originalStderrWrite('  --help, -h           이 도움말\n');
    process.exit(0);
  }

  if (!TOOL_SUBCOMMANDS.has(subcommand!)) {
    originalStderrWrite(`Unknown command: ${subcommand}. Use --help.\n`);
    process.exit(1);
  }

  let db: import('better-sqlite3').Database | null = null;

  const cleanup = (): void => {
    if (db) {
      try {
        closeDatabase(db);
      } catch (_) {}
      db = null;
    }
  };

  process.on('exit', (code) => {
    cleanup();
  });
  process.on('uncaughtException', () => {
    cleanup();
  });
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  try {
    const core = await createMementoCore({ dbPath });
    db = core.db;
    const context = createToolContext(db, core.services);
    const toolRegistry = getToolRegistry();

    if (subcommand === 'recall') {
      const params = recallParams(subcommandArgv(process.argv));
      if (typeof params.query !== 'string' || !String(params.query).trim()) {
        originalStderrWrite('recall requires --query <string>.\n');
        process.exit(1);
      }
      const result = await toolRegistry.execute('recall', params, context);
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exit(0);
    }

    if (subcommand === 'remember') {
      const params = rememberParams(subcommandArgv(process.argv));
      if (typeof params.content !== 'string' || !String(params.content).trim()) {
        originalStderrWrite('remember requires --content <string>.\n');
        process.exit(1);
      }
      const result = await toolRegistry.execute('remember', params, context);
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exit(0);
    }

    if (subcommand === 'forget') {
      const params = forgetParams(subcommandArgv(process.argv));
      if (params.id === undefined && (!Array.isArray(params.batch) || params.batch.length === 0)) {
        originalStderrWrite('forget requires --id <memory_id> or --batch <id1,id2,...>.\n');
        process.exit(1);
      }
      const result = await toolRegistry.execute('forget', params, context);
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exit(0);
    }

    if (subcommand === 'memory_injection') {
      const params = memoryInjectionParams(subcommandArgv(process.argv));
      if (typeof params.query !== 'string' || !String(params.query).trim()) {
        originalStderrWrite('memory_injection requires --query <string>.\n');
        process.exit(1);
      }
      const result = await toolRegistry.execute('memory_injection', params, context);
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exit(0);
    }

    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    originalStderrWrite(msg + '\n');
    cleanup();
    process.exit(1);
  }
}

main().catch((err) => {
  originalStderrWrite(String(err?.message ?? err) + '\n');
  process.exit(1);
});

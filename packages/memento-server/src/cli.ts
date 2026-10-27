#!/usr/bin/env node
/**
 * Memento CLI for AI
 * 명세: REQ-CLI-1, REQ-OPT-1~3, REQ-CFG-1, REQ-IO-4, AC8. 서브커맨드: recall, remember, forget, memory_injection, agent ask
 */

function writeStdout(message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(message, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function writeStderr(message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stderr.write(message, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadEnv } from './cli/env-loader.js';
import {
  recallParams,
  rememberParams,
  forgetParams,
  memoryInjectionParams
} from './cli/option-map.js';

const TOOL_SUBCOMMANDS = new Set(['recall', 'remember', 'forget', 'memory_injection']);

/** agent 분기용: argv[2..]에서 글로벌 옵션 쌍 제거 (agent-ask.ts와 동일 규칙). */
function stripGlobalArgvForAgentDetection(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--db-path' || arg === '--env-file' || arg === '--config-dir') {
      if (argv[i + 1]) i++;
      continue;
    }
    out.push(arg);
  }
  return out;
}

/** 전체 argv에서 글로벌 플래그를 수집 (--db-path 등은 서브커맨드 뒤에 와도 인식). */
function parseGlobalFlags(argv: string[]): { dbPath?: string; envFile?: string; configDir?: string } {
  const out: { dbPath?: string; envFile?: string; configDir?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--db-path' && value !== undefined) {
      out.dbPath = value;
      i++;
    } else if (arg === '--env-file' && value !== undefined) {
      out.envFile = value;
      i++;
    } else if (arg === '--config-dir' && value !== undefined) {
      out.configDir = value;
      i++;
    }
  }
  return out;
}

/** recall|remember|forget|memory_injection 토큰 위치 (글로벌 옵션 값은 건너뜀). */
function findSubcommandWithIndex(argv: string[]): { subcommand?: string; subIdx?: number } {
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--db-path' || arg === '--env-file' || arg === '--config-dir') {
      if (argv[i + 1]) i++;
      continue;
    }
    if (arg.startsWith('-')) continue;
    if (TOOL_SUBCOMMANDS.has(arg)) {
      return { subcommand: arg, subIdx: i };
    }
  }
  return {};
}

/** 서브커맨드 인덱스 이후 인자에서, 뒤에 붙은 글로벌 옵션 쌍은 제외. */
function subcommandArgvFrom(argv: string[], subIdx: number): string[] {
  const rest = argv.slice(subIdx + 1);
  const filtered: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === undefined) continue;
    if (arg === '--db-path' || arg === '--env-file' || arg === '--config-dir') {
      if (rest[i + 1]) i++;
      continue;
    }
    filtered.push(arg);
  }
  return filtered;
}

// 1) env 로드: core import 전에 --env-file, --config-dir만 파싱 후 로드
function parseCli(argv: string[]): {
  dbPath?: string;
  envFile?: string;
  configDir?: string;
  help: boolean;
  subcommand?: string;
  subIdx?: number;
  commandToken?: string;
} {
  const flags = parseGlobalFlags(argv);
  const help = argv.includes('--help') || argv.includes('-h');
  const { subcommand, subIdx } = findSubcommandWithIndex(argv);
  let commandToken: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--db-path' || arg === '--env-file' || arg === '--config-dir') {
      if (argv[i + 1]) i++;
      continue;
    }
    if (arg.startsWith('-')) continue;
    commandToken = arg;
    break;
  }
  return { ...flags, help, subcommand, subIdx, commandToken };
}

// env 로드만 먼저 수행 (dotenv가 process.env를 채움)
const preOptions = parseCli(process.argv);
loadEnv({ envFile: preOptions.envFile, configDir: preOptions.configDir });

// 2) server-info import (env 로드 이후)
const {
  readServerInfo,
  isServerAlive,
  callToolViaHttp,
  deleteServerInfo,
  resolveServerInfoConfigDir,
} = await import('./server/server-info.js');

const subcommand = preOptions.subcommand;
const subIdx = preOptions.subIdx;
const commandToken = preOptions.commandToken;
const showHelp = preOptions.help || (!commandToken && !subcommand);

const HELP_TEXT = [
  'memento – Memento CLI for AI\n',
  'Usage: memento [options] <command> [command-args]\n\n',
  'Commands:\n',
  '  recall              관련 기억을 검색합니다 (하이브리드 검색)\n',
  '  remember            기억을 저장합니다\n',
  '  forget              기억을 삭제합니다 (소프트/하드)\n',
  '  memory_injection    관련 기억을 요약하여 프롬프트에 주입\n',
  '  review-queue cleanup 검토 큐를 dry-run 후 일괄 정리\n',
  '  agent ask           개인 지식 Agent 한 턴 (in-process, #236)\n',
  '  doctor              Agent endpoint/auth/schema/redaction 진단\n',
  '  status              최근 capture/injection/drop/degraded 요약\n',
  '  demo                두 session 자동 기억 주입 E2E 검증\n',
  '  connect codex       Codex lifecycle hook 연결\n',
  '  hook codex          Codex hook stdin 처리 (internal)\n\n',
  '  connect claude-code Claude Code lifecycle hook 연결\n',
  '  hook claude-code    Claude Code hook stdin 처리 (internal)\n',
  '  connect project     현재 저장소 MCP 설정에 X-Memento-Project-Id 헤더 기록 (#1270)\n',
  '\n',
  'Global options (서브커맨드 앞·뒤 모두 가능):\n',
  '  --db-path <path>    review-queue cleanup DB 경로 (기타 명령은 deprecated)\n',
  '  --env-file <path>   (deprecated) .env 파일 경로\n',
  '  --config-dir <path> 설정 디렉터리 (~/.memento 대체)\n',
  '  --help, -h           이 도움말\n',
].join('');

/** 서버 도구가 아닌 명령(doctor·connect·hook·agent·review-queue)을 실행한다. 해당 없으면 undefined. */
async function runAgentCommand(agentTokens: string[]): Promise<number | undefined> {
  const [first, second] = agentTokens;
  if (first === 'doctor' || first === 'status' || first === 'demo') {
    const { runAgentOpsCommand } = await import('./cli/agent-ops.js');
    return runAgentOpsCommand(first, agentTokens.slice(1));
  }
  if (first === 'agent') {
    const { runAgentAskMain, agentAskHelpText } = await import('./cli/agent-ask.js');
    if (preOptions.help && second !== 'ask') {
      await writeStderr(agentAskHelpText());
      return 0;
    }
    return runAgentAskMain(preOptions, process.argv);
  }
  switch (`${first} ${second}`) {
    case 'connect codex': {
      const { runCodexConnect } = await import('./cli/codex-connect.js');
      return runCodexConnect(agentTokens.slice(2));
    }
    case 'hook codex': {
      const { runCodexHookCommand } = await import('./cli/codex-hook.js');
      return runCodexHookCommand();
    }
    case 'connect claude-code': {
      const { runClaudeCodeConnect } = await import('./cli/claude-code-connect.js');
      return runClaudeCodeConnect(agentTokens.slice(2));
    }
    case 'connect project': {
      const { runProjectConnect } = await import('./cli/project-connect.js');
      return runProjectConnect(agentTokens.slice(2));
    }
    case 'hook claude-code': {
      const { runClaudeCodeHookCommand } = await import('./cli/claude-code-hook.js');
      return runClaudeCodeHookCommand();
    }
    case 'review-queue cleanup': {
      const { runReviewQueueCleanup } = await import('./cli/review-queue-cleanup.js');
      return runReviewQueueCleanup(agentTokens.slice(2), { dbPath: preOptions.dbPath });
    }
    default:
      return undefined;
  }
}

type ToolParamSpec = {
  build: (argv: string[]) => Record<string, unknown>;
  isValid: (params: Record<string, unknown>) => boolean;
  usage: string;
};

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

/** 인자 검증은 서버 체크 이전에 한다: 필수 인자 누락 시 서버 오류보다 명확한 메시지 제공. */
const TOOL_PARAM_SPECS: Record<string, ToolParamSpec> = {
  recall: {
    build: (argv) => recallParams(argv) as Record<string, unknown>,
    isValid: (params) => hasText(params.query),
    usage: 'recall requires --query <string>.\n',
  },
  remember: {
    build: (argv) => rememberParams(argv) as Record<string, unknown>,
    isValid: (params) => hasText(params.content),
    usage: 'remember requires --content <string>.\n',
  },
  forget: {
    build: (argv) => forgetParams(argv) as Record<string, unknown>,
    isValid: (params) => params.id !== undefined || (Array.isArray(params.batch) && params.batch.length > 0),
    usage: 'forget requires --id <memory_id> or --batch <id1,id2,...>.\n',
  },
  memory_injection: {
    build: (argv) => memoryInjectionParams(argv) as Record<string, unknown>,
    isValid: (params) => hasText(params.query),
    usage: 'memory_injection requires --query <string>.\n',
  },
};

async function callRunningServer(toolName: string, toolParams: Record<string, unknown>): Promise<number> {
  const configDir = preOptions.configDir ?? resolveServerInfoConfigDir();

  // 서버 발견
  const serverInfo = await readServerInfo(configDir);
  const serverAlive = serverInfo ? await isServerAlive(serverInfo) : false;
  if (!serverInfo || !serverAlive) {
    if (serverInfo && !serverAlive) {
      await deleteServerInfo(configDir);
    }
    await writeStderr(
      'Memento 서버가 실행 중이지 않습니다.\n' +
      'npm run dev 또는 npm run dev:http 로 먼저 서버를 실행하세요.\n'
    );
    return 1;
  }

  try {
    const result = await callToolViaHttp(serverInfo.port, toolName, toolParams);
    await writeStdout(JSON.stringify(result) + '\n');
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeStderr(msg + '\n');
    return 1;
  }
}

async function main(): Promise<number> {
  const agentExitCode = await runAgentCommand(stripGlobalArgvForAgentDetection(process.argv));
  if (agentExitCode !== undefined) {
    return agentExitCode;
  }

  if (showHelp) {
    await writeStderr(HELP_TEXT);
    return 0;
  }

  if (!subcommand && commandToken) {
    await writeStderr(`Unknown command: ${commandToken}. Use --help.\n`);
    return 1;
  }

  const spec = subcommand && TOOL_SUBCOMMANDS.has(subcommand) ? TOOL_PARAM_SPECS[subcommand] : undefined;
  if (!subcommand || !spec) {
    await writeStderr(`Unknown command: ${String(subcommand)}. Use --help.\n`);
    return 1;
  }

  // deprecated 옵션 경고
  if (preOptions.dbPath) {
    await writeStderr('[deprecated] --db-path 옵션은 더 이상 사용되지 않습니다. 서버가 DB를 관리합니다.\n');
  }
  if (preOptions.envFile) {
    await writeStderr('[deprecated] --env-file 옵션은 더 이상 사용되지 않습니다.\n');
  }

  const cmdArgv =
    subIdx !== undefined ? subcommandArgvFrom(process.argv, subIdx) : process.argv.slice(3);
  const toolParams = spec.build(cmdArgv);
  if (!spec.isValid(toolParams)) {
    await writeStderr(spec.usage);
    return 1;
  }

  return callRunningServer(subcommand, toolParams);
}

const isDirectRun = process.argv[1] !== undefined
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  void main().then((code) => {
    process.exit(code);
  }).catch((err) => {
    void writeStderr(String(err?.message ?? err) + '\n').finally(() => {
      process.exit(1);
    });
  });
}

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

import { resolve } from 'node:path';
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
    if (arg === '--db-path' && argv[i + 1]) {
      out.dbPath = argv[++i];
    } else if (arg === '--env-file' && argv[i + 1]) {
      out.envFile = argv[++i];
    } else if (arg === '--config-dir' && argv[i + 1]) {
      out.configDir = argv[++i];
    }
  }
  return out;
}

/** recall|remember|forget|memory_injection 토큰 위치 (글로벌 옵션 값은 건너뜀). */
function findSubcommandWithIndex(argv: string[]): { subcommand?: string; subIdx?: number } {
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
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

export async function main(): Promise<number> {
  const agentTokens = stripGlobalArgvForAgentDetection(process.argv);
  if (
    agentTokens[0] === 'doctor'
    || agentTokens[0] === 'status'
    || agentTokens[0] === 'demo'
  ) {
    const { runAgentOpsCommand } = await import('./cli/agent-ops.js');
    return runAgentOpsCommand(agentTokens[0], agentTokens.slice(1));
  }
  if (agentTokens[0] === 'connect' && agentTokens[1] === 'codex') {
    const { runCodexConnect } = await import('./cli/codex-connect.js');
    return runCodexConnect(agentTokens.slice(2));
  }
  if (agentTokens[0] === 'hook' && agentTokens[1] === 'codex') {
    const { runCodexHookCommand } = await import('./cli/codex-hook.js');
    return runCodexHookCommand();
  }
  if (agentTokens[0] === 'connect' && agentTokens[1] === 'claude-code') {
    const { runClaudeCodeConnect } = await import('./cli/claude-code-connect.js');
    return runClaudeCodeConnect(agentTokens.slice(2));
  }
  if (agentTokens[0] === 'hook' && agentTokens[1] === 'claude-code') {
    const { runClaudeCodeHookCommand } = await import('./cli/claude-code-hook.js');
    return runClaudeCodeHookCommand();
  }
  if (agentTokens[0] === 'agent') {
    const { runAgentAskMain, agentAskHelpText } = await import('./cli/agent-ask.js');
    if (preOptions.help && agentTokens[1] !== 'ask') {
      await writeStderr(agentAskHelpText());
      return 0;
    }
    return runAgentAskMain(preOptions, process.argv);
  }

  if (showHelp) {
    await writeStderr('memento – Memento CLI for AI\n');
    await writeStderr('Usage: memento [options] <command> [command-args]\n\n');
    await writeStderr('Commands:\n');
    await writeStderr('  recall              관련 기억을 검색합니다 (하이브리드 검색)\n');
    await writeStderr('  remember            기억을 저장합니다\n');
    await writeStderr('  forget              기억을 삭제합니다 (소프트/하드)\n');
    await writeStderr('  memory_injection    관련 기억을 요약하여 프롬프트에 주입\n');
    await writeStderr('  agent ask           개인 지식 Agent 한 턴 (in-process, #236)\n');
    await writeStderr('  doctor              Agent endpoint/auth/schema/redaction 진단\n');
    await writeStderr('  status              최근 capture/injection/drop/degraded 요약\n');
    await writeStderr('  demo                두 session 자동 기억 주입 E2E 검증\n');
    await writeStderr('  connect codex       Codex lifecycle hook 연결\n');
    await writeStderr('  hook codex          Codex hook stdin 처리 (internal)\n\n');
    await writeStderr('  connect claude-code Claude Code lifecycle hook 연결\n');
    await writeStderr('  hook claude-code    Claude Code hook stdin 처리 (internal)\n');
    await writeStderr('\n');
    await writeStderr('Global options (서브커맨드 앞·뒤 모두 가능):\n');
    await writeStderr('  --db-path <path>    (deprecated) DB 파일 경로\n');
    await writeStderr('  --env-file <path>   (deprecated) .env 파일 경로\n');
    await writeStderr('  --config-dir <path> 설정 디렉터리 (~/.memento 대체)\n');
    await writeStderr('  --help, -h           이 도움말\n');
    return 0;
  }

  if (!subcommand && commandToken) {
    await writeStderr(`Unknown command: ${commandToken}. Use --help.\n`);
    return 1;
  }

  if (!subcommand || !TOOL_SUBCOMMANDS.has(subcommand)) {
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

  // 인자 검증 (서버 체크 이전: 필수 인자 누락 시 서버 오류보다 명확한 메시지 제공)
  const cmdArgv =
    subIdx !== undefined ? subcommandArgvFrom(process.argv, subIdx) : process.argv.slice(3);

  let toolParams: Record<string, unknown>;
  if (subcommand === 'recall') {
    const params = recallParams(cmdArgv);
    if (typeof params.query !== 'string' || !String(params.query).trim()) {
      await writeStderr('recall requires --query <string>.\n');
      return 1;
    }
    toolParams = params as Record<string, unknown>;
  } else if (subcommand === 'remember') {
    const params = rememberParams(cmdArgv);
    if (typeof params.content !== 'string' || !String(params.content).trim()) {
      await writeStderr('remember requires --content <string>.\n');
      return 1;
    }
    toolParams = params as Record<string, unknown>;
  } else if (subcommand === 'forget') {
    const params = forgetParams(cmdArgv);
    if (params.id === undefined && (!Array.isArray(params.batch) || params.batch.length === 0)) {
      await writeStderr('forget requires --id <memory_id> or --batch <id1,id2,...>.\n');
      return 1;
    }
    toolParams = params as Record<string, unknown>;
  } else if (subcommand === 'memory_injection') {
    const params = memoryInjectionParams(cmdArgv);
    if (typeof params.query !== 'string' || !String(params.query).trim()) {
      await writeStderr('memory_injection requires --query <string>.\n');
      return 1;
    }
    toolParams = params as Record<string, unknown>;
  } else {
    return 0;
  }

  // configDir 결정
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
    const result = await callToolViaHttp(serverInfo.port, subcommand, toolParams);
    await writeStdout(JSON.stringify(result) + '\n');
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeStderr(msg + '\n');
    return 1;
  }
}

const isDirectRun = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  void main().then((code) => {
    process.exit(code);
  }).catch((err) => {
    void writeStderr(String(err?.message ?? err) + '\n').finally(() => {
      process.exit(1);
    });
  });
}

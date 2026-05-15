/**
 * `memento agent ask` — in-process 개인 지식 Agent 한 턴 (#236).
 * 설계: docs/superpowers/specs/2026-05-14-issue-236-agent-ask-cli-design.md
 * 테스트 훅: `AgentAskRuntimeHooks` (#237, Vitest에서 stdin/승인 주입).
 */

import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as stdinStream, stderr as stderrStream } from 'node:process';

import {
  closeDatabase,
  createMementoCore,
  createPersonalAgentLlmPort,
  createToolContext,
  mementoConfig,
  parsePersonalAgentLlmEnv,
  PersonalAgentLlmError,
  PersonalKnowledgeAgentService,
  ToolContextKnowledgeContextAdapter,
  ToolContextRememberPersistenceAdapter,
} from '@memento/core';
import type { ILLMPort, KnowledgeCandidate, PersonalKnowledgePersistItemResult } from '@memento/core';

import { parseArgvToParams } from './option-map.js';

const PROCESS_ID = 'cli/agent-ask';
const JSON_INTERACTION_INFO =
  '[info] --json은 인터랙션을 비활성화합니다(저장 생략).\n';

export type PreCliOptions = {
  dbPath?: string;
  envFile?: string;
  configDir?: string;
};

/** argv[2..]에서 글로벌 CLI 쌍 제거 (cli.ts와 동일 3종). */
export function stripGlobalCliArgs(argv: string[]): string[] {
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

export type ParsedAgentAsk =
  | { kind: 'help' }
  | { kind: 'usage'; message: string }
  | {
      kind: 'run';
      userMessage: string;
      projectId?: string;
      tokenBudget?: number;
      json: boolean;
      noSave: boolean;
      /** `--json`만 있고 `--no-save`는 없을 때 true — stderr 안내 한 줄 출력 */
      jsonImplicitNoSave: boolean;
    };

/**
 * `memento … agent ask …` 패턴 파싱. `ask` 직후 첫 토큰이 userMessage(플래그 아님).
 */
export function parseAgentAskInvocation(argv: string[]): ParsedAgentAsk {
  const rest = stripGlobalCliArgs(argv);
  if (rest.length === 0) {
    return { kind: 'usage', message: 'agent ask: 인자가 없습니다.' };
  }
  if (rest[0] !== 'agent') {
    return { kind: 'usage', message: 'internal: not an agent command' };
  }
  const sub = rest[1];
  if (sub === undefined || sub === '--help' || sub === '-h') {
    return { kind: 'help' };
  }
  if (sub !== 'ask') {
    return {
      kind: 'usage',
      message: `알 수 없는 agent 서브커맨드: ${sub}. 사용: memento agent ask <message> [options]`,
    };
  }
  const tail = rest.slice(2);
  if (tail.length === 0) {
    return { kind: 'usage', message: 'agent ask: 사용자 메시지가 필요합니다.' };
  }
  if (tail[0] === '--help' || tail[0] === '-h') {
    return { kind: 'help' };
  }
  if (tail[0].startsWith('-')) {
    return {
      kind: 'usage',
      message: 'agent ask: 사용자 메시지는 ask 바로 다음에 와야 합니다(플래그 아님).',
    };
  }
  const userMessage = tail[0];
  if (!String(userMessage).trim()) {
    return { kind: 'usage', message: 'agent ask: 사용자 메시지가 비어 있습니다.' };
  }

  const flagArgv = tail.slice(1);
  if (flagArgv.includes('--help') || flagArgv.includes('-h')) {
    return { kind: 'help' };
  }

  const flagErr = validateAgentAskFlagArgv(flagArgv);
  if (flagErr) {
    return { kind: 'usage', message: flagErr };
  }

  const raw = parseArgvToParams(flagArgv);
  const typeErr = validateAgentAskRawTypes(raw);
  if (typeErr) {
    return { kind: 'usage', message: typeErr };
  }

  const json = raw.json === true;
  const noSave = raw.no_save === true;

  if (raw.llm !== undefined) {
    if (raw.llm !== 'mock') {
      return {
        kind: 'usage',
        message: 'agent ask: --llm 값은 현재 mock만 지원합니다.',
      };
    }
  }
  if (raw.llm === true) {
    return { kind: 'usage', message: 'agent ask: --llm 에는 mock 을 지정하세요.' };
  }

  const projectId = typeof raw.project_id === 'string' ? raw.project_id : undefined;
  const tokenBudget = typeof raw.token_budget === 'number' ? raw.token_budget : undefined;

  return {
    kind: 'run',
    userMessage,
    projectId,
    tokenBudget,
    json,
    noSave,
    jsonImplicitNoSave: json && !noSave,
  };
}

/** `agent ask` 가 허용하는 `--` 옵션만 통과(알 수 없는 플래그·남는 인자 거절). */
const AGENT_ASK_ALLOWED_FLAGS = new Set([
  'json',
  'no_save',
  'project_id',
  'token_budget',
  'llm',
]);

const AGENT_ASK_VALUE_FLAGS = new Set(['project_id', 'token_budget', 'llm']);

export function validateAgentAskFlagArgv(flagArgv: string[]): string | null {
  for (let i = 0; i < flagArgv.length; ) {
    const arg = flagArgv[i];
    if (arg === '-h' || arg === '--help') {
      i += 1;
      continue;
    }
    if (!arg.startsWith('-')) {
      return `알 수 없는 인자: ${arg}`;
    }
    if (!arg.startsWith('--') || arg.length <= 2) {
      return `알 수 없는 옵션: ${arg}`;
    }
    const key = arg.slice(2).replace(/-/g, '_');
    if (!AGENT_ASK_ALLOWED_FLAGS.has(key)) {
      return `알 수 없는 옵션: --${arg.slice(2)}`;
    }
    if (AGENT_ASK_VALUE_FLAGS.has(key)) {
      const next = flagArgv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        return `옵션 --${key.replace(/_/g, '-')} 에는 값이 필요합니다.`;
      }
      i += 2;
      continue;
    }
    i += 1;
  }
  return null;
}

export function validateAgentAskRawTypes(raw: Record<string, unknown>): string | null {
  if ('json' in raw && raw.json !== true) {
    return 'agent ask: --json 은 값 없이 쓰는 플래그입니다.';
  }
  if ('no_save' in raw && raw.no_save !== true) {
    return 'agent ask: --no-save 는 값 없이 쓰는 플래그입니다.';
  }
  if ('project_id' in raw) {
    if (typeof raw.project_id !== 'string' || !String(raw.project_id).trim()) {
      return 'agent ask: --project-id 는 비어 있지 않은 문자열이어야 합니다.';
    }
  }
  if ('token_budget' in raw) {
    if (typeof raw.token_budget !== 'number' || !Number.isFinite(raw.token_budget)) {
      return 'agent ask: --token-budget 는 유한한 숫자여야 합니다.';
    }
  }
  return null;
}

function resolveDbPath(pre: PreCliOptions): string {
  const fromCli = pre.dbPath?.trim();
  if (fromCli) return fromCli;
  const fromEnv = process.env.DB_PATH?.trim();
  if (fromEnv) return fromEnv;
  return mementoConfig.dbPath;
}

type ErrorCode =
  | 'MISSING_QUERY'
  | 'INVALID_OPTION'
  | 'BOOTSTRAP_FAILED'
  | 'AGENT_RUN_FAILED'
  | 'PERSIST_FAILED'
  | 'INTERRUPTED'
  | 'NON_INTERACTIVE'
  | 'PROVIDER_MISCONFIGURED';

function jsonFailure(
  code: ErrorCode,
  stage: 'usage' | 'bootstrap' | 'run' | 'persist',
  message: string,
  details: Record<string, unknown> = {},
): string {
  return `${JSON.stringify({
    ok: false,
    error: { code, stage, message, details },
  })}\n`;
}

function writeOut(s: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(s, (e) => (e ? reject(e) : resolve()));
  });
}

function writeErr(s: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stderr.write(s, (e) => (e ? reject(e) : resolve()));
  });
}

function debugErr(err: unknown): void {
  if (process.env.MEMENTO_DEBUG === '1' && err instanceof Error && err.stack) {
    void writeErr(err.stack + '\n');
  }
}

export type AgentAskApproveAnswer = 'y' | 'n' | 's' | 'q' | 'interrupt';

/** 기본 readline 승인 프롬프트. 테스트에서는 `AgentAskRuntimeHooks.promptApprove`로 대체 가능 (#237). */
export async function promptApproveInteractive(
  candidate: KnowledgeCandidate,
  index: number,
  total: number,
  interruptRef: { interrupted: boolean },
): Promise<AgentAskApproveAnswer> {
  const rl = createInterface({ input: stdinStream, output: stderrStream });
  const onRlSigInt = (): void => {
    interruptRef.interrupted = true;
    rl.close();
  };
  rl.on('SIGINT', onRlSigInt);
  try {
    const header =
      `\n[${index + 1}/${total}] (${candidate.category}, importance=${candidate.importance})\n` +
      `  ${candidate.content}\n` +
      `  reason: ${candidate.reason}\n` +
      `  suggested type: ${candidate.suggestedMemoryType}, tags: ${JSON.stringify(candidate.tags)}\n` +
      `  Save? (y)es / (n)o / (s)kip rest / (q)uit & save approved > `;
    let line: string;
    try {
      line = await rl.question(header);
    } catch {
      if (interruptRef.interrupted) return 'interrupt';
      return 'n';
    }
    const t = String(line).trim().toLowerCase();
    if (t === '' || t === 'n') return 'n';
    if (t === 'y' || t === 'yes') return 'y';
    if (t === 's' || t === 'skip') return 's';
    if (t === 'q' || t === 'quit') return 'q';
    return 'n';
  } finally {
    rl.removeListener('SIGINT', onRlSigInt);
    rl.close();
  }
}

export type AgentAskPromptApprove = (
  candidate: KnowledgeCandidate,
  index: number,
  total: number,
  interruptRef: { interrupted: boolean },
) => Promise<AgentAskApproveAnswer>;

/** in-process 테스트 전용: 제품 CLI 경로는 `cli.ts`가 훅 없이 호출한다 (#237). */
export interface AgentAskRuntimeHooks {
  /** 미지정 시 `process.stdin.isTTY` */
  stdinIsTTY?: boolean;
  /** 미지정 시 `promptApproveInteractive` */
  promptApprove?: AgentAskPromptApprove;
}

export async function runAgentAskMain(
  preOptions: PreCliOptions,
  argv: string[],
  hooks?: AgentAskRuntimeHooks,
): Promise<number> {
  const parsed = parseAgentAskInvocation(argv);
  if (parsed.kind === 'help') {
    await writeErr(agentAskHelpText());
    return 0;
  }
  if (parsed.kind === 'usage') {
    const useJson = argv.includes('--json');
    if (useJson) {
      await writeOut(jsonFailure('INVALID_OPTION', 'usage', parsed.message));
    } else {
      await writeErr(parsed.message + '\n');
    }
    return 1;
  }

  const {
    userMessage,
    projectId,
    tokenBudget,
    json,
    noSave,
    jsonImplicitNoSave,
  } = parsed;

  const prevCliQuiet = process.env.MEMENTO_CLI_QUIET;
  if (json) {
    process.env.MEMENTO_CLI_QUIET = '1';
  }
  try {
  const stdinTty = hooks?.stdinIsTTY ?? Boolean(stdinStream.isTTY);
  const promptFn = hooks?.promptApprove ?? promptApproveInteractive;
  const skipPersist = noSave || json;

  if (!stdinTty && !json && !noSave) {
    const msg = '비대화형 환경에서는 --json 또는 --no-save 가 필요합니다.';
    if (argv.includes('--json')) {
      await writeOut(jsonFailure('NON_INTERACTIVE', 'usage', msg));
    } else {
      await writeErr(msg + '\n');
    }
    return 1;
  }

  const interruptRef = { interrupted: false };
  const onProcessSigInt = (): void => {
    interruptRef.interrupted = true;
  };
  process.on('SIGINT', onProcessSigInt);
  try {
  const sessionId = randomUUID();
  let dbPath: string;
  try {
    dbPath = resolveDbPath(preOptions);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (json) {
      await writeOut(jsonFailure('INVALID_OPTION', 'usage', msg));
    } else {
      await writeErr(msg + '\n');
    }
    return 1;
  }

  let core: Awaited<ReturnType<typeof createMementoCore>> | undefined;
  try {
    core = await createMementoCore({ dbPath });
  } catch (e) {
    debugErr(e);
    const msg = e instanceof Error ? e.message : String(e);
    if (json) {
      await writeOut(jsonFailure('BOOTSTRAP_FAILED', 'bootstrap', msg));
    } else {
      await writeErr(msg + '\n');
    }
    return 2;
  }

  const { db, services } = core;
  const toolContext = createToolContext(db, services);

  let llm: ILLMPort;
  try {
    const parsed = parsePersonalAgentLlmEnv(process.env, {
      openaiApiKey: mementoConfig.openaiApiKey,
      geminiApiKey: mementoConfig.geminiApiKey,
    });
    llm = createPersonalAgentLlmPort(parsed, {});
  } catch (e) {
    debugErr(e);
    if (e instanceof PersonalAgentLlmError) {
      const msg = e.message;
      if (json) {
        await writeOut(jsonFailure('PROVIDER_MISCONFIGURED', 'usage', msg));
      } else {
        await writeErr(msg + '\n');
      }
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      if (json) {
        await writeOut(jsonFailure('BOOTSTRAP_FAILED', 'bootstrap', msg));
      } else {
        await writeErr(msg + '\n');
      }
    }
    await services.runtimeDiagnosticsSamplerCleanup?.().catch(() => {});
    closeDatabase(db);
    return 2;
  }

  const context = new ToolContextKnowledgeContextAdapter(toolContext);
  const persistence = new ToolContextRememberPersistenceAdapter(toolContext);
  const service = new PersonalKnowledgeAgentService({ llm, context, persistence });

  let runResult: Awaited<ReturnType<PersonalKnowledgeAgentService['runOneTurn']>>;
  try {
    runResult = await service.runOneTurn({
      userMessage,
      projectId,
      tokenBudget,
      sessionId,
      ownerId: undefined,
    });
  } catch (e) {
    debugErr(e);
    const msg = e instanceof Error ? e.message : String(e);
    if (json) {
      await writeOut(jsonFailure('AGENT_RUN_FAILED', 'run', msg));
    } else {
      await writeErr(msg + '\n');
    }
    await services.runtimeDiagnosticsSamplerCleanup?.().catch(() => {});
    closeDatabase(db);
    return 3;
  }

  if (interruptRef.interrupted) {
    await writeErr('중단되어 저장하지 않습니다.\n');
    await services.runtimeDiagnosticsSamplerCleanup?.().catch(() => {});
    closeDatabase(db);
    return 130;
  }

  const basePayload = {
    ok: true as const,
    sessionId,
    input: {
      userMessage,
      projectId,
      tokenBudget,
    },
    knowledgeContext: {
      itemCount: runResult.knowledgeContext.itemCount,
      tokenEstimate: runResult.knowledgeContext.tokenEstimate,
      summary: runResult.knowledgeContext.summary,
    },
    llm: {
      response: runResult.llmResponse,
      metadata: runResult.llmMetadata ?? null,
    },
    candidates: runResult.candidates,
  };

  let persistenceBlock: {
    attempted: boolean;
    items: PersonalKnowledgePersistItemResult[];
    persistedCount: number;
    errorCount: number;
  } = {
    attempted: false,
    items: [],
    persistedCount: 0,
    errorCount: 0,
  };

  if (!skipPersist && stdinTty && runResult.candidates.length > 0) {
    const approved: string[] = [];
    for (let i = 0; i < runResult.candidates.length; i++) {
      if (interruptRef.interrupted) {
        await writeErr('중단되어 저장하지 않습니다.\n');
        await services.runtimeDiagnosticsSamplerCleanup?.().catch(() => {});
        closeDatabase(db);
        return 130;
      }
      const c = runResult.candidates[i];
      const ans = await promptFn(c, i, runResult.candidates.length, interruptRef);
      if (ans === 'interrupt') {
        await writeErr('중단되어 저장하지 않습니다.\n');
        await services.runtimeDiagnosticsSamplerCleanup?.().catch(() => {});
        closeDatabase(db);
        return 130;
      }
      if (ans === 'y') {
        approved.push(c.id);
      } else if (ans === 's' || ans === 'q') {
        break;
      }
    }

    if (approved.length > 0) {
      try {
        const pr = await service.persistApprovedCandidates({
          candidates: runResult.candidates,
          approvedCandidateIds: approved,
          projectId,
          sessionId,
          processId: PROCESS_ID,
        });
        persistenceBlock = {
          attempted: true,
          items: pr.items,
          persistedCount: pr.persistedCount,
          errorCount: pr.errorCount,
        };
      } catch (e) {
        debugErr(e);
        const msg = e instanceof Error ? e.message : String(e);
        if (json) {
          await writeOut(
            jsonFailure('PERSIST_FAILED', 'persist', msg, {
              partial: persistenceBlock,
            }),
          );
        } else {
          await writeErr(msg + '\n');
        }
        await services.runtimeDiagnosticsSamplerCleanup?.().catch(() => {});
        closeDatabase(db);
        return 4;
      }
    }
  }

  const successObj = {
    ...basePayload,
    persistence: persistenceBlock,
  };

  if (json) {
    await writeOut(JSON.stringify(successObj) + '\n');
    if (jsonImplicitNoSave) {
      await writeErr(JSON_INTERACTION_INFO);
    }
  } else {
    await writeErr(
      `LLM: ${runResult.llmResponse}\n` +
        `컨텍스트: ${runResult.knowledgeContext.summary}\n` +
        `후보 ${runResult.candidates.length}건\n`,
    );
    if (skipPersist) {
      await writeErr('(저장 생략: --json 또는 --no-save)\n');
    }
    await writeOut(JSON.stringify(successObj) + '\n');
  }

  await services.runtimeDiagnosticsSamplerCleanup?.().catch(() => {});
  closeDatabase(db);

  if (persistenceBlock.attempted && persistenceBlock.errorCount > 0) {
    return 4;
  }
  return 0;
  } finally {
    process.removeListener('SIGINT', onProcessSigInt);
  }
  } finally {
    if (json) {
      if (prevCliQuiet === undefined) {
        delete process.env.MEMENTO_CLI_QUIET;
      } else {
        process.env.MEMENTO_CLI_QUIET = prevCliQuiet;
      }
    }
  }
}

export function agentAskHelpText(): string {
  return (
    'memento agent ask — 개인 지식 Agent 한 턴 (in-process)\n\n' +
    'Usage: memento [global-options] agent ask <message> [options]\n\n' +
    '  <message>   ask 바로 다음에 오는 한 덩어리 문자열(필수)\n\n' +
    'Options:\n' +
    '  --project-id <id>     project_id 전달\n' +
    '  --token-budget <n>    memory_injection 추정 예산\n' +
    '  --json                stdout에 JSON 한 줄 (--json 단독 시 저장 생략)\n' +
    '  --no-save             승인·저장 단계 생략\n' +
    '  --llm mock            LLM 어댑터(현재 mock만)\n\n' +
    'Global options: --config-dir, --db-path (in-process DB 경로), --env-file\n'
  );
}

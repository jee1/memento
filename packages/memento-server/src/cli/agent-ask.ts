/**
 * `memento agent ask` — in-process 개인 지식 Agent 한 턴 (#236).
 * 설계: docs/superpowers/specs/2026-05-14-issue-236-agent-ask-cli-design.md
 */

import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin as stdinStream, stdout as stdoutStream } from 'node:process';

import {
  closeDatabase,
  createMementoCore,
  createToolContext,
  mementoConfig,
  PersonalKnowledgeAgentService,
  DeterministicMockLlmAdapter,
  ToolContextKnowledgeContextAdapter,
  ToolContextRememberPersistenceAdapter,
} from '@memento/core';
import type { KnowledgeCandidate, PersonalKnowledgePersistItemResult } from '@memento/core';

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

  const raw = parseArgvToParams(flagArgv);
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
  | 'NON_INTERACTIVE';

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

async function promptApprove(
  candidate: KnowledgeCandidate,
  index: number,
  total: number,
): Promise<'y' | 'n' | 's' | 'q'> {
  const rl = createInterface({ input: stdinStream, output: stdoutStream });
  try {
    const header =
      `\n[${index + 1}/${total}] (${candidate.category}, importance=${candidate.importance})\n` +
      `  ${candidate.content}\n` +
      `  reason: ${candidate.reason}\n` +
      `  suggested type: ${candidate.suggestedMemoryType}, tags: ${JSON.stringify(candidate.tags)}\n` +
      `  Save? (y)es / (n)o / (s)kip rest / (q)uit & save approved > `;
    const line = await rl.question(header);
    const t = String(line).trim().toLowerCase();
    if (t === '' || t === 'n') return 'n';
    if (t === 'y' || t === 'yes') return 'y';
    if (t === 's' || t === 'skip') return 's';
    if (t === 'q' || t === 'quit') return 'q';
    return 'n';
  } finally {
    rl.close();
  }
}

export async function runAgentAskMain(
  preOptions: PreCliOptions,
  argv: string[],
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
  const stdinTty = Boolean(stdinStream.isTTY);
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

  let interrupted = false;
  const onSigInt = (): void => {
    interrupted = true;
  };
  process.once('SIGINT', onSigInt);

  const sessionId = randomUUID();
  let dbPath: string;
  try {
    dbPath = resolveDbPath(preOptions);
  } catch (e) {
    process.removeListener('SIGINT', onSigInt);
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
    process.removeListener('SIGINT', onSigInt);
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
  const llm = new DeterministicMockLlmAdapter();
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
    process.removeListener('SIGINT', onSigInt);
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

  if (interrupted) {
    process.removeListener('SIGINT', onSigInt);
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
      if (interrupted) {
        process.removeListener('SIGINT', onSigInt);
        await writeErr('중단되어 저장하지 않습니다.\n');
        await services.runtimeDiagnosticsSamplerCleanup?.().catch(() => {});
        closeDatabase(db);
        return 130;
      }
      const c = runResult.candidates[i];
      const ans = await promptApprove(c, i, runResult.candidates.length);
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
        process.removeListener('SIGINT', onSigInt);
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

  process.removeListener('SIGINT', onSigInt);

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
